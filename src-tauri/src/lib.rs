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

#[cfg(feature = "stele")]
use tauri::Manager;

mod keychain;
mod ledger;
mod mcp_bridge;
mod name_registry;
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

    // Tauri's `generate_handler!` macro doesn't accept `cfg` arms inside
    // its bracketed list, so the Stele-feature commands are appended via
    // a separate Builder step rather than baked into the same call.
    let builder = builder.invoke_handler(tauri::generate_handler![
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
        #[cfg(feature = "stele")]
        stele::commands::stele_sidecar_status,
        #[cfg(feature = "stele")]
        stele::commands::stele_addressbook_add,
        #[cfg(feature = "stele")]
        stele::commands::stele_addressbook_lookup,
        #[cfg(feature = "stele")]
        stele::commands::stele_addressbook_remove,
        #[cfg(feature = "stele")]
        stele::commands::stele_listing_search,
        #[cfg(feature = "stele")]
        stele::commands::stele_tx_outbox_list,
        #[cfg(feature = "stele")]
        stele::commands::stele_tx_outbox_get,
        #[cfg(feature = "stele")]
        stele::commands::stele_tx_outbox_retry,
        #[cfg(feature = "stele")]
        stele::commands::stele_tx_outbox_forget,
        #[cfg(feature = "stele")]
        stele::commands::stele_booking_request,
        #[cfg(feature = "stele")]
        stele::commands::stele_booking_counter,
        #[cfg(feature = "stele")]
        stele::commands::stele_booking_accept,
        #[cfg(feature = "stele")]
        stele::commands::stele_booking_release,
        #[cfg(feature = "stele")]
        stele::commands::stele_booking_dispute,
        #[cfg(feature = "stele")]
        stele::commands::stele_outbound_mcp_status,
        #[cfg(feature = "stele")]
        stele::commands::stele_outbound_mcp_start,
        #[cfg(feature = "stele")]
        stele::commands::stele_outbound_mcp_stop,
        #[cfg(feature = "stele")]
        stele::commands::stele_approval_resolve,
        #[cfg(feature = "stele")]
        stele::commands::stele_convert_estimate,
        #[cfg(feature = "stele")]
        stele::commands::stele_convert_create,
        #[cfg(feature = "stele")]
        stele::commands::stele_convert_status,
        #[cfg(feature = "stele")]
        stele::commands::stele_convert_history,
        #[cfg(feature = "stele")]
        stele::commands::stele_app_version,
        #[cfg(feature = "stele")]
        stele::commands::stele_claude_complete,
        #[cfg(feature = "stele")]
        stele::commands::stele_attestation_list,
        #[cfg(feature = "stele")]
        stele::commands::stele_mcp_inbound_test,
        #[cfg(feature = "stele")]
        stele::commands::stele_flight_search,
        #[cfg(feature = "stele")]
        stele::commands::stele_flight_offer_get,
        #[cfg(feature = "stele")]
        stele::commands::stele_flight_order_hold,
        #[cfg(feature = "stele")]
        stele::commands::stele_flight_order_list,
        #[cfg(feature = "stele")]
        stele::commands::stele_x402_policy_set,
        #[cfg(feature = "stele")]
        stele::commands::stele_x402_policy_list,
        #[cfg(feature = "stele")]
        stele::commands::stele_x402_policy_get,
        #[cfg(feature = "stele")]
        stele::commands::stele_x402_policy_remove,
        #[cfg(feature = "stele")]
        stele::commands::stele_x402_pay,
        #[cfg(feature = "stele")]
        stele::commands::stele_agent_wallet_create,
        #[cfg(feature = "stele")]
        stele::commands::stele_agent_wallet_list,
        #[cfg(feature = "stele")]
        stele::commands::stele_agent_wallet_limits,
        #[cfg(feature = "stele")]
        stele::commands::stele_agent_wallet_pause,
        #[cfg(feature = "stele")]
        stele::commands::stele_agent_wallet_delete,
        #[cfg(feature = "stele")]
        stele::commands::stele_spend_coinsbee_guide,
        #[cfg(feature = "stele")]
        stele::commands::stele_spend_coinsbee_invoice,
        #[cfg(feature = "stele")]
        stele::commands::stele_booking_invoice_create,
    ]);

    builder
        .setup(|_app| {
            #[cfg(feature = "stele")]
            stele_boot(_app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monolythium Wallet");
}

/// Boot the Stele runtime: start the local approval-bridge HTTP server
/// first so its URL can be handed to lyth_mcp via env var, then spawn
/// the Node MCP sidecar. Both startup paths are non-fatal — if either
/// fails the rest of the wallet stays usable and Stele commands surface
/// helpful errors when called.
#[cfg(feature = "stele")]
fn stele_boot(app: &mut tauri::App) {
    let app_handle = app.handle().clone();
    let sidecar_handle: tauri::State<stele::SidecarHandle> = app.state();
    let bridge_handle: tauri::State<stele::ApprovalBridgeHandle> = app.state();
    let sidecar_slot = sidecar_handle.0.clone();
    let bridge_slot = bridge_handle.0.clone();

    tauri::async_runtime::spawn(async move {
        let bridge = match stele::approval_bridge::ApprovalBridge::start(app_handle.clone()).await {
            Ok(b) => {
                eprintln!("[stele] approval bridge live at {}", b.addr);
                b
            }
            Err(e) => {
                eprintln!("[stele] approval bridge failed to start: {e}");
                return;
            }
        };
        let approval_url = bridge.url.clone();
        {
            let mut b = bridge_slot.lock().await;
            *b = Some(bridge);
        }

        match stele::mcp_sidecar::McpSidecar::spawn(Some(approval_url)).await {
            Ok(s) => {
                eprintln!("[stele] lyth_mcp sidecar ready");
                let mut slot = sidecar_slot.lock().await;
                *slot = Some(s);
            }
            Err(e) => {
                eprintln!("[stele] lyth_mcp sidecar unavailable: {e}");
            }
        }
    });
}
