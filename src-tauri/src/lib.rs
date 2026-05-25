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
use tokio::sync::Mutex;

mod keychain;
mod ledger;
mod mcp_bridge;
mod studio_host;
mod vault;

#[cfg(feature = "stele")]
mod stele;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ledger_state: ledger::LedgerState = Arc::new(Mutex::new(()));

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ledger_state)
        .manage(studio_host::StudioSidecarState::default());

    #[cfg(feature = "stele")]
    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .manage(stele::SidecarHandle::default())
        .manage(stele::ApprovalBridgeHandle::default())
        .manage(stele::OutboundMcpHandle::default());

    builder
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_unlock,
            keychain::keychain_store,
            vault::vault_create,
            vault::vault_seal_seed,
            vault::vault_unlock,
            ledger::ledger_enumerate_devices,
            ledger::ledger_get_address,
            ledger::ledger_sign_transaction,
            ledger::ledger_sign_personal_message,
            ledger::ledger_sign_typed_data,
            ledger::ledger_default_hd_path,
            mcp_bridge::mcp_shared_wallet_list,
            mcp_bridge::mcp_shared_store_exists,
            studio_host::studio_devkit_parse_manifest,
            studio_host::studio_devkit_check_compatibility,
            studio_host::studio_devkit_resolve_install_path,
            studio_host::studio_devkit_sidecar_status,
            studio_host::studio_devkit_select_local_path,
            studio_host::studio_devkit_install_local_archive,
            studio_host::studio_devkit_rollback,
            studio_host::studio_devkit_start_sidecar,
            studio_host::studio_devkit_stop_sidecar,
            studio_host::studio_devkit_drain_sidecar_messages,
            studio_host::studio_devkit_send_approval_result,
            studio_host::studio_devkit_send_command,
            studio_host::studio_workspace_trust,
            studio_host::studio_workspace_remove_trust,
            studio_host::studio_workspace_list_trusted,
            studio_host::studio_workspace_assert_trusted,
        ])
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
