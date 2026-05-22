// Phase 7 #D19 — disk-backed IPFS metadata cache.
//
// Phase 5 shipped a 50-entry in-memory LRU with a 10-minute TTL inside
// `src/sdk/ipfs.ts`. That keeps a single browsing session snappy but
// loses everything on tab reload — every refresh re-hits the public
// gateway chain. IPFS metadata is functionally immutable per CID (CIDs
// are content-addressed), so persisting resolved blobs across sessions
// is a big win for NFT galleries.
//
// This module stores resolved metadata JSON to
//   `<app_cache_dir>/ipfs-metadata/<keccak256(uri)>.json`
// with a 30-day TTL (file mtime) and LRU eviction by atime when entry
// count exceeds CACHE_MAX_ENTRIES (500). The TypeScript resolver
// (`ipfs.ts`) calls into these commands before/after the network fetch.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;

const CACHE_DIR_NAME: &str = "ipfs-metadata";
const CACHE_TTL_SECS: u64 = 30 * 24 * 60 * 60; // 30 days
const CACHE_MAX_ENTRIES: usize = 500;

#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum IpfsCacheError {
    #[error("cache directory unavailable: {message}")]
    Unavailable { message: String },
    #[error("io error: {message}")]
    Io { message: String },
    #[error("invalid uri: {message}")]
    InvalidUri { message: String },
}

impl From<std::io::Error> for IpfsCacheError {
    fn from(e: std::io::Error) -> Self {
        IpfsCacheError::Io {
            message: e.to_string(),
        }
    }
}

/// Cache statistics — used by the Settings → Network panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpfsCacheStats {
    /// Total number of cached entries (across both valid + stale).
    pub entry_count: u32,
    /// Combined size of every cached file in bytes.
    pub total_bytes: u64,
    /// Path on disk (absolute) — surfaced in the UI for transparency.
    pub cache_dir: String,
}

// ─── State container (managed by Tauri) ────────────────────────────

pub struct IpfsCacheState {
    pub cache_dir: PathBuf,
}

impl IpfsCacheState {
    pub fn new(app_cache_dir: PathBuf) -> Self {
        let mut cache_dir = app_cache_dir;
        cache_dir.push(CACHE_DIR_NAME);
        Self { cache_dir }
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

fn key_for(uri: &str) -> String {
    if uri.is_empty() {
        return String::new();
    }
    let mut hasher = Keccak256::new();
    hasher.update(uri.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for b in digest {
        hex.push_str(&format!("{:02x}", b));
    }
    hex
}

fn entry_path(cache_dir: &Path, uri: &str) -> Option<PathBuf> {
    let key = key_for(uri);
    if key.is_empty() {
        return None;
    }
    Some(cache_dir.join(format!("{}.json", key)))
}

fn ensure_dir(cache_dir: &Path) -> Result<(), IpfsCacheError> {
    if !cache_dir.exists() {
        fs::create_dir_all(cache_dir)?;
    }
    Ok(())
}

fn touch_atime(path: &Path) {
    // Best effort — read the file metadata to nudge atime on platforms
    // that update it. Errors are ignored.
    let _ = fs::metadata(path);
}

// ─── Pure impls (testable without Tauri state) ──────────────────────

pub fn cache_get_impl(
    cache_dir: &Path,
    uri: &str,
    now: SystemTime,
) -> Result<Option<String>, IpfsCacheError> {
    let path = match entry_path(cache_dir, uri) {
        Some(p) => p,
        None => {
            return Err(IpfsCacheError::InvalidUri {
                message: "uri is empty".into(),
            });
        }
    };
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(&path)?;
    let mtime = meta.modified()?;
    let age = now.duration_since(mtime).unwrap_or(Duration::ZERO);
    if age > Duration::from_secs(CACHE_TTL_SECS) {
        // Stale — purge.
        let _ = fs::remove_file(&path);
        return Ok(None);
    }
    let body = fs::read_to_string(&path)?;
    touch_atime(&path);
    Ok(Some(body))
}

pub fn cache_set_impl(
    cache_dir: &Path,
    uri: &str,
    json: &str,
) -> Result<(), IpfsCacheError> {
    let path = match entry_path(cache_dir, uri) {
        Some(p) => p,
        None => {
            return Err(IpfsCacheError::InvalidUri {
                message: "uri is empty".into(),
            });
        }
    };
    ensure_dir(cache_dir)?;
    fs::write(&path, json)?;
    enforce_lru(cache_dir)?;
    Ok(())
}

pub fn cache_clear_impl(cache_dir: &Path) -> Result<u32, IpfsCacheError> {
    if !cache_dir.exists() {
        return Ok(0);
    }
    let mut count = 0u32;
    for entry in fs::read_dir(cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            fs::remove_file(&path)?;
            count += 1;
        }
    }
    Ok(count)
}

pub fn cache_stats_impl(cache_dir: &Path) -> Result<IpfsCacheStats, IpfsCacheError> {
    if !cache_dir.exists() {
        return Ok(IpfsCacheStats {
            entry_count: 0,
            total_bytes: 0,
            cache_dir: cache_dir.to_string_lossy().into_owned(),
        });
    }
    let mut entry_count = 0u32;
    let mut total_bytes = 0u64;
    for entry in fs::read_dir(cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
            let meta = fs::metadata(&path)?;
            total_bytes += meta.len();
            entry_count += 1;
        }
    }
    Ok(IpfsCacheStats {
        entry_count,
        total_bytes,
        cache_dir: cache_dir.to_string_lossy().into_owned(),
    })
}

/// Enforce CACHE_MAX_ENTRIES by evicting oldest entries (by atime,
/// falling back to mtime when the FS doesn't track atime).
fn enforce_lru(cache_dir: &Path) -> Result<(), IpfsCacheError> {
    if !cache_dir.exists() {
        return Ok(());
    }
    let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();
    for entry in fs::read_dir(cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let meta = fs::metadata(&path)?;
        let ts = meta.accessed().or_else(|_| meta.modified()).unwrap_or(UNIX_EPOCH);
        entries.push((path, ts));
    }
    if entries.len() <= CACHE_MAX_ENTRIES {
        return Ok(());
    }
    entries.sort_by_key(|(_, ts)| *ts);
    let to_remove = entries.len() - CACHE_MAX_ENTRIES;
    for (path, _) in entries.into_iter().take(to_remove) {
        let _ = fs::remove_file(&path);
    }
    Ok(())
}

// ─── Tauri command surface ─────────────────────────────────────────

#[tauri::command]
pub async fn ipfs_cache_get(
    uri: String,
    state: tauri::State<'_, IpfsCacheState>,
) -> Result<Option<String>, IpfsCacheError> {
    cache_get_impl(&state.cache_dir, &uri, SystemTime::now())
}

#[tauri::command]
pub async fn ipfs_cache_set(
    uri: String,
    json: String,
    state: tauri::State<'_, IpfsCacheState>,
) -> Result<(), IpfsCacheError> {
    cache_set_impl(&state.cache_dir, &uri, &json)
}

#[tauri::command]
pub async fn ipfs_cache_clear(
    state: tauri::State<'_, IpfsCacheState>,
) -> Result<u32, IpfsCacheError> {
    cache_clear_impl(&state.cache_dir)
}

#[tauri::command]
pub async fn ipfs_cache_stats(
    state: tauri::State<'_, IpfsCacheState>,
) -> Result<IpfsCacheStats, IpfsCacheError> {
    cache_stats_impl(&state.cache_dir)
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::OsRng, RngCore};
    use std::path::PathBuf;

