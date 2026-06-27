//! Read-only bridge to the lyth_mcp shared wallet store at
//! `~/.lyth_mcp/wallets.json` — the Tier-3 layer per
//! `repos/monolythium/stele-desktop/docs/wallet-architecture.md`.
//!
//! This file is the desktop-wallet copy of the same bridge Stele uses.
//! The two implementations are intentionally aligned — any change must be
//! mirrored across both. See `docs/security-cross-app-wallet-visibility.md`
//! in stele-desktop for the threat model.
//!
//! Rules enforced here (hard, do not relax):
//!
//! - **Read-only.** This module never writes to the file.
//! - **Bounded read.** Refuses files larger than `MAX_STORE_BYTES`.
//! - **Defensive open.** `O_NOFOLLOW` on Unix; rejects symlinks, irregular
//!   files, wrong ownership, world-readable permissions.
//! - **Strict parsing.** Narrow types; no `serde_json::Value` in hot paths
//!   beyond the explicit pass-through fields the UI needs (low-value
//!   policy + agent metadata are opaque to this app).
//! - **No content in logs.** Error messages mention the path and error
//!   class only — never bytes from the file.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

const STORE_FILENAME: &str = "wallets.json";
const STORE_DIR: &str = ".lyth_mcp";

/// 10 MiB hard cap. Real stores are KB-scale; anything bigger is suspicious.
const MAX_STORE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum McpBridgeError {
    #[error("lyth_mcp wallet store not found at {path}")]
    NotFound { path: String },
    #[error("could not read lyth_mcp wallet store: {message}")]
    ReadError { message: String },
    #[error("lyth_mcp wallet store has unsupported schema version {version}")]
    UnsupportedSchema { version: u32 },
    #[error("lyth_mcp wallet store is malformed: {message}")]
    Malformed { message: String },
    #[error("lyth_mcp wallet store failed security checks: {message}")]
    SecurityCheck { message: String },
    #[error("home directory could not be determined")]
    NoHome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedWalletSummary {
    pub name: String,
    pub address: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
    pub algorithm: String,
    #[serde(rename = "keyProtection", default)]
    pub key_protection: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lowValue", default, skip_serializing_if = "Option::is_none")]
    pub low_value: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct StoreFile {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    wallets: Vec<serde_json::Value>,
}

/// Default path: `$HOME/.lyth_mcp/wallets.json`. Honors
/// `LYTH_MCP_WALLET_STORE` if set — same env var lyth_mcp reads itself.
pub fn default_store_path() -> Result<PathBuf, McpBridgeError> {
    if let Ok(custom) = std::env::var("LYTH_MCP_WALLET_STORE") {
        return Ok(PathBuf::from(custom));
    }
    let home = dirs_home()?;
    Ok(home.join(STORE_DIR).join(STORE_FILENAME))
}

/// Whether a shared wallet store exists on disk. Best-effort — failures
/// (permissions, broken symlinks) collapse to `false`.
pub fn store_exists() -> bool {
    match default_store_path() {
        Ok(path) => match std::fs::symlink_metadata(&path) {
            Ok(m) => m.is_file(),
            Err(_) => false,
        },
        Err(_) => false,
    }
}

/// Read + parse the shared wallet store with defensive open.
///
/// Security checks performed before parse:
/// 1. Path resolves to a regular file (not symlink, not socket, not device).
/// 2. On Unix, the file is owned by the current user and is not world-readable.
/// 3. File size <= MAX_STORE_BYTES.
///
/// Any failure short-circuits with `SecurityCheck` — the file is not parsed.
pub fn list_wallets() -> Result<Vec<SharedWalletSummary>, McpBridgeError> {
    let path = default_store_path()?;

    // Use symlink_metadata so a symlink at the path doesn't transparently
    // resolve to another file. If it's a symlink we reject.
    let meta = match std::fs::symlink_metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(McpBridgeError::NotFound {
                path: path.to_string_lossy().to_string(),
            });
        }
        Err(e) => {
            return Err(McpBridgeError::ReadError {
                message: e.kind().to_string(),
            });
        }
    };

    if meta.file_type().is_symlink() {
        return Err(McpBridgeError::SecurityCheck {
            message: "file is a symlink".into(),
        });
    }
    if !meta.is_file() {
        return Err(McpBridgeError::SecurityCheck {
            message: "not a regular file".into(),
        });
    }
    if meta.len() > MAX_STORE_BYTES {
        return Err(McpBridgeError::SecurityCheck {
            message: "file exceeds max allowed size".into(),
        });
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let current_uid = unsafe { libc::getuid() };
        if meta.uid() != current_uid {
            return Err(McpBridgeError::SecurityCheck {
                message: "file not owned by current user".into(),
            });
        }
        // Forbid world-readable / world-writable / group-writable bits.
        // Acceptable mode bits: owner read/write only (0o600 or stricter).
        let bad_bits = meta.mode() & 0o077;
        if bad_bits != 0 {
            return Err(McpBridgeError::SecurityCheck {
                message: "file is readable or writable by group/other".into(),
            });
        }
    }

    // Open with O_NOFOLLOW where supported. We've already symlink-checked
    // via metadata, but O_NOFOLLOW closes the TOCTOU window.
    #[cfg(unix)]
    let file_result = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
    };
    #[cfg(not(unix))]
    let file_result = std::fs::OpenOptions::new().read(true).open(&path);

    let file = file_result.map_err(|e| McpBridgeError::ReadError {
        message: e.kind().to_string(),
    })?;

    use std::io::Read;
    let mut buf = Vec::with_capacity(meta.len() as usize);
    file.take(MAX_STORE_BYTES)
        .read_to_end(&mut buf)
        .map_err(|e| McpBridgeError::ReadError {
            message: e.kind().to_string(),
        })?;

    let store: StoreFile = serde_json::from_slice(&buf).map_err(|e| McpBridgeError::Malformed {
        message: e.classify_string(),
    })?;
    if store.schema_version != 1 {
        return Err(McpBridgeError::UnsupportedSchema {
            version: store.schema_version,
        });
    }
    let mut out = Vec::with_capacity(store.wallets.len());
    for raw in store.wallets {
        let summary: SharedWalletSummary =
            serde_json::from_value(raw).map_err(|e| McpBridgeError::Malformed {
                message: format!("wallet entry: {}", e.classify_string()),
            })?;
        out.push(summary);
    }
    Ok(out)
}

