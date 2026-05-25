//! Tauri commands surfaced by the Stele backend.
//!
//! Today: status probe + the three address-book proxies that route
//! through the `lyth_mcp` sidecar. Marketplace commands (`vendor_search`,
//! `booking_*`, `convert_*`, `flight_*`, `x402_*`, `tx_outbox_*`, etc.)
//! port across in later slices so each move stays reviewable.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use thiserror::Error;

use super::{approval_bridge, outbound_mcp, ApprovalBridgeHandle, OutboundMcpHandle, SidecarHandle};

/// Tiny Stele-side error enum. Grows as more commands port — for now,
/// every Stele command either fails at the input boundary or at the
/// sidecar boundary.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SteleError {
    #[error("invalid input: {0}")]
    Input(String),
    #[error("lyth_mcp sidecar is not running — install lyth_mcp or check boot logs")]
    SidecarNotRunning,
    #[error("lyth_mcp tool '{tool}' failed: {message}")]
    SidecarTool { tool: String, message: String },
    #[error("not implemented yet: {0}")]
    NotImplemented(String),
}

type Result<T> = std::result::Result<T, SteleError>;

#[derive(Debug, Serialize)]
pub struct SidecarStatus {
    /// True once `McpSidecar::spawn` succeeded in the setup block. False
    /// if `lyth_mcp` is missing from the user's PATH or the spawn errored
    /// — the rest of the app stays usable, marketplace commands surface
    /// helpful errors when called.
    pub running: bool,
}

/// Query whether the lyth_mcp sidecar is live. Used by the Stele page
/// to render an honest "MCP backend: connected" badge before letting
/// the user start a booking.
#[tauri::command]
pub async fn stele_sidecar_status(
    sidecar: State<'_, SidecarHandle>,
) -> std::result::Result<SidecarStatus, String> {
    let s = sidecar.0.lock().await;
    Ok(SidecarStatus { running: s.is_some() })
}

/// Helper used by every Stele MCP-proxy command. Pulls the sidecar handle
/// out of Tauri state, returns a typed error if the sidecar isn't running.
async fn call_sidecar_tool(
    sidecar: &State<'_, SidecarHandle>,
    name: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value> {
    let guard = sidecar.0.lock().await;
    let s = guard.as_ref().ok_or(SteleError::SidecarNotRunning)?;
    let result = s
        .call_tool(name, args)
        .await
        .map_err(|e| SteleError::SidecarTool {
            tool: name.to_string(),
            message: e.to_string(),
        })?;
    if result.structured.is_null() {
        Ok(serde_json::json!({ "text": result.text }))
    } else {
        Ok(result.structured)
    }
}

// ============================================================
// Address book — three proxies into the lyth_mcp `addressbook_*` tools.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct AddressBookAddInput {
    /// Saved-recipient name (lyth_mcp calls this `name`).
    pub name: String,
    pub address: String,
    pub note: Option<String>,
    pub tags: Option<Vec<String>>,
    pub overwrite: Option<bool>,
}

#[tauri::command]
pub async fn stele_addressbook_add(
    input: AddressBookAddInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "addressbook_add",
        serde_json::json!({
            "name": input.name,
            "address": input.address,
            "note": input.note,
            "tags": input.tags,
            "overwrite": input.overwrite,
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_addressbook_lookup(
    query: Option<String>,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "addressbook_lookup",
        serde_json::json!({ "query": query }),
    )
    .await
}

#[tauri::command]
pub async fn stele_addressbook_remove(
    name: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "addressbook_remove",
        serde_json::json!({ "name": name }),
    )
    .await
}

// ============================================================
// Marketplace browse — proxy into lyth_mcp `vendor_search`.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct ListingSearchInput {
    pub query: Option<String>,
    pub category: Option<String>,
    /// Client-side filters not yet supported by lyth_mcp; we accept them
    /// for forward-compat and let the UI apply them after the call.
    pub min_rating: Option<u8>,
    pub max_price_lyth: Option<String>,
    pub near_lat: Option<f64>,
    pub near_lng: Option<f64>,
}

