//! Outbound MCP server — exposes Stele's surface to external AI clients
//! (Claude Desktop, Cursor, Claude Code, etc.) as MCP tools over HTTP.
//!
//! User flow:
//!   1. User toggles "Expose wallet as MCP server" in Settings → MCP.
//!   2. Stele binds an HTTP server on 127.0.0.1:configurable-port.
//!   3. Per-session bearer token is generated and shown to the user.
//!   4. User copies the URL + token into their AI client's MCP config.
//!   5. AI client calls `tools/list`, then `tools/call` for each action.
//!
//! Protocol: minimal MCP-over-HTTP — POST `/mcp` with one JSON-RPC 2.0
//! message per request, response carries the result. Not the full
//! streamable-HTTP spec; suitable for local-only loopback use.
//!
//! Security:
//!   - 127.0.0.1 bind only.
//!   - Bearer token required on every request (rotated per toggle-on).
//!   - Every destructive tool routes through the same approval bridge
//!     the inbound sidecar uses — Claude can't book a service without
//!     the user clicking approve in Stele's overlay.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    net::SocketAddr,
    sync::Arc,
};
use tokio::{
    net::TcpListener,
    sync::{Mutex, oneshot},
    task::JoinHandle,
};
use uuid::Uuid;

use super::{
    approval_bridge::{ApprovalDecision, ApprovalRequest},
    mcp_sidecar::McpSidecar,
};

#[derive(Debug, Clone, Serialize)]
pub struct OutboundMcpStatus {
    pub enabled: bool,
    pub url: Option<String>,
    pub auth_token: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Clone)]
struct ServerState {
    token: String,
    sidecar: Arc<Mutex<Option<McpSidecar>>>,
    /// Forward approval requests from outbound MCP tools to the same
    /// frontend overlay the inbound bridge uses, so all MCP-initiated
    /// destructive ops go through one UI surface.
    bridge_app: tauri::AppHandle,
    pending_approvals: Arc<Mutex<std::collections::HashMap<String, oneshot::Sender<ApprovalDecision>>>>,
}

pub struct OutboundMcpServer {
    pub url: String,
    pub auth_token: String,
    pub addr: SocketAddr,
    handle: JoinHandle<()>,
    pub pending_approvals: Arc<Mutex<std::collections::HashMap<String, oneshot::Sender<ApprovalDecision>>>>,
}

impl OutboundMcpServer {
    pub async fn start(
        app: tauri::AppHandle,
        sidecar: Arc<Mutex<Option<McpSidecar>>>,
    ) -> std::io::Result<Self> {
        let token = Uuid::new_v4().to_string();
        let pending_approvals = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let state = ServerState {
            token: token.clone(),
            sidecar,
            bridge_app: app,
            pending_approvals: pending_approvals.clone(),
        };

        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let url = format!("http://{}/mcp", addr);

        let router = Router::new()
            .route("/mcp", post(handle_jsonrpc))
            .route("/health", post(handle_health))
            .with_state(state);

        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        Ok(OutboundMcpServer {
            url,
            auth_token: token,
            addr,
            handle,
            pending_approvals,
        })
    }

    /// Frontend → backend → resolves a pending approval request that
    /// originated from an outbound-MCP tool call (vs. inbound sidecar).
    pub async fn resolve_approval(&self, request_id: &str, decision: ApprovalDecision) -> bool {
        let mut p = self.pending_approvals.lock().await;
        if let Some(tx) = p.remove(request_id) {
            let _ = tx.send(decision);
            true
        } else {
            false
        }
    }

    pub fn stop(self) {
        self.handle.abort();
    }
}

fn auth_ok(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .map(|h| h.eq_ignore_ascii_case(&format!("bearer {}", token)))
        .unwrap_or(false)
}

