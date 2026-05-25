//! HTTP approval bridge — gives lyth_mcp a place to ask Stele for a
//! human confirmation before signing destructive operations.
//!
//! Architecture:
//!   - Bind to `127.0.0.1` on an OS-assigned port (never `0.0.0.0`).
//!   - One endpoint: `POST /approve?token=<session-bearer>`.
//!   - lyth_mcp POSTs the prepared tx + summary; we emit a Tauri event
//!     to the frontend; the frontend's MCPApproval overlay collects the
//!     user's biometric/passphrase; the result POSTs back to a Tauri
//!     command which completes the pending request.
//!
//! Security:
//!   - Loopback-only binding.
//!   - Per-session bearer token generated at startup (UUID v4) and
//!     passed to the sidecar via the URL embedded in `LYTH_MCP_APPROVAL_URL`.
//!     The token is never written to disk. A leaked URL is good for one
//!     Stele session only.
//!   - Pending request map is in-process; nothing crosses process
//!     boundaries except the JSON payloads we explicitly accept.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::Duration,
};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
    time::timeout,
};
use uuid::Uuid;

const APPROVAL_TIMEOUT_SECS: u64 = 60;

/// Inbound payload from lyth_mcp. Field names mirror what the lyth_mcp
/// side will POST (see `docs/lyth-mcp-gaps.md §7`).
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ApprovalRequest {
    pub tool: String,
    pub summary: String,
    pub prepared_tx: serde_json::Value,
    pub wallet: Option<String>,
    pub source: Option<serde_json::Value>,
    pub expires_at: Option<String>,
}

/// Reply Stele sends back, after the user resolves the overlay.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ApprovalDecision {
    pub approved: bool,
    pub wallet_passphrase: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApproveQuery {
    token: String,
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>>;

#[derive(Clone)]
struct BridgeState {
    token: String,
    pending: Pending,
    app: tauri::AppHandle,
}

#[derive(Clone)]
pub struct ApprovalBridge {
    pub url: String,
    pub token: String,
    pending: Pending,
    pub addr: SocketAddr,
}

#[derive(Debug, Serialize, Clone)]
pub struct ApprovalEvent {
    pub request_id: String,
    pub request: ApprovalRequest,
}

impl ApprovalBridge {
    /// Start the bridge on a random loopback port. Returns the bound URL +
    /// token so the caller can pass them as env vars to the sidecar.
    pub async fn start(app: tauri::AppHandle) -> std::io::Result<Self> {
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let token = Uuid::new_v4().to_string();
        let state = BridgeState {
            token: token.clone(),
            pending: pending.clone(),
            app,
        };

        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let url = format!("http://{}/approve?token={}", addr, token);

        let app = Router::new()
            .route("/approve", post(handle_approve))
            .with_state(state);

        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        Ok(ApprovalBridge {
            url,
            token,
            pending,
            addr,
        })
    }

    /// Frontend → backend path. The MCPApproval overlay calls this to
    /// resolve a pending request.
    pub async fn resolve(&self, request_id: &str, decision: ApprovalDecision) -> bool {
        let mut p = self.pending.lock().await;
        if let Some(tx) = p.remove(request_id) {
            let _ = tx.send(decision);
            true
        } else {
            false
        }
    }
}

async fn handle_approve(
    State(state): State<BridgeState>,
    Query(q): Query<ApproveQuery>,
    Json(req): Json<ApprovalRequest>,
) -> impl IntoResponse {
    if q.token != state.token {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "approved": false, "reason": "invalid_token" })),
        );
    }

    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let mut p = state.pending.lock().await;
        p.insert(request_id.clone(), tx);
    }

    // Emit to the frontend overlay. The MCPApproval React component listens
    // for "approval-required" events.
    if let Err(e) = tauri::Emitter::emit(
        &state.app,
        "approval-required",
        ApprovalEvent {
            request_id: request_id.clone(),
            request: req.clone(),
        },
    ) {
        eprintln!("[approval-bridge] emit failed: {e}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "approved": false, "reason": "emit_failed" })),
        );
    }

    // Wait for the frontend's decision.
    let decision = match timeout(Duration::from_secs(APPROVAL_TIMEOUT_SECS), rx).await {
        Ok(Ok(d)) => d,
        Ok(Err(_)) | Err(_) => {
            // Clean up pending entry on timeout.
            let mut p = state.pending.lock().await;
            p.remove(&request_id);
            ApprovalDecision {
                approved: false,
                wallet_passphrase: None,
                reason: Some("user_timeout".into()),
            }
        }
    };

    (StatusCode::OK, Json(serde_json::to_value(decision).unwrap()))
}