/// Search the on-chain discovery registry via the lyth_mcp `vendor_search`
/// tool. Filters beyond query+category are post-processed client-side
/// until lyth_mcp grows native support (see lyth-mcp-gaps §6).
#[tauri::command]
pub async fn stele_listing_search(
    input: ListingSearchInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    let _ = (input.min_rating, input.max_price_lyth, input.near_lat, input.near_lng);
    call_sidecar_tool(
        &sidecar,
        "vendor_search",
        serde_json::json!({
            "query": input.query,
            "category": input.category,
        }),
    )
    .await
}

// ============================================================
// Tx outbox — proxies into the lyth_mcp `tx_outbox_*` tools.
// ============================================================

#[tauri::command]
pub async fn stele_tx_outbox_list(
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "tx_outbox_list", serde_json::json!({})).await
}

#[tauri::command]
pub async fn stele_tx_outbox_get(
    id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "tx_outbox_get", serde_json::json!({ "id": id })).await
}

#[tauri::command]
pub async fn stele_tx_outbox_retry(
    id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "tx_outbox_retry", serde_json::json!({ "id": id })).await
}

#[tauri::command]
pub async fn stele_tx_outbox_forget(
    id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "tx_outbox_forget", serde_json::json!({ "id": id })).await
}

// ============================================================
// Bookings — proxies into lyth_mcp's booking_* tools.
// Mirror the stele-desktop wrappers so the same booking record on
// lyth_mcp's side is identifiable across both apps during the merge.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct BookingRequestInput {
    pub provider_id: String,
    pub service_id: String,
    pub date_iso: String,
    pub description: String,
    pub proposed_price_lyth: String,
    pub arbiter_id: String,
}

/// Proxy to lyth_mcp `booking_request_create`. Stele uses "provider"
/// terminology (per design brief); lyth_mcp uses "vendor" — same
/// concept, mapped here at the wire boundary.
#[tauri::command]
pub async fn stele_booking_request(
    input: BookingRequestInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "booking_request_create",
        serde_json::json!({
            "vendorId": input.provider_id,
            "service": input.description,
            "itemId": input.service_id,
            "amount": input.proposed_price_lyth,
            "requestedWindow": input.date_iso,
            "bookingFields": {},
            "notes": format!("arbiter: {}", input.arbiter_id),
        }),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct BookingCounterInput {
    pub booking_id: String,
    pub price_lyth: Option<String>,
    pub date_iso: Option<String>,
    pub note: Option<String>,
}

/// **Blocked on lyth_mcp** — needs a `booking_counter_offer` tool. Surfaces
/// a typed error pointing at the gap doc so the UI can render an honest
/// "negotiation not wired yet" message rather than a silent failure.
#[tauri::command]
pub async fn stele_booking_counter(input: BookingCounterInput) -> Result<()> {
    let _ = input;
    Err(SteleError::NotImplemented(
        "booking_counter — lyth_mcp needs a booking_counter_offer tool first \
         (tracked in stele-desktop docs/lyth-mcp-gaps.md §4)".into(),
    ))
}

/// Proxy to lyth_mcp `booking_accept_demo`. The literal `confirm` string
/// is a lyth_mcp schema safety check — Stele's approval bridge has
/// already gated the click, but the literal is still required.
#[tauri::command]
pub async fn stele_booking_accept(
    booking_id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "booking_accept_demo",
        serde_json::json!({
            "bookingId": booking_id,
            "confirm": "ACCEPT_DEMO_BOOKING",
        }),
    )
    .await
}

/// Proxy to lyth_mcp `booking_mark_paid` — the off-chain release marker.
/// Requires the on-chain tx hash of the escrow-release transaction as
/// proof, so the frontend must capture it from the signing-ceremony
/// success path before calling this.
#[tauri::command]
pub async fn stele_booking_release(
    booking_id: String,
    tx_hash: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    if tx_hash.is_empty() {
        return Err(SteleError::Input(
            "booking_release needs the tx_hash from the escrow-release transaction".into(),
        ));
    }
    call_sidecar_tool(
        &sidecar,
        "booking_mark_paid",
        serde_json::json!({ "bookingId": booking_id, "txHash": tx_hash }),
    )
    .await
}

/// Proxy to lyth_mcp `booking_dispute_demo`. The schema uses `reason`
/// (design brief calls this "evidence" — same field, different label).
#[tauri::command]
pub async fn stele_booking_dispute(
    booking_id: String,
    evidence: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "booking_dispute_demo",
        serde_json::json!({
            "bookingId": booking_id,
            "reason": evidence,
            "confirm": "OPEN_DEMO_DISPUTE",
        }),
    )
    .await
}

