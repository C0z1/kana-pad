// The app is the same web build as the PWA, loaded from ../dist inside a native window.
// The only native piece is the weekly progress backup, written to disk where the
// browser version can't: the app data folder and Documents/KanaPad.
use std::path::Path;
use tauri::Manager;

const PREFIX: &str = "KanaPad-respaldo-";
const KEEP: usize = 4;

fn valid_name(name: &str) -> bool {
    name.starts_with(PREFIX)
        && name.ends_with(".json")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

// Keeps only the newest KEEP backups (names sort by date).
fn prune(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| valid_name(n))
        .collect();
    names.sort();
    let extra = names.len().saturating_sub(KEEP);
    for n in &names[..extra] {
        let _ = std::fs::remove_file(dir.join(n));
    }
}

#[tauri::command]
fn save_backup(app: tauri::AppHandle, name: String, json: String) -> Result<Vec<String>, String> {
    if !valid_name(&name) {
        return Err("nombre de respaldo inválido".into());
    }
    let mut dirs = Vec::new();
    if let Ok(d) = app.path().app_data_dir() {
        dirs.push(d.join("respaldos"));
    }
    if let Ok(d) = app.path().document_dir() {
        dirs.push(d.join("KanaPad"));
    }
    let mut saved = Vec::new();
    for dir in dirs {
        if std::fs::create_dir_all(&dir).is_err() {
            continue;
        }
        let path = dir.join(&name);
        if std::fs::write(&path, &json).is_ok() {
            saved.push(path.display().to_string());
            prune(&dir);
        }
    }
    if saved.is_empty() {
        Err("no se pudo guardar el respaldo".into())
    } else {
        Ok(saved)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_backup])
        .run(tauri::generate_context!())
        .expect("error while running Kana Pad");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_restricted() {
        assert!(valid_name("KanaPad-respaldo-2026-10-27.json"));
        assert!(!valid_name("../KanaPad-respaldo-2026-10-27.json"));
        assert!(!valid_name("KanaPad-respaldo-x.txt"));
        assert!(!valid_name("otro.json"));
    }

    #[test]
    fn prune_keeps_the_newest_four() {
        let dir = std::env::temp_dir().join(format!("kanapad-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for d in 1..=6 {
            std::fs::write(dir.join(format!("{PREFIX}2026-10-0{d}.json")), "{}").unwrap();
        }
        std::fs::write(dir.join("ajeno.json"), "{}").unwrap();
        prune(&dir);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, vec!["KanaPad-respaldo-2026-10-03.json", "KanaPad-respaldo-2026-10-04.json", "KanaPad-respaldo-2026-10-05.json", "KanaPad-respaldo-2026-10-06.json", "ajeno.json"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
