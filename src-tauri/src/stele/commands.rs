//! Tauri commands surfaced by the Stele backend.
//!
//! Tiny scaffolding cut today — just `sidecar_status`, so the frontend
//! can prove the sidecar boot succeeded. Marketplace commands
//! (`vendor_search`, `booking_*`, `convert_*`, `flight_*`, `x402_*`,
//! `addressbook_*`, `tx_outbox_*`, etc.) port across in a later wave.

use serde::Serialize;
use tauri::State;

use super::SidecarHandle;

#[derive(Debug, Serialize)]
pub struct SidecarStatus {
    /// True once `McpSidecar::spawn` succeeded in the setup block. False
    /// if `lyth_mcp` is missing from the user's PATH or the spawn errored
    /// — the rest of the app stays usable, marketplace commands surface
    /// helpful errors when called.
    pub running: bool,
}

/// Query whether the lyth_mcp sidecar is live. Used by the Stele page
/// to render an honest "MCP backend: connected / not connected" badge
/// before letting the user start a booking.
#[tauri::command]
pub async fn stele_sidecar_status(
    sidecar: State<'_, SidecarHandle>,
) -> Result<SidecarStatus, String> {
    let s = sidecar.0.lock().await;
    Ok(SidecarStatus { running: s.is_some() })
}
