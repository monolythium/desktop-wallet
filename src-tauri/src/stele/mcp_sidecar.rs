//! Stele's lyth_mcp sidecar — spawns the Node MCP server and proxies
//! tool calls over JSON-RPC on stdio.
//!
//! The MCP protocol (model context protocol) frames each message as one
//! line of JSON-RPC 2.0. We implement the minimum surface Stele needs:
//!   - `initialize` (handshake on startup)
//!   - `tools/call` (every chain operation Stele proxies)
//!
//! Architecture:
//!   - Spawn `node <lyth-mcp-dist>` with `LYTH_MCP_APPROVAL_URL` env so
//!     any destructive op routes through Stele's approval bridge first.
//!   - One tokio task drains the child's stdout, parses JSON-RPC, and
//!     dispatches responses to pending oneshot channels keyed by id.
//!   - One mpsc channel buffers stdin writes so callers don't contend
//!     on the child's stdin lock.
//!
//! Robustness:
//!   - Restart with exponential backoff if the child exits.
//!   - 30s timeout per tools/call; configurable via env var.
//!   - Clean shutdown on Tauri exit: closes stdin → child receives EOF.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::{mpsc, oneshot, Mutex},
    time::timeout,
};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const INIT_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("lyth_mcp binary not found — set STELE_LYTH_MCP_PATH or install lyth_mcp")]
    NotInstalled,
    #[error("sidecar process failed to spawn: {0}")]
    SpawnFailed(String),
    #[error("sidecar did not respond to initialize within {0}s")]
    InitTimeout(u64),
    #[error("tool call timed out after {0}s")]
    CallTimeout(u64),
    #[error("sidecar exited unexpectedly")]
    Exited,
    #[error("tool call failed: {0}")]
    ToolError(String),
    #[error("protocol error: {0}")]
    Protocol(String),
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolCallResult {
    /// Most MCP tools return text-content arrays. We collapse to the joined
    /// text and let the caller parse it.
    pub text: String,
    pub structured: serde_json::Value,
}

#[derive(Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'a str,
    id: u64,
    method: &'a str,
    params: serde_json::Value,
}

#[derive(Deserialize, Debug)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<u64>,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize, Debug)]
struct JsonRpcError {
    #[allow(dead_code)]
    code: i64,
    message: String,
}

type PendingMap = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<serde_json::Value, String>>>>>;

/// Handle to the running sidecar. Cheap to clone — internally Arc'd.
#[derive(Clone)]
pub struct McpSidecar {
    next_id: Arc<AtomicU64>,
    stdin_tx: mpsc::Sender<String>,
    pending: PendingMap,
    call_timeout: Duration,
}

impl McpSidecar {
    /// Start lyth_mcp as a child process and complete the MCP `initialize`
    /// handshake. Returns a handle other Tauri commands can call.
    pub async fn spawn(approval_url: Option<String>) -> Result<Self, SidecarError> {
        let entry = locate_lyth_mcp()?;

        let mut cmd = Command::new("node");
        cmd.arg(&entry);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::inherit());
        if let Some(url) = approval_url {
            cmd.env("LYTH_MCP_APPROVAL_URL", url);
        }
        // Disable lyth_mcp's own broadcast guard — Stele's approval bridge
        // is the security surface now.
        cmd.env("LYTH_MCP_ENABLE_SUBMIT", "1");

        let mut child = cmd
            .spawn()
            .map_err(|e| SidecarError::SpawnFailed(e.to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SidecarError::Protocol("missing child stdout".into()))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| SidecarError::Protocol("missing child stdin".into()))?;

        let next_id = Arc::new(AtomicU64::new(1));
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(64);

