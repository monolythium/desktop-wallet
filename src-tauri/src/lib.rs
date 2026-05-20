// Stage 4 entry point.
//
// Registers the Tauri command surface for the wallet:
// - `keychain_unlock` / `keychain_store` — OS keychain bridge.
// - `vault_create` / `vault_seal_seed` / `vault_unlock` — seed vault.
// - `ledger_*`                           — HID hardware signer (Stage 4).
//
// Stage 5 will extend with `monolythium-core-sdk` RPC wrappers + passkey
// signer.

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

mod keychain;
mod ledger;
mod vault;
mod vault_multi;

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
            vault::vault_seal_seed,
            vault::vault_unlock,
            // Phase 5 multi-vault commands.
            vault_multi::commands::vaults_list,
            vault_multi::commands::vault_select,
            vault_multi::commands::vault_unlock_multi,
            vault_multi::commands::vault_lock,
            vault_multi::commands::vault_create_multi,
            vault_multi::commands::vault_rename,
            vault_multi::commands::vault_delete,
            ledger::ledger_enumerate_devices,
            ledger::ledger_get_address,
            ledger::ledger_sign_transaction,
            ledger::ledger_sign_personal_message,
            ledger::ledger_sign_typed_data,
            ledger::ledger_default_hd_path,
        ])
        .setup(|app| {
            // Phase 5: instantiate the multi-vault store with the
            // platform `app_data_dir` location. Falls back to the
            // resource dir if app_data_dir is somehow unavailable —
            // the load path tolerates a missing file.
            let mut container_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("monolythium-wallet"));
            container_path.push("vault.v1.json");
            app.manage(vault_multi::VaultStore::new(container_path));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
