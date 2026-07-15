use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpListener;

/// Google OAuth (Desktop-app client, loopback redirect flow).
///
/// The webview can't run the OAuth consent flow itself, and Google's token
/// endpoint isn't reliably CORS-accessible from a WebView origin — so the
/// authorization-code exchange lives here. Calendar API *reads* happen in
/// the frontend via fetch (googleapis.com REST supports CORS).
#[derive(Debug, Serialize, Deserialize)]
pub struct GoogleTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

fn spawn_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // NOT `cmd /c start` — cmd treats the `&` between query params as a
        // command separator and truncates the URL. rundll32 takes the URL as a
        // plain argument with no shell parsing involved. PATH가 제한된 환경도
        // 있으므로 절대경로로 호출하고, 실패 시 explorer로 폴백.
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let rundll = format!("{system_root}\\System32\\rundll32.exe");
        if std::process::Command::new(&rundll)
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
        let explorer = format!("{system_root}\\explorer.exe");
        std::process::Command::new(explorer)
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("지원하지 않는 OS".into())
}

/// Wait for the OAuth redirect on the loopback listener and pull `code` out
/// of the query string. Serves a tiny "done" page so the browser tab isn't
/// left hanging.
fn wait_for_code(listener: TcpListener) -> Result<String, String> {
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);

    for stream in listener.incoming() {
        if std::time::Instant::now() > deadline {
            return Err("OAuth timeout (5분 초과)".into());
        }
        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let first_line = req.lines().next().unwrap_or("");

        let code = first_line
            .split_whitespace()
            .nth(1)
            .and_then(|path| path.split('?').nth(1))
            .and_then(|qs| {
                qs.split('&')
                    .find(|kv| kv.starts_with("code="))
                    .map(|kv| kv.trim_start_matches("code=").to_string())
            });

        let (status, body_html) = if code.is_some() {
            ("200 OK", "<h2>✅ 인증 완료</h2><p>JRH-Orbit으로 돌아가세요. 이 탭은 닫아도 됩니다.</p>")
        } else {
            ("400 Bad Request", "<h2>인증 실패</h2><p>code 파라미터가 없습니다. 앱에서 다시 시도하세요.</p>")
        };
        let body = format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>JRH-Orbit</title></head><body style=\"font-family:sans-serif;text-align:center;padding-top:80px\">{}</body></html>",
            body_html
        );
        let resp = format!(
            "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            status,
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes());
        let _ = stream.flush();

        if let Some(code) = code {
            // The browser may URL-encode the code
            return Ok(code.replace("%2F", "/").replace("%2B", "+").replace("%3D", "="));
        }
    }
    Err("listener closed before receiving the OAuth redirect".into())
}

async fn exchange_token(params: &[(&str, &str)]) -> Result<GoogleTokens, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(params)
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("token endpoint {status}: {text}"));
    }
    serde_json::from_str::<GoogleTokens>(&text).map_err(|e| format!("token parse failed: {e} — {text}"))
}

#[tauri::command]
pub async fn google_oauth_login(
    client_id: String,
    client_secret: String,
) -> Result<GoogleTokens, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = reqwest::Url::parse_with_params(
        "https://accounts.google.com/o/oauth2/v2/auth",
        &[
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", "https://www.googleapis.com/auth/calendar.readonly"),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;

    spawn_browser(auth_url.as_str())?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener))
        .await
        .map_err(|e| e.to_string())??;

    exchange_token(&[
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("code", code.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ])
    .await
}

/// Fetch a text resource server-side. Used for iCal secret-address feeds —
/// calendar.google.com serves .ics without CORS headers, so the webview
/// can't fetch it directly.
#[tauri::command]
pub async fn http_get_text(url: String) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("https URL만 지원합니다".into());
    }
    let res = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_refresh_token(
    client_id: String,
    client_secret: String,
    refresh_token: String,
) -> Result<GoogleTokens, String> {
    exchange_token(&[
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ])
    .await
}