// ============================================================
// Outbound MCP server — exposes Stele's surface to external automation clients
// (desktop MCP clients) on a per-session loopback
// HTTP endpoint. User toggles this from Settings → Stele → MCP.
// ============================================================

#[derive(Debug, Serialize)]
pub struct McpOutboundStatus {
    pub enabled: bool,
    pub url: Option<String>,
    pub auth_token: Option<String>,
    pub scopes: Vec<String>,
}

fn outbound_scopes() -> Vec<String> {
    vec![
        "search_services".into(),
        "request_booking".into(),
        "list_my_bookings".into(),
        "accept_booking".into(),
        "release_booking".into(),
        "wallet_summary".into(),
        "convert_estimate".into(),
    ]
}

#[tauri::command]
pub async fn stele_outbound_mcp_status(
    outbound: State<'_, OutboundMcpHandle>,
) -> Result<McpOutboundStatus> {
    let s = outbound.0.lock().await;
    Ok(match s.as_ref() {
        Some(srv) => McpOutboundStatus {
            enabled: true,
            url: Some(srv.url.clone()),
            auth_token: Some(srv.auth_token.clone()),
            scopes: outbound_scopes(),
        },
        None => McpOutboundStatus {
            enabled: false,
            url: None,
            auth_token: None,
            scopes: vec![],
        },
    })
}

#[tauri::command]
pub async fn stele_outbound_mcp_start(
    app: AppHandle,
    sidecar: State<'_, SidecarHandle>,
    outbound: State<'_, OutboundMcpHandle>,
) -> Result<McpOutboundStatus> {
    {
        let s = outbound.0.lock().await;
        if let Some(srv) = s.as_ref() {
            return Ok(McpOutboundStatus {
                enabled: true,
                url: Some(srv.url.clone()),
                auth_token: Some(srv.auth_token.clone()),
                scopes: outbound_scopes(),
            });
        }
    }
    let server = outbound_mcp::OutboundMcpServer::start(app, sidecar.0.clone())
        .await
        .map_err(|e| SteleError::Input(format!("outbound MCP start failed: {e}")))?;
    let url = server.url.clone();
    let token = server.auth_token.clone();
    {
        let mut s = outbound.0.lock().await;
        *s = Some(server);
    }
    Ok(McpOutboundStatus {
        enabled: true,
        url: Some(url),
        auth_token: Some(token),
        scopes: outbound_scopes(),
    })
}

#[tauri::command]
pub async fn stele_outbound_mcp_stop(
    outbound: State<'_, OutboundMcpHandle>,
) -> Result<McpOutboundStatus> {
    let mut s = outbound.0.lock().await;
    if let Some(srv) = s.take() {
        srv.stop();
    }
    Ok(McpOutboundStatus {
        enabled: false,
        url: None,
        auth_token: None,
        scopes: vec![],
    })
}

// ============================================================
// Approval bridge — frontend resolves pending HTTP requests from
// lyth_mcp. The bridge emits `approval-required` Tauri events with
// an ApprovalEvent payload; the React overlay calls this command
// once the user approves or rejects.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct ApprovalResolveInput {
    pub request_id: String,
    pub approved: bool,
    pub wallet_passphrase: Option<String>,
    pub reason: Option<String>,
}

/// Forward the user's decision into the pending approval-bridge channel
/// so the lyth_mcp HTTP request unblocks with the right response.
#[tauri::command]
pub async fn stele_approval_resolve(
    input: ApprovalResolveInput,
    bridge: State<'_, ApprovalBridgeHandle>,
) -> Result<()> {
    let guard = bridge.0.lock().await;
    let b = guard.as_ref().ok_or_else(|| {
        SteleError::Input("approval bridge not running — restart the wallet".into())
    })?;
    let ok = b
        .resolve(
            &input.request_id,
            approval_bridge::ApprovalDecision {
                approved: input.approved,
                wallet_passphrase: input.wallet_passphrase,
                reason: input.reason,
            },
        )
        .await;
    if !ok {
        return Err(SteleError::Input(format!(
            "no pending approval matched request_id {}",
            input.request_id
        )));
    }
    Ok(())
}
