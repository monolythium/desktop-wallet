// Stele backend is being ported in waves from `monolythium/stele-desktop`.
// Until the spawn block + Tauri commands wire in (next wave), the platform
// code (sidecar + approval bridge + outbound MCP) compiles but isn't yet
// called from anywhere. Allow dead_code module-wide for the duration of
// the port; tighten back to per-symbol allows once the wiring lands.
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_mut)]

//! Stele marketplace backend.
//!
//! Settings-gated feature. The `wallet.steleEnabled` localStorage flag
//! controls UI visibility from the user's side; this Cargo feature
//! (`stele`) controls whether the backend code is compiled into the
//! binary. Default `cargo build` today does not include the Stele
//! feature while the merge from `monolythium/stele-desktop` is in
//! flight; ship-time builds pass `--features stele`.
//!
//! Module layout mirrors the source repo for porting clarity:
//! - `approval_bridge` — loopback HTTP server that lets `lyth_mcp` ask
//!   Stele for a human confirmation before signing destructive ops.
//! - `mcp_sidecar` — spawns the Node `lyth_mcp` server and proxies
//!   tool calls over JSON-RPC stdio.
//! - `outbound_mcp` — exposes Stele's surface to external AI clients
//!   (Claude Desktop, Cursor, Claude Code) over a loopback MCP server.
//!
//! Marketplace commands (`booking_*`, `vendor_search`, `convert_*`,
//! `flight_*`, `x402_*`, etc.) port across in a later wave so each
//! move stays reviewable on its own.
//!
//! See `the Stele integration design notes (internal)`
//! for the full picking list and phase order.

pub mod approval_bridge;
pub mod mcp_sidecar;
pub mod outbound_mcp;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared handle to the lyth_mcp sidecar process. `None` until startup
/// completes (or if `lyth_mcp` is unavailable on the user's system).
/// Tauri commands that proxy through MCP read this via `tauri::State`.
#[derive(Default, Clone)]
pub struct SidecarHandle(#[allow(dead_code)] pub Arc<Mutex<Option<mcp_sidecar::McpSidecar>>>);

/// Shared handle to the local approval-bridge HTTP server. Used by the
/// `approval_resolve` Tauri command to dispatch user decisions back
/// into pending HTTP requests coming from `lyth_mcp`.
#[derive(Default, Clone)]
pub struct ApprovalBridgeHandle(
    #[allow(dead_code)] pub Arc<Mutex<Option<approval_bridge::ApprovalBridge>>>,
);

/// Shared handle to the outbound MCP server that exposes Stele to
/// external AI clients. `None` until the user enables it in
/// `Settings → MCP`.
#[derive(Default, Clone)]
pub struct OutboundMcpHandle(
    #[allow(dead_code)] pub Arc<Mutex<Option<outbound_mcp::OutboundMcpServer>>>,
);
