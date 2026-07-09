mod commands;

use commands::{config, google, notes, window};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            notes::read_note,
            notes::write_note,
            notes::list_notes,
            notes::delete_note,
            notes::ensure_dir,
            notes::path_exists,
            notes::snapshot_data,
            notes::list_snapshots,
            notes::restore_snapshot,
            notes::write_binary,
            notes::write_binary_b64,
            notes::copy_file,
            notes::open_path,
            config::read_config,
            config::write_config,
            google::google_oauth_login,
            google::google_refresh_token,
            google::http_get_text,
            window::set_window_mode,
            window::toggle_always_on_top,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
