//! Tauri commands surfaced by the Stele backend.
//!
//! Today: status probe + the three address-book proxies that route
//! through the `lyth_mcp` sidecar. Marketplace commands (`vendor_search`,
//! `booking_*`, `convert_*`, `flight_*`, `x402_*`, `tx_outbox_*`, etc.)
//! port across in later slices so each move stays reviewable.

use serde::{Deserialize, Serialize};
use tauri::State;
use thiserror::Error;

use super::SidecarHandle;

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
