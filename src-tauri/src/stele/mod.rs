//! Stele marketplace backend.
//!
//! Settings-gated feature. The `wallet.steleEnabled` localStorage flag
//! controls UI visibility from the user's side; this Cargo feature
//! (`stele`) controls whether the backend code is compiled into the
//! binary. Default `cargo build` today does not include the Stele
//! feature while the merge from `monolythium/stele-desktop` is in
//! flight; ship-time builds pass `--features stele`.
//!
//! Stage 1 (this commit) lands the module scaffolding and the shared
//! state handles registered by `lib.rs::run()`. The actual backend
//! pieces (MCP sidecar lifecycle, approval bridge HTTP server,
//! outbound MCP server, marketplace commands) port across in later
//! waves so each move is independently reviewable.
//!
//! See `the Stele integration design notes (internal)`
//! for the full picking list and phase order.

use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared handle to the lyth_mcp sidecar process. `None` until startup
/// completes (or if `lyth_mcp` is unavailable on the user's system).
/// Tauri commands that proxy through MCP read this via `tauri::State`.
#[derive(Default, Clone)]
pub struct SidecarHandle(#[allow(dead_code)] pub Arc<Mutex<Option<()>>>);

/// Shared handle to the local approval-bridge HTTP server. Used by the
/// `approval_resolve` Tauri command to dispatch user decisions back
/// into pending HTTP requests coming from `lyth_mcp`.
#[derive(Default, Clone)]
pub struct ApprovalBridgeHandle(#[allow(dead_code)] pub Arc<Mutex<Option<()>>>);

/// Shared handle to the outbound MCP server that exposes Stele to
/// external AI clients. `None` until the user enables it in
/// `Settings → MCP`.
#[derive(Default, Clone)]
pub struct OutboundMcpHandle(#[allow(dead_code)] pub Arc<Mutex<Option<()>>>);
