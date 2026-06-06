use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub data_dir: String,
    pub theme: String,
    pub pomodoro_work: u32,
    pub pomodoro_break: u32,
    pub pomodoro_long_break: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            data_dir: String::new(),
            theme: "light".to_string(),
            pomodoro_work: 25,
            pomodoro_break: 5,
            pomodoro_long_break: 15,
        }
    }
}

#[tauri::command]
pub fn read_config(config_path: String) -> Result<AppConfig, String> {
    let path = PathBuf::from(&config_path);
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_config(config_path: String, config: AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    if let Some(parent) = PathBuf::from(&config_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&config_path, json).map_err(|e| e.to_string())
}