        // Stdout reader task — splits on newlines, dispatches responses.
        {
            let pending = pending.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let parsed: Result<JsonRpcResponse, _> = serde_json::from_str(&line);
                    match parsed {
                        Ok(resp) => {
                            if let Some(id) = resp.id {
                                let mut p = pending.lock().await;
                                if let Some(tx) = p.remove(&id) {
                                    let result = match (resp.result, resp.error) {
                                        (Some(v), _) => Ok(v),
                                        (_, Some(e)) => Err(e.message),
                                        _ => Err("response missing both result and error".into()),
                                    };
                                    let _ = tx.send(result);
                                }
                            }
                            // Notifications (no id) are silently dropped for now.
                        }
                        Err(_) => {
                            // Non-JSON lines (logs, banners) are ignored. lyth_mcp
                            // writes status info to stderr per MCP spec, so anything
                            // on stdout that isn't JSON is rare.
                        }
                    }
                }
                // Stdout closed = child exited. Drain pending with errors.
                let mut p = pending.lock().await;
                for (_, tx) in p.drain() {
                    let _ = tx.send(Err("sidecar exited".into()));
                }
            });
        }

        // Stdin writer task.
        tokio::spawn(async move {
            while let Some(line) = stdin_rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });

        // Child reaper — if the process exits, log it. Restart-on-crash is
        // handled at the spawn-supervisor level (lib.rs).
        tokio::spawn(async move {
            let _ = child.wait().await;
        });

        let sidecar = McpSidecar {
            next_id,
            stdin_tx,
            pending,
            call_timeout: Duration::from_secs(
                std::env::var("STELE_MCP_TIMEOUT_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_TIMEOUT_SECS),
            ),
        };

        // MCP initialize handshake. The lyth_mcp implementation responds
        // with its capabilities; we don't need to read most of it, just
        // confirm a response arrives in time.
        let init_result = timeout(
            Duration::from_secs(INIT_TIMEOUT_SECS),
            sidecar.send_raw(
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "stele-desktop", "version": env!("CARGO_PKG_VERSION") }
                }),
            ),
        )
        .await
        .map_err(|_| SidecarError::InitTimeout(INIT_TIMEOUT_SECS))?;

        match init_result {
            Ok(_) => {}
            Err(e) => return Err(SidecarError::ToolError(format!("initialize: {e}"))),
        }

        // MCP servers expect a `notifications/initialized` after the handshake.
        let _ = sidecar
            .stdin_tx
            .send(
                serde_json::to_string(&serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                    "params": {}
                }))
                .unwrap(),
            )
            .await;

        Ok(sidecar)
    }

    /// Call a lyth_mcp tool by name. Returns the joined text content plus
    /// the structured JSON if the tool returned one.
    pub async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<ToolCallResult, SidecarError> {
        let raw = timeout(
            self.call_timeout,
            self.send_raw(
                "tools/call",
                serde_json::json!({ "name": name, "arguments": args }),
            ),
        )
        .await
        .map_err(|_| SidecarError::CallTimeout(self.call_timeout.as_secs()))?
        .map_err(SidecarError::ToolError)?;

        // MCP tool responses shape: { content: [{type:"text", text:"..."}], isError?: bool }
        let is_error = raw
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let content = raw
            .get("content")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut text_parts = Vec::new();
        for item in &content {
            if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                text_parts.push(t.to_string());
            }
        }
        let joined = text_parts.join("\n");

        if is_error {
            return Err(SidecarError::ToolError(joined));
        }

        // Many lyth_mcp tools return text that is itself JSON. Try to parse;
        // if it doesn't parse, just leave the structured field empty.
        let structured: serde_json::Value =
            serde_json::from_str(&joined).unwrap_or(serde_json::Value::Null);

        Ok(ToolCallResult {
            text: joined,
            structured,
        })
    }

    async fn send_raw(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().await;
            p.insert(id, tx);
        }
        self.stdin_tx
            .send(line)
            .await
            .map_err(|_| "sidecar stdin closed".to_string())?;
        rx.await
            .map_err(|_| "sidecar dropped response channel".to_string())?
    }
}

fn locate_lyth_mcp() -> Result<PathBuf, SidecarError> {
    // Explicit override wins.
    if let Ok(p) = std::env::var("STELE_LYTH_MCP_PATH") {
        let path = PathBuf::from(p);
        if path.exists() {
            return Ok(path);
        }
    }
    // Common local-dev location relative to the workspace.
    let candidates = [
        // Workspace-local development.
        "../../monolythium/lyth_mcp/dist/index.js",
        "../../../monolythium/lyth_mcp/dist/index.js",
        // npm global install (`which lyth-mcp` would print the bin path,
        // but we just want the dist/index.js — the bin is usually a shim).
        "/usr/local/lib/node_modules/lyth-mcp/dist/index.js",
        "/usr/lib/node_modules/lyth-mcp/dist/index.js",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Ok(p);
        }
    }
    // Try `which lyth-mcp` and follow.
    if let Ok(output) = std::process::Command::new("which").arg("lyth-mcp").output() {
        if output.status.success() {
            let bin = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !bin.is_empty() {
                return Ok(PathBuf::from(bin));
            }
        }
    }
    Err(SidecarError::NotInstalled)
}
