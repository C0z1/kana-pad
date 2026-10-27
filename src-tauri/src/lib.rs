// The app is the same web build as the PWA, loaded from ../dist inside a native window.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Kana Pad");
}
