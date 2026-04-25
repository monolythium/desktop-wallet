// Stage 3 entry point.
//
// Registers the Tauri command surface for the wallet:
// - `keychain_unlock` / `keychain_store` — OS keychain bridge.
//
// Stage 4 will extend with `monolythium-core-sdk` RPC wrappers + hardware
// signer commands (Ledger).

mod keychain;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_unlock,
            keychain::keychain_store,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