trait ClassifyString {
    fn classify_string(&self) -> String;
}
impl ClassifyString for serde_json::Error {
    fn classify_string(&self) -> String {
        // Never echo the original message — it can contain bytes from the
        // file. Surface only the category.
        match self.classify() {
            serde_json::error::Category::Io => "io".into(),
            serde_json::error::Category::Syntax => "syntax".into(),
            serde_json::error::Category::Data => "data".into(),
            serde_json::error::Category::Eof => "eof".into(),
        }
    }
}

fn dirs_home() -> Result<PathBuf, McpBridgeError> {
    if let Some(home) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(home));
    }
    if let (Some(drive), Some(path)) = (
        std::env::var_os("HOMEDRIVE"),
        std::env::var_os("HOMEPATH"),
    ) {
        let mut p = PathBuf::from(drive);
        p.push(path);
        return Ok(p);
    }
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        return Ok(PathBuf::from(profile));
    }
    Err(McpBridgeError::NoHome)
}

// ============================================================
// Tauri command surface
// ============================================================

#[derive(Debug, Serialize)]
pub struct WalletListRow {
    /// `*.mono` name from the shared store.
    pub name: String,
    pub address: String,
    pub algorithm: String,
    /// Tier 3 = shared lyth_mcp store. Tier 2 wallets (this app's
    /// keychain) live elsewhere and are listed alongside these in the UI.
    pub tier: u8,
    pub scope: String,
    pub key_protection: Option<String>,
    pub low_value: bool,
    pub is_agent: bool,
    pub created_at: Option<String>,
}

/// Returns every Tier-3 wallet from `~/.lyth_mcp/wallets.json`. Never
/// throws — a missing or unreadable store collapses to an empty list so
/// the UI stays usable on a fresh install. The frontend merges this with
/// the desktop-wallet's own Tier-2 keychain wallets.
#[tauri::command]
pub fn mcp_shared_wallet_list() -> Vec<WalletListRow> {
    match list_wallets() {
        Ok(shared) => shared
            .into_iter()
            .map(|w| {
                let is_agent = w.name.contains(".agent.");
                WalletListRow {
                    name: w.name,
                    address: w.address,
                    algorithm: w.algorithm,
                    tier: 3,
                    scope: "shared".into(),
                    key_protection: w.key_protection,
                    low_value: w.low_value.is_some(),
                    is_agent,
                    created_at: Some(w.created_at),
                }
            })
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Whether the shared store exists. UI uses this to decide between
/// "Shared wallets (N)" and a "lyth_mcp not installed" callout.
#[tauri::command]
pub fn mcp_shared_store_exists() -> bool {
    store_exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_empty_store() {
        let json = br#"{"schemaVersion":1,"wallets":[]}"#;
        let store: StoreFile = serde_json::from_slice(json).unwrap();
        assert_eq!(store.schema_version, 1);
        assert!(store.wallets.is_empty());
    }

    #[test]
    fn parses_wallet_with_low_value() {
        let json = br#"{
            "schemaVersion": 1,
            "wallets": [{
                "name": "agent-bot.agent.alice.mono",
                "address": "monos1xyz",
                "publicKey": "abc",
                "algorithm": "ML-DSA-65",
                "keyProtection": "local_machine_key",
                "createdAt": "2026-05-23T17:00:00Z",
                "encryptedMnemonic": { "cipher": "aes-256-gcm" },
                "lowValue": { "enabled": true, "asset": "LYTH", "maxAmount": "10" }
            }]
        }"#;
        let store: StoreFile = serde_json::from_slice(json).unwrap();
        let s: SharedWalletSummary = serde_json::from_value(store.wallets[0].clone()).unwrap();
        assert_eq!(s.name, "agent-bot.agent.alice.mono");
        assert_eq!(s.key_protection.as_deref(), Some("local_machine_key"));
        assert!(s.low_value.is_some());
    }
}
