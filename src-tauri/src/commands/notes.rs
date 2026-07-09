use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteMeta {
    pub title: String,
    pub note_type: String,
    pub project: Option<String>,
    pub tags: Vec<String>,
    pub created: String,
    pub updated: String,
    pub path: String,
}

#[tauri::command]
pub fn read_note(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_note(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_notes(dir: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    collect_md_files(&path, &mut files).map_err(|e| e.to_string())?;
    Ok(files)
}

fn collect_md_files(dir: &PathBuf, files: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_md_files(&path, files)?;
        } else if path.extension().is_some_and(|ext| ext == "md") {
            if let Some(s) = path.to_str() {
                files.push(s.to_string());
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_note(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

fn copy_tree(src: &PathBuf, dst: &PathBuf, exts: &[&str]) -> std::io::Result<u32> {
    if !src.exists() {
        return Ok(0);
    }
    let mut count = 0u32;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            count += copy_tree(&path, &dst.join(entry.file_name()), exts)?;
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| exts.contains(&e))
        {
            fs::create_dir_all(dst)?;
            fs::copy(&path, dst.join(entry.file_name()))?;
            count += 1;
        }
    }
    Ok(count)
}

/// Copy notes/*.md and data/*.json into `<backup_root>/<stamp>/`, then prune
/// old snapshots beyond `keep`. Snapshot backups protect against logical
/// corruption (the app itself overwriting files), so they run daily to both
/// a local dir and the cloud-synced data dir.
#[tauri::command]
pub fn snapshot_data(
    data_dir: String,
    backup_root: String,
    stamp: String,
    keep: usize,
) -> Result<u32, String> {
    let dest = PathBuf::from(&backup_root).join(&stamp);
    let mut count = 0u32;
    count += copy_tree(
        &PathBuf::from(&data_dir).join("notes"),
        &dest.join("notes"),
        &["md"],
    )
    .map_err(|e| e.to_string())?;
    count += copy_tree(
        &PathBuf::from(&data_dir).join("data"),
        &dest.join("data"),
        &["json"],
    )
    .map_err(|e| e.to_string())?;

    // Prune oldest snapshots beyond `keep` (stamps sort lexicographically)
    let root = PathBuf::from(&backup_root);
    if let Ok(entries) = fs::read_dir(&root) {
        let mut dirs: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().to_str().map(String::from))
            .collect();
        dirs.sort();
        while dirs.len() > keep {
            let oldest = dirs.remove(0);
            let _ = fs::remove_dir_all(root.join(oldest));
        }
    }

    Ok(count)
}

/// List snapshot stamps under `backup_root` (newest first). Only date-stamped
/// dirs count — helper dirs like `rescue/` are excluded.
#[tauri::command]
pub fn list_snapshots(backup_root: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&backup_root);
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut dirs: Vec<String> = fs::read_dir(&root)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| n.starts_with(|c: char| c.is_ascii_digit()))
        .collect();
    dirs.sort();
    dirs.reverse();
    Ok(dirs)
}

/// Restore a snapshot: copy its notes/*.md and data/*.json back over the
/// originals. Files created after the snapshot are left untouched (no
/// deletion — restore only overwrites what the snapshot contains).
#[tauri::command]
pub fn restore_snapshot(
    data_dir: String,
    backup_root: String,
    stamp: String,
) -> Result<u32, String> {
    let src = PathBuf::from(&backup_root).join(&stamp);
    if !src.exists() {
        return Err(format!("snapshot not found: {stamp}"));
    }
    let mut count = 0u32;
    count += copy_tree(
        &src.join("notes"),
        &PathBuf::from(&data_dir).join("notes"),
        &["md"],
    )
    .map_err(|e| e.to_string())?;
    count += copy_tree(
        &src.join("data"),
        &PathBuf::from(&data_dir).join("data"),
        &["json"],
    )
    .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn write_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_binary_b64(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("base64 decode failed: {e}"))?;
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn copy_file(src: String, dest: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&dest).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