#[derive(Deserialize)]
struct JsonRpcReq {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct JsonRpcRes {
    jsonrpc: &'static str,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcErr>,
}

#[derive(Serialize)]
struct JsonRpcErr {
    code: i64,
    message: String,
}

async fn handle_health() -> impl IntoResponse {
    Json(serde_json::json!({ "ok": true, "service": "stele-mcp" }))
}

async fn handle_jsonrpc(
    State(state): State<ServerState>,
    headers: HeaderMap,
    Json(req): Json<JsonRpcReq>,
) -> impl IntoResponse {
    if !auth_ok(&headers, &state.token) {
        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": "unauthorized" })));
    }
    let id = req.id.clone().unwrap_or(serde_json::Value::Null);
    let result = dispatch(&state, &req.method, req.params.unwrap_or(serde_json::Value::Null)).await;
    let res = match result {
        Ok(v) => JsonRpcRes {
            jsonrpc: "2.0",
            id,
            result: Some(v),
            error: None,
        },
        Err(e) => JsonRpcRes {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcErr {
                code: -32000,
                message: e,
            }),
        },
    };
    (StatusCode::OK, Json(serde_json::to_value(&res).unwrap()))
}

async fn dispatch(
    state: &ServerState,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match method {
        "initialize" => Ok(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "stele-desktop", "version": env!("CARGO_PKG_VERSION") }
        })),
        "tools/list" => Ok(serde_json::json!({ "tools": tool_manifest() })),
        "tools/call" => call_tool(state, params).await,
        "ping" => Ok(serde_json::json!({})),
        _ => Err(format!("method not implemented: {method}")),
    }
}

fn tool_manifest() -> serde_json::Value {
    serde_json::json!([
        {
            "name": "search_services",
            "description": "Search the Stele services marketplace for providers (lawyers, designers, pizza shops, AI agents). Filters: query, category, min_rating, max_price_lyth, near_lat/near_lng for location-relevant categories.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural language query e.g. 'crypto lawyer with DAO experience'" },
                    "category": { "type": "string" },
                    "min_rating": { "type": "number" },
                    "max_price_lyth": { "type": "string" }
                }
            }
        },
        {
            "name": "request_booking",
            "description": "Open a Stele booking with a provider. Triggers an approval prompt in Stele before any funds move. Returns the booking id.",
            "inputSchema": {
                "type": "object",
                "required": ["provider_id", "service_id", "proposed_price_lyth"],
                "properties": {
                    "provider_id": { "type": "string" },
                    "service_id": { "type": "string" },
                    "date_iso": { "type": "string" },
                    "description": { "type": "string" },
                    "proposed_price_lyth": { "type": "string" },
                    "arbiter_id": { "type": "string" }
                }
            }
        },
        {
            "name": "list_my_bookings",
            "description": "Return the active user's bookings (buying + selling). Filters by state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "role": { "type": "string", "enum": ["buying", "selling", "all"] },
                    "state": { "type": "string" }
                }
            }
        },
        {
            "name": "accept_booking",
            "description": "Accept the current terms of a booking. Both parties sign. Triggers an approval prompt.",
            "inputSchema": {
                "type": "object",
                "required": ["booking_id"],
                "properties": { "booking_id": { "type": "string" } }
            }
        },
        {
            "name": "release_booking",
            "description": "Release escrow on a delivered booking. Mandatory after work submission. Triggers an approval prompt.",
            "inputSchema": {
                "type": "object",
                "required": ["booking_id"],
                "properties": { "booking_id": { "type": "string" } }
            }
        },
        {
            "name": "wallet_summary",
            "description": "Return the wallet's name, address, and balance summary. Pass `address` (0x or mono1) — auto-inject from the active wallet is a TODO.",
            "inputSchema": {
                "type": "object",
                "required": ["address"],
                "properties": { "address": { "type": "string" } }
            }
        },
        {
            "name": "convert_estimate",
            "description": "Quote a crypto-to-crypto or crypto-to-stablecoin swap. Same engine the Convert page uses (ChangeNow via lyth_mcp).",
            "inputSchema": {
                "type": "object",
                "required": ["from_currency", "to_currency"],
                "properties": {
                    "from_currency": { "type": "string" },
                    "to_currency": { "type": "string" },
                    "from_amount": { "type": "number" },
                    "from_network": { "type": "string" },
                    "to_network": { "type": "string" },
                    "flow": { "type": "string", "enum": ["standard", "fixed-rate"] }
                }
            }
        }
    ])
}

