// Stage 0 entry point. No commands wired yet; Stage 1 will add typed Rust commands
// for keychain + mono-core-sdk RPC plumbing.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
