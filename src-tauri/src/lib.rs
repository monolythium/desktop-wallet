// Stage 4 entry point.
//
// Registers the Tauri command surface for the wallet:
// - `keychain_unlock` / `keychain_store` — OS keychain bridge.
// - `vault_create`   / `vault_unlock`    — Argon2id + AES-GCM seed vault.
// - `ledger_*`                           — HID hardware signer (Stage 4).
//
// Stage 5 will extend with `monolythium-core-sdk` RPC wrappers + passkey
// signer.

use std::sync::Arc;
use tokio::sync::Mutex;

mod keychain;
mod ledger;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ledger_state: ledger::LedgerState = Arc::new(Mutex::new(()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ledger_state)
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_unlock,
            keychain::keychain_store,
            vault::vault_create,
            vault::vault_unlock,
            ledger::ledger_enumerate_devices,
            ledger::ledger_get_address,
            ledger::ledger_sign_transaction,
            ledger::ledger_sign_personal_message,
            ledger::ledger_sign_typed_data,
            ledger::ledger_default_hd_path,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