async fn call_tool(state: &ServerState, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing tool name".to_string())?;
    let args = params.get("arguments").cloned().unwrap_or(serde_json::Value::Null);

    let result = match name {
        "search_services" => proxy_to_sidecar(state, "vendor_search", args).await,
        "request_booking" => {
            require_approval(state, name, &args).await?;
            proxy_to_sidecar(state, "booking_request_create", args).await
        }
        "list_my_bookings" => proxy_to_sidecar(state, "booking_list", args).await,
        "accept_booking" => {
            require_approval(state, name, &args).await?;
            proxy_to_sidecar(state, "booking_accept_demo", args).await
        }
        "release_booking" => {
            require_approval(state, name, &args).await?;
            proxy_to_sidecar(state, "booking_mark_paid", args).await
        }
        "wallet_summary" => {
            // lyth_mcp's `account_overview` requires `address`. Inject the
            // active wallet address from Stele's in-memory state.
            //
            // TODO(outbound-wallet-summary-address): the WalletState lives
            // in a different tauri::State than what we hold here; lift it
            // into ServerState. For v0.0.1 fail-soft if the caller didn't
            // pass an address explicitly.
            let mut merged = match args {
                serde_json::Value::Object(m) => m,
                _ => serde_json::Map::new(),
            };
            if !merged.contains_key("address") {
                return Err(
                    "wallet_summary requires an `address` argument until the active-wallet auto-inject lands"
                        .into(),
                );
            }
            proxy_to_sidecar(state, "account_overview", serde_json::Value::Object(merged)).await
        }
        "convert_estimate" => proxy_to_sidecar(state, "changenow_estimate", args).await,
        other => Err(format!("unknown tool: {other}")),
    }?;

    // MCP tools/call expects { content: [...], isError: bool }
    Ok(serde_json::json!({
        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default() }],
        "isError": false
    }))
}

async fn proxy_to_sidecar(
    state: &ServerState,
    tool_name: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let guard = state.sidecar.lock().await;
    let s = guard.as_ref().ok_or_else(|| "lyth_mcp sidecar not running".to_string())?;
    let res = s.call_tool(tool_name, args).await.map_err(|e| e.to_string())?;
    if res.structured.is_null() {
        Ok(serde_json::json!({ "text": res.text }))
    } else {
        Ok(res.structured)
    }
}

async fn require_approval(
    state: &ServerState,
    tool: &str,
    args: &serde_json::Value,
) -> Result<(), String> {
    let request_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let mut p = state.pending_approvals.lock().await;
        p.insert(request_id.clone(), tx);
    }
    let summary = match tool {
        "request_booking" => format!(
            "Claude is asking to open a booking for {} LYTH",
            args.get("proposed_price_lyth")
                .and_then(|v| v.as_str())
                .unwrap_or("?"),
        ),
        "accept_booking" => format!(
            "Claude is asking to accept booking {}",
            args.get("booking_id").and_then(|v| v.as_str()).unwrap_or("?"),
        ),
        "release_booking" => format!(
            "Claude is asking to release escrow on booking {}",
            args.get("booking_id").and_then(|v| v.as_str()).unwrap_or("?"),
        ),
        _ => format!("Claude wants to invoke {}", tool),
    };
    let req = ApprovalRequest {
        tool: tool.to_string(),
        summary,
        prepared_tx: args.clone(),
        wallet: None,
        source: Some(serde_json::json!({ "client": "Claude (outbound MCP)" })),
        expires_at: None,
    };
    let event = super::approval_bridge::ApprovalEvent {
        request_id: request_id.clone(),
        request: req,
    };
    tauri::Emitter::emit(&state.bridge_app, "approval-required", event)
        .map_err(|e| format!("emit failed: {e}"))?;

    let decision = match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
        Ok(Ok(d)) => d,
        Ok(Err(_)) | Err(_) => {
            let mut p = state.pending_approvals.lock().await;
            p.remove(&request_id);
            return Err("user did not approve in time".into());
        }
    };
    if !decision.approved {
        return Err(format!(
            "user rejected{}",
            decision.reason.map(|r| format!(": {}", r)).unwrap_or_default()
        ));
    }
    Ok(())
}
