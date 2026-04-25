// Stage 4 entry point.
//
// Registers the Tauri command surface for the wallet:
// - `keychain_unlock` / `keychain_store` — OS keychain bridge.
// - `vault_create`   / `vault_unlock`    — Argon2id + AES-GCM seed vault.
//
// Stage 5 will extend with `monolythium-core-sdk` RPC wrappers + hardware
// signer commands (Ledger / passkey).

mod keychain;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_unlock,
            keychain::keychain_store,
            vault::vault_create,
            vault::vault_unlock,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
