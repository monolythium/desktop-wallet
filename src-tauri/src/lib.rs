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
use tauri::{Emitter, Manager, WindowEvent};
use tokio::sync::Mutex;

mod auto_lock;
mod ipfs_cache;
mod keychain;
mod ledger;
mod vault;
mod vault_multi;

use auto_lock::system_events::{
    register_platform_hooks, EventDispatcher, SystemEventKind, SystemEventListener,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ledger_state: ledger::LedgerState = Arc::new(Mutex::new(()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            // Phase 5 — cross-platform proxy for "user stepped away."
            // We emit a Tauri event the TS shell listens to; useVaults
            // calls `vault.lock()` so the in-memory MEK is wiped.
            //
            // The truly OS-level signals (Windows session-lock,
            // macOS will-sleep, Linux logind PrepareForSleep) need
            // platform-specific bindings — surfaced as GAP #D18 in
            // the Phase 5 final report. Window-focus loss is a
            // reasonable proxy that works without extra deps and
            // covers alt-tab / app-switch / Cmd+H / system-lock
            // (which always blurs the window first on every OS
            // we ship).
            match event {
                WindowEvent::Focused(false) => {
                    let _ = window.emit("vault://focus-lost", ());
                }
                WindowEvent::CloseRequested { .. } => {
                    let _ = window.emit("vault://window-closing", ());
                }
                _ => {}
            }
        })
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
            vault_multi::commands::vault_migrate_legacy,
            vault_multi::export::vault_export_blob,
            vault_multi::export::vault_import_blob,
            // Phase 6 multisig + proposal commands.
            vault_multi::multisig_commands::multisig_create,
            vault_multi::multisig_commands::multisigs_list,
            vault_multi::multisig_commands::multisig_select,
            vault_multi::multisig_commands::multisig_apply_governance,
            vault_multi::multisig_commands::proposal_create,
            vault_multi::multisig_commands::proposal_attach_signature,
            vault_multi::multisig_commands::proposal_mark_submitted,
            vault_multi::multisig_commands::proposal_cancel,
            vault_multi::multisig_commands::proposals_list,
            vault_multi::multisig_commands::proposal_import_signature,
            ledger::ledger_enumerate_devices,
            ledger::ledger_get_address,
            ledger::ledger_sign_transaction,
            ledger::ledger_sign_personal_message,
            ledger::ledger_sign_typed_data,
            ledger::ledger_default_hd_path,
            // Phase 7 — IPFS disk metadata cache.
            ipfs_cache::ipfs_cache_get,
            ipfs_cache::ipfs_cache_set,
            ipfs_cache::ipfs_cache_clear,
            ipfs_cache::ipfs_cache_stats,
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

            // Phase 7 — IPFS disk metadata cache (#D19). Uses the
            // platform `app_cache_dir` so the cache lives separately
            // from the vault container.
            let cache_root = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("monolythium-wallet-cache"));
            app.manage(ipfs_cache::IpfsCacheState::new(cache_root));

            // Phase 7 — wire the platform session-lock dispatcher.
            // The dispatcher fans OS-level events out to every
            // registered listener; our default listener emits a
            // Tauri event the TS shell handles by calling
            // `vault.lock()`.
            let dispatcher = EventDispatcher::new();
            dispatcher.add_listener(TauriEmitListener {
                handle: app.handle().clone(),
            });
            // No-op on platforms whose native hooks aren't wired yet
            // (#D18-windows FFI activation, #D18-macos, #D18-linux).
            // The Phase 5 focus-loss proxy stays as the primary
            // lock trigger until those land.
            if let Err(e) = register_platform_hooks(&dispatcher) {
                eprintln!("auto_lock: register_platform_hooks: {e}");
            }
            app.manage(dispatcher);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}

/// Default SystemEventListener implementation that emits a Tauri event
/// the TypeScript shell listens to. The shell handler calls
/// `useVaults().lock()` for any of the three OS event kinds — they
/// all map to "lock the wallet now."
struct TauriEmitListener {
    handle: tauri::AppHandle,
}

impl SystemEventListener for TauriEmitListener {
    fn on_event(&self, kind: SystemEventKind) {
        let _ = self.handle.emit("vault://os-event", kind.as_wire());
    }
}
