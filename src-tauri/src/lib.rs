// Stage 4 entry point.
//
// Registers the Tauri command surface for the wallet:
// - `keychain_unlock` / `keychain_store` / `keychain_delete` — OS keychain bridge.
// - `vault_create` / `vault_seal_seed` / `vault_seal_v2` / `vault_unlock` /
//   `vault_reveal` — XChaCha20-Poly1305 seed vault (+ recovery-phrase reveal).
//
// Stage 5 will extend with `monolythium-core-sdk` RPC wrappers + passkey
// signer.

mod keychain;
mod name_registry;
mod studio_host;
mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Native OS toasts for terminal tx notifications. The frontend
        // (`src/sdk/os-toast.ts`) is the only caller; it gates every toast +
        // permission prompt behind the `wallet.experimentalEnabled` flag.
        .plugin(tauri_plugin_notification::init())
        .manage(studio_host::StudioSidecarState::default())
        .invoke_handler(tauri::generate_handler![
            keychain::keychain_unlock,
            keychain::keychain_store,
            keychain::keychain_delete,
            vault::vault_create,
            vault::vault_seal_seed,
            vault::vault_seal_v2,
            vault::vault_unlock,
            vault::vault_reveal,
            name_registry::name_check_availability,
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
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}
