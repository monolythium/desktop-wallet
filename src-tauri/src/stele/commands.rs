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
// Outbound MCP server — exposes Stele's surface to external AI clients
// (Claude Desktop / Cursor / Claude Code) on a per-session loopback
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

// ============================================================
// Convert (ChangeNow) — crypto + fiat off-ramp proxies into
// lyth_mcp's changenow_* tools.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct ConvertEstimateInput {
    pub from_currency: String,
    pub to_currency: String,
    pub from_amount: Option<f64>,
    pub to_amount: Option<f64>,
    pub flow: Option<String>,
    pub from_network: Option<String>,
    pub to_network: Option<String>,
}

#[tauri::command]
pub async fn stele_convert_estimate(
    input: ConvertEstimateInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "changenow_estimate",
        serde_json::json!({
            "fromCurrency": input.from_currency,
            "toCurrency": input.to_currency,
            "fromAmount": input.from_amount,
            "toAmount": input.to_amount,
            "fromNetwork": input.from_network,
            "toNetwork": input.to_network,
            "flow": input.flow.unwrap_or_else(|| "standard".into()),
        }),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct ConvertCreateInput {
    pub from_currency: String,
    pub to_currency: String,
    pub from_amount: f64,
    pub payout_address: String,
    pub payout_extra_id: Option<String>,
    pub refund_address: Option<String>,
    pub flow: Option<String>,
    pub rate_id: Option<String>,
    pub from_network: Option<String>,
    pub to_network: Option<String>,
}

#[tauri::command]
pub async fn stele_convert_create(
    input: ConvertCreateInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "changenow_swap_create",
        serde_json::json!({
            "fromCurrency": input.from_currency,
            "toCurrency": input.to_currency,
            "fromAmount": input.from_amount,
            "fromNetwork": input.from_network,
            "toNetwork": input.to_network,
            "payoutAddress": input.payout_address,
            "payoutExtraId": input.payout_extra_id,
            "refundAddress": input.refund_address,
            "flow": input.flow.unwrap_or_else(|| "standard".into()),
            "rateId": input.rate_id,
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_convert_status(
    swap_id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "changenow_swap_status",
        serde_json::json!({ "id": swap_id }),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct ConvertHistoryInput {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[tauri::command]
pub async fn stele_convert_history(
    input: ConvertHistoryInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "changenow_swap_list",
        serde_json::json!({
            "limit": input.limit.unwrap_or(25),
            "offset": input.offset.unwrap_or(0),
        }),
    )
    .await
}

// ============================================================
// Natural-language search assistant — Anthropic API bridge.
// Returns hardcoded JSON today; real call wires through an Anthropic
// proxy in a later slice (API key would live in OS keychain, not env).
// ============================================================

#[derive(Debug, Serialize)]
pub struct AppVersion {
    pub version: String,
    pub name: String,
}

/// Return wallet binary name + version. Mirrors stele-desktop's
/// `app_version` so the merged build reports the same shape to anything
/// the prototype screens read it from.
#[tauri::command]
pub fn stele_app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
        name: env!("CARGO_PKG_NAME").to_string(),
    }
}

#[tauri::command]
pub async fn stele_claude_complete(prompt: String) -> Result<String> {
    let _ = prompt;
    Ok(r#"{"category":"legal","min_rating":4,"availability":"this-week","max_price":5000}"#
        .to_string())
}

// ============================================================
// Attestations — list view. lyth_mcp does not yet expose attestation
// tools; returns an empty list until that lands (tracked in
// stele-desktop docs/lyth-mcp-gaps.md §attestations).
// ============================================================

#[derive(Debug, Serialize)]
pub struct Attestation {
    pub id: String,
    pub kind: String,
    pub issuer: String,
    pub issued_iso: String,
    pub expires_iso: Option<String>,
    pub claims: serde_json::Value,
}

#[tauri::command]
pub async fn stele_attestation_list() -> Result<Vec<Attestation>> {
    Ok(vec![])
}

// ============================================================
// MCP inbound — probe a remote MCP server before attaching it to an
// agent. Stubbed until rmcp client integration lands.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct McpInboundTestInput {
    pub url: String,
    pub auth_token: String,
}

#[derive(Debug, Serialize)]
pub struct McpInboundTestOutput {
    pub ok: bool,
    pub server_name: Option<String>,
    pub tools: Vec<String>,
}

#[tauri::command]
pub async fn stele_mcp_inbound_test(input: McpInboundTestInput) -> Result<McpInboundTestOutput> {
    let _ = input;
    Err(SteleError::NotImplemented("stele_mcp_inbound_test".into()))
}

// ============================================================
// Flights — proxy into lyth_mcp `flight_*` tools (Duffel-backed).
// ============================================================

#[derive(Debug, Deserialize)]
pub struct FlightSearchInput {
    pub origin: String,
    pub destination: String,
    pub departure_date: String,
    pub return_date: Option<String>,
    pub passengers: Option<u32>,
    pub cabin: Option<String>,
}

#[tauri::command]
pub async fn stele_flight_search(
    input: FlightSearchInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    let mut slices = vec![serde_json::json!({
        "origin": input.origin,
        "destination": input.destination,
        "departureDate": input.departure_date,
    })];
    if let Some(rd) = input.return_date.as_ref() {
        slices.push(serde_json::json!({
            "origin": input.destination,
            "destination": input.origin,
            "departureDate": rd,
        }));
    }
    let pax_count = input.passengers.unwrap_or(1).max(1);
    let passengers: Vec<serde_json::Value> = (0..pax_count)
        .map(|_| serde_json::json!({ "type": "adult" }))
        .collect();
    let cabin = input
        .cabin
        .unwrap_or_else(|| "economy".into())
        .replace('-', "_");
    call_sidecar_tool(
        &sidecar,
        "flight_search",
        serde_json::json!({
            "slices": slices,
            "passengers": passengers,
            "cabinClass": cabin,
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_flight_offer_get(
    offer_id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "flight_offer_get",
        serde_json::json!({ "offerId": offer_id }),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct FlightOrderInput {
    pub offer_id: String,
    pub passenger_profiles: Option<Vec<String>>,
    pub passengers: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn stele_flight_order_hold(
    input: FlightOrderInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    if input.passenger_profiles.as_ref().map(|v| v.is_empty()).unwrap_or(true)
        && input.passengers.is_none()
    {
        return Err(SteleError::Input(
            "flight_order_hold needs either passenger_profiles or passengers".into(),
        ));
    }
    call_sidecar_tool(
        &sidecar,
        "flight_order_create_hold",
        serde_json::json!({
            "offerId": input.offer_id,
            "passengerProfiles": input.passenger_profiles,
            "passengers": input.passengers,
            "confirm": "CREATE_FLIGHT_HOLD",
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_flight_order_list(
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "flight_order_list", serde_json::json!({})).await
}

// ============================================================
// x402 — per-request agent payments. Vendor sets a policy; consumer
// pays through the policy with the wallet that owns the agent.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct X402PolicySet {
    pub vendor_id: String,
    pub wallet_name: String,
    pub origin_allowlist: Vec<String>,
    pub allowed_assets: Vec<String>,
    pub max_payment_per_request: serde_json::Value,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn stele_x402_policy_set(
    input: X402PolicySet,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "x402_vendor_policy_set",
        serde_json::json!({
            "vendorId": input.vendor_id,
            "walletName": input.wallet_name,
            "originAllowlist": input.origin_allowlist,
            "allowedAssets": input.allowed_assets,
            "maxPaymentPerRequest": input.max_payment_per_request,
            "notes": input.notes,
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_x402_policy_list(
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "x402_vendor_policy_list", serde_json::json!({})).await
}

#[tauri::command]
pub async fn stele_x402_policy_get(
    vendor_id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "x402_vendor_policy_get",
        serde_json::json!({ "vendorId": vendor_id }),
    )
    .await
}

#[tauri::command]
pub async fn stele_x402_policy_remove(
    vendor_id: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "x402_vendor_policy_remove",
        serde_json::json!({ "vendorId": vendor_id }),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct X402PayInput {
    pub vendor_id: String,
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<serde_json::Value>,
    pub body: Option<serde_json::Value>,
    pub asset_symbol_hint: Option<String>,
    pub dry_run: Option<bool>,
}

#[tauri::command]
pub async fn stele_x402_pay(
    input: X402PayInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "x402_pay",
        serde_json::json!({
            "vendorId": input.vendor_id,
            "url": input.url,
            "method": input.method.unwrap_or_else(|| "GET".into()),
            "headers": input.headers,
            "body": input.body,
            "assetSymbolHint": input.asset_symbol_hint,
            "dryRun": input.dry_run,
        }),
    )
    .await
}

// ============================================================
// Agent wallets — sub-accounts that can transact within capped limits.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct AgentWalletCreateInput {
    pub name: String,
    pub purpose: String,
    pub max_balance: Option<String>,
    pub low_value_max_amount: Option<String>,
    pub low_value_daily_limit: Option<String>,
    pub allowed_categories: Option<Vec<String>>,
    pub allowed_counterparties: Option<Vec<String>>,
    pub expires_at: Option<String>,
    pub fallback_approval: Option<String>,
}

#[tauri::command]
pub async fn stele_agent_wallet_create(
    input: AgentWalletCreateInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "agent_wallet_create",
        serde_json::json!({
            "name": input.name,
            "purpose": input.purpose,
            "confirm": "CREATE_AGENT_WALLET",
            "maxBalance": input.max_balance,
            "lowValueMaxAmount": input.low_value_max_amount,
            "lowValueDailyLimit": input.low_value_daily_limit,
            "allowedCounterparties": input.allowed_counterparties,
            "allowedCategories": input.allowed_categories,
            "expiresAt": input.expires_at,
            "fallbackApproval": input.fallback_approval,
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_agent_wallet_list(
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(&sidecar, "wallet_list", serde_json::json!({})).await
}

#[derive(Debug, Deserialize)]
pub struct AgentWalletLimitsInput {
    pub name: String,
    pub low_value_max_amount: Option<String>,
    pub low_value_daily_limit: Option<String>,
    pub max_balance: Option<String>,
    pub allowed_counterparties: Option<Vec<String>>,
    pub allowed_categories: Option<Vec<String>>,
    pub expires_at: Option<String>,
    pub fallback_approval: Option<String>,
}

#[tauri::command]
pub async fn stele_agent_wallet_limits(
    input: AgentWalletLimitsInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "agent_wallet_limits",
        serde_json::json!({
            "name": input.name,
            "confirm": "UPDATE_AGENT_WALLET_LIMITS",
            "lowValueMaxAmount": input.low_value_max_amount,
            "lowValueDailyLimit": input.low_value_daily_limit,
            "maxBalance": input.max_balance,
            "allowedCounterparties": input.allowed_counterparties,
            "allowedCategories": input.allowed_categories,
            "expiresAt": input.expires_at,
            "fallbackApproval": input.fallback_approval,
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_agent_wallet_pause(
    name: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "agent_wallet_pause",
        serde_json::json!({
            "name": name,
            "confirm": "PAUSE_AGENT_WALLET",
        }),
    )
    .await
}

#[tauri::command]
pub async fn stele_agent_wallet_delete(
    name: String,
    confirm_name: String,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    if name != confirm_name {
        return Err(SteleError::Input(
            "confirm_name must exactly equal name".into(),
        ));
    }
    call_sidecar_tool(
        &sidecar,
        "agent_wallet_delete",
        serde_json::json!({
            "name": name,
            "confirmName": confirm_name,
            "confirm": "DELETE_AGENT_WALLET",
        }),
    )
    .await
}

// ============================================================
// Spend — Coinsbee gift cards via NowPayments invoice.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct CoinsbeeGuideInput {
    pub category: Option<String>,
}

#[tauri::command]
pub async fn stele_spend_coinsbee_guide(
    input: CoinsbeeGuideInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "coinsbee_guide",
        serde_json::json!({ "category": input.category }),
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct SpendCoinsbeeInvoiceInput {
    pub usd_amount: f64,
    pub pay_currency: String,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn stele_spend_coinsbee_invoice(
    input: SpendCoinsbeeInvoiceInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "nowpayments_invoice_create",
        serde_json::json!({
            "priceAmount": input.usd_amount,
            "priceCurrency": "usd",
            "payCurrency": input.pay_currency.to_lowercase(),
            "orderId": format!("stele-spend-{}", uuid::Uuid::new_v4()),
            "orderDescription": input
                .description
                .unwrap_or_else(|| "Stele spend — Coinsbee gift card".into()),
        }),
    )
    .await
}

// ============================================================
// Booking invoice — NowPayments invoice for a booking's USD price.
// ============================================================

#[derive(Debug, Deserialize)]
pub struct BookingInvoiceInput {
    pub booking_id: String,
    pub price_usd: f64,
    pub pay_currency: String,
}

#[tauri::command]
pub async fn stele_booking_invoice_create(
    input: BookingInvoiceInput,
    sidecar: State<'_, SidecarHandle>,
) -> Result<serde_json::Value> {
    call_sidecar_tool(
        &sidecar,
        "nowpayments_invoice_create",
        serde_json::json!({
            "priceAmount": input.price_usd,
            "priceCurrency": "usd",
            "payCurrency": input.pay_currency.to_lowercase(),
            "orderId": format!("stele-booking-{}", input.booking_id),
            "orderDescription": format!(
                "Stele booking {} — payment in {}",
                input.booking_id, input.pay_currency
            ),
        }),
    )
    .await
}