    fn tmp_cache_dir(name: &str) -> PathBuf {
        let mut nonce = [0u8; 8];
        OsRng.fill_bytes(&mut nonce);
        let suffix: String = nonce.iter().map(|b| format!("{:02x}", b)).collect();
        let mut path = std::env::temp_dir();
        path.push(format!("mono-ipfs-cache-{}-{}", name, suffix));
        path
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn set_then_get_roundtrips_the_body() {
        let dir = tmp_cache_dir("roundtrip");
        let json = r#"{"name":"Boring Ape #7","image":"ipfs://Q.../7.png"}"#;
        cache_set_impl(&dir, "ipfs://QmTest/7", json).unwrap();
        let back = cache_get_impl(&dir, "ipfs://QmTest/7", SystemTime::now())
            .unwrap()
            .unwrap();
        assert_eq!(back, json);
        cleanup(&dir);
    }

    #[test]
    fn get_returns_none_for_missing_entry() {
        let dir = tmp_cache_dir("missing");
        let r = cache_get_impl(&dir, "ipfs://QmAbsent", SystemTime::now()).unwrap();
        assert!(r.is_none());
        cleanup(&dir);
    }

    #[test]
    fn get_evicts_stale_entry_past_ttl() {
        let dir = tmp_cache_dir("ttl");
        let json = r#"{"name":"x"}"#;
        cache_set_impl(&dir, "ipfs://QmStale", json).unwrap();
        // Read with a `now` 31 days in the future — the entry must be
        // pruned and the call must return None.
        let future = SystemTime::now() + Duration::from_secs(31 * 24 * 60 * 60);
        let r = cache_get_impl(&dir, "ipfs://QmStale", future).unwrap();
        assert!(r.is_none());
        // Subsequent fresh write succeeds (the dir still exists).
        cache_set_impl(&dir, "ipfs://QmStale", json).unwrap();
        cleanup(&dir);
    }

    #[test]
    fn stats_reports_entry_count_and_size() {
        let dir = tmp_cache_dir("stats");
        let a = r#"{"name":"a"}"#;
        let b = r#"{"name":"bb"}"#;
        cache_set_impl(&dir, "ipfs://A", a).unwrap();
        cache_set_impl(&dir, "ipfs://B", b).unwrap();
        let stats = cache_stats_impl(&dir).unwrap();
        assert_eq!(stats.entry_count, 2);
        assert_eq!(stats.total_bytes, (a.len() + b.len()) as u64);
        cleanup(&dir);
    }

    #[test]
    fn clear_purges_every_cached_entry() {
        let dir = tmp_cache_dir("clear");
        cache_set_impl(&dir, "ipfs://A", "{}").unwrap();
        cache_set_impl(&dir, "ipfs://B", "{}").unwrap();
        let removed = cache_clear_impl(&dir).unwrap();
        assert_eq!(removed, 2);
        let after = cache_stats_impl(&dir).unwrap();
        assert_eq!(after.entry_count, 0);
        cleanup(&dir);
    }

    #[test]
    fn empty_uri_is_rejected() {
        let dir = tmp_cache_dir("empty");
        let err = cache_get_impl(&dir, "", SystemTime::now()).unwrap_err();
        assert!(matches!(err, IpfsCacheError::InvalidUri { .. }));
        let err2 = cache_set_impl(&dir, "", "{}").unwrap_err();
        assert!(matches!(err2, IpfsCacheError::InvalidUri { .. }));
        cleanup(&dir);
    }

    #[test]
    fn key_for_is_deterministic_and_64_chars() {
        let k1 = key_for("ipfs://QmTest/path");
        let k2 = key_for("ipfs://QmTest/path");
        assert_eq!(k1, k2);
        assert_eq!(k1.len(), 64); // keccak256 = 32 bytes = 64 hex chars
        let other = key_for("ipfs://QmDifferent");
        assert_ne!(k1, other);
    }
}
