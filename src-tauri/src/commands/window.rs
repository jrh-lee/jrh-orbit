use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WindowMode {
    Dock,
    Sidebar,
    Expanded,
}

#[derive(Clone, Copy)]
struct WindowState {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn saved_states() -> &'static Mutex<HashMap<String, WindowState>> {
    static S: OnceLock<Mutex<HashMap<String, WindowState>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn current_mode_store() -> &'static Mutex<String> {
    static M: OnceLock<Mutex<String>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(String::from("expanded")))
}

fn save_current_state(window: &tauri::WebviewWindow) {
    let (pos, size, scale) = match (
        window.outer_position(),
        window.outer_size(),
        window.current_monitor(),
    ) {
        (Ok(p), Ok(s), Ok(Some(m))) => (p, s, m.scale_factor()),
        _ => return,
    };
    let state = WindowState {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        w: size.width as f64 / scale,
        h: size.height as f64 / scale,
    };
    let cur = current_mode_store().lock().unwrap().clone();
    saved_states().lock().unwrap().insert(cur, state);
}

fn clamp_to_screen(window: &tauri::WebviewWindow, x: f64, y: f64, w: f64, h: f64) -> (f64, f64) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let mp = monitor.position();
        let ms = monitor.size();
        let mx = mp.x as f64 / scale;
        let my = mp.y as f64 / scale;
        let mw = ms.width as f64 / scale;
        let mh = ms.height as f64 / scale;
        let mut cx = x;
        let mut cy = y;
        if cx + w > mx + mw { cx = (mx + mw - w).max(mx); }
        if cy + h > my + mh { cy = (my + mh - h).max(my); }
        if cx < mx { cx = mx; }
        if cy < my { cy = my; }
        (cx, cy)
    } else {
        (x, y)
    }
}

#[tauri::command]
pub fn set_window_mode(app: AppHandle, mode: String, always_on_top: Option<bool>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    save_current_state(&window);
    *current_mode_store().lock().unwrap() = mode.clone();

    let saved = saved_states().lock().unwrap().get(&mode).copied();

    match mode.as_str() {
        "dock" => {
            let w = 214.0_f64;
            let h = 134.0_f64;
            window
                .set_size(tauri::LogicalSize::new(w, h))
                .map_err(|e| e.to_string())?;
            window
                .set_min_size(Some(tauri::LogicalSize::new(160.0, 100.0)))
                .map_err(|e| e.to_string())?;
            window.set_resizable(false).map_err(|e| e.to_string())?;
            let aot = always_on_top.unwrap_or(true);
            window
                .set_always_on_top(aot)
                .map_err(|e| e.to_string())?;
            if let Some(s) = saved {
                let _ = window.set_position(tauri::LogicalPosition::new(s.x, s.y));
            }
        }
        "sidebar" => {
            let (w, h) = if let Some(s) = saved {
                (s.w, s.h)
            } else {
                let height = 1000.0_f64;
                (320.0, height)
            };
            window
                .set_size(tauri::LogicalSize::new(w, h))
                .map_err(|e| e.to_string())?;
            window
                .set_min_size(Some(tauri::LogicalSize::new(240.0, 500.0)))
                .map_err(|e| e.to_string())?;
            window.set_resizable(true).map_err(|e| e.to_string())?;
            let aot = always_on_top.unwrap_or(true);
            window
                .set_always_on_top(aot)
                .map_err(|e| e.to_string())?;
            if let Some(s) = saved {
                let (cx, cy) = clamp_to_screen(&window, s.x, s.y, w, h);
                let _ = window.set_position(tauri::LogicalPosition::new(cx, cy));
            } else if let Ok(pos) = window.outer_position() {
                if let Ok(Some(mon)) = window.current_monitor() {
                    let scale = mon.scale_factor();
                    let x = pos.x as f64 / scale;
                    let y = pos.y as f64 / scale;
                    let (cx, cy) = clamp_to_screen(&window, x, y, w, h);
                    let _ = window.set_position(tauri::LogicalPosition::new(cx, cy));
                }
            }
        }
        "expanded" => {
            let (w, h) = if let Some(s) = saved {
                (s.w, s.h)
            } else {
                (1400.0_f64, 860.0_f64)
            };
            window
                .set_size(tauri::LogicalSize::new(w, h))
                .map_err(|e| e.to_string())?;
            window.set_resizable(true).map_err(|e| e.to_string())?;
            let aot = always_on_top.unwrap_or(false);
            window
                .set_always_on_top(aot)
                .map_err(|e| e.to_string())?;

            if let Some(s) = saved {
                let (cx, cy) = clamp_to_screen(&window, s.x, s.y, w, h);
                let _ = window.set_position(tauri::LogicalPosition::new(cx, cy));
            } else if let Ok(pos) = window.outer_position() {
                if let Ok(Some(mon)) = window.current_monitor() {
                    let scale = mon.scale_factor();
                    let x = pos.x as f64 / scale;
                    let y = pos.y as f64 / scale;
                    let (cx, cy) = clamp_to_screen(&window, x, y, w, h);
                    let _ = window.set_position(tauri::LogicalPosition::new(cx, cy));
                }
            }
        }
        _ => return Err(format!("Unknown mode: {}", mode)),
    }

    Ok(())
}

#[tauri::command]
pub fn toggle_always_on_top(app: AppHandle, on_top: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    window
        .set_always_on_top(on_top)
        .map_err(|e| e.to_string())
}
