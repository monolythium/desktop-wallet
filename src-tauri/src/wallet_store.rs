// Wallet-owned JSON stores — the frontend names a STORE, never a path.
//
// Why this exists rather than `tauri-plugin-store`.
//
// The plugin's `load` command takes the file path FROM THE CALLER and resolves
// it with `app.path().resolve(path, BaseDirectory::AppData)`, which is a bare
// `PathBuf::push`. On Windows an absolute path, a UNC path, a verbatim-UNC path
// or a drive-relative path all DISCARD the base, and `..` survives — so the
// resolved path is not confined to the app data directory at all. It reaches
// both a write and a read, and a failed read is discarded so the caller
// continues either way.
//
// That could not be fixed with an ACL edit: the store plugin ships NO scope
// mechanism (unlike `opener`, whose commands take scope parameters), so there is
// no capability syntax that constrains which paths it will accept. The only
// remedy is to stop routing a caller-supplied path through it.
//
// So: the frontend passes an IDENTIFIER from a closed set. This module owns the
// filename, owns the directory, and never concatenates anything the caller sent.
// An unknown identifier is REFUSED — never coerced to a default, because a
// default would turn a typo into a silent write to the wrong store.
//
// PATH EQUALITY IS A REQUIREMENT, NOT A NICETY. These stores hold live data.
// Each identifier resolves to exactly the filename the plugin used, in exactly
// the directory the plugin used (`BaseDirectory::AppData` ==
// `app_data_dir()` == `%APPDATA%\<identifier>` on Windows), so existing files
// stay readable. `store_file_name` is asserted against that list in tests.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

/// Every store this wallet owns: `(identifier, file name)`.
///
/// REGISTER NEW STORES HERE. The identifier is what the frontend sends; the
/// file name is ours alone and never crosses the IPC boundary.
///
/// The file names are fixed by the data already on disk — they are not free to
/// change without a migration.
const STORES: &[(&str, &str)] = &[
    ("vaults", "vaults.v1.json"),
    ("addressbook", "addressbook.v1.json"),
    ("notifications", "notifications.v1.json"),
    ("activity", "activity.v1.json"),
    ("chain-health", "chain-health.v1.json"),
    ("sent-recipients", "sent-recipients.v1.json"),
    ("names", "names.v1.json"),
    ("pending-tx", "pending-tx.v1.json"),
    ("balance", "balance.v1.json"),
    ("agents", "agents.v1.json"),
];

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WalletStoreError {
    /// The identifier is not in the closed set. Deliberately carries no path.
    UnknownStore { store_id: String },
    /// The app data directory could not be resolved.
    NoAppDataDir { reason: String },
    /// A read or write failed.
    Io { reason: String },
    /// The stored bytes are not a JSON object.
    Malformed { reason: String },
}

impl std::fmt::Display for WalletStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownStore { store_id } => {
                write!(f, "unknown store identifier: {store_id}")
            }
            Self::NoAppDataDir { reason } => write!(f, "no app data dir: {reason}"),
            Self::Io { reason } => write!(f, "io error: {reason}"),
            Self::Malformed { reason } => write!(f, "malformed store: {reason}"),
        }
    }
}

/// The file name for an identifier, or `None` when the identifier is unknown.
///
/// The ONLY place an identifier becomes a file name. A linear scan over a fixed
/// ten-element list — the lookup is not the hot path, and a table this small
/// stays readable next to the data it describes.
pub fn store_file_name(store_id: &str) -> Option<&'static str> {
    STORES
        .iter()
        .find(|(id, _)| *id == store_id)
        .map(|(_, file)| *file)
}

/// Every registered identifier, for the tests that pin the table.
///
/// Only the test module calls this — the running app resolves identifiers one
/// at a time through `store_file_name` and never needs the whole set.
#[cfg_attr(not(test), allow(dead_code))]
pub fn store_ids() -> Vec<&'static str> {
    STORES.iter().map(|(id, _)| *id).collect()
}

/// Resolve an identifier to its absolute path.
///
/// Rejects an unknown identifier BEFORE touching the filesystem. Note what is
/// absent: nothing from the caller is ever joined onto the base. `file` is a
/// `&'static str` from the table above, so there is no input for a `..`, an
/// absolute path or a UNC prefix to arrive through.
fn store_path<R: Runtime>(app: &AppHandle<R>, store_id: &str) -> Result<PathBuf, WalletStoreError> {
    let file = store_file_name(store_id).ok_or_else(|| WalletStoreError::UnknownStore {
        store_id: store_id.to_string(),
    })?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| WalletStoreError::NoAppDataDir {
            reason: e.to_string(),
        })?;
    Ok(dir.join(file))
}

/// Read a store as a JSON object.
///
/// A missing file is an EMPTY store, not an error — that is a first run, and it
/// is the same thing the plugin did. A file that exists but does not parse is an
/// error, because silently returning `{}` for corrupt data would let the caller
/// overwrite it with a fresh document on the next save.
#[tauri::command]
pub async fn wallet_store_read<R: Runtime>(
    app: AppHandle<R>,
    store_id: String,
) -> Result<BTreeMap<String, serde_json::Value>, WalletStoreError> {
    let path = store_path(&app, &store_id)?;
    read_store_from_path(&path)
}

fn read_store_from_path(
    path: &Path,
) -> Result<BTreeMap<String, serde_json::Value>, WalletStoreError> {
    // A temp file is an interrupted write, never a committed catalog. Only the
    // final path may be loaded, even if a stale temp file happens to be valid.
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => {
            return Err(WalletStoreError::Io {
                reason: e.to_string(),
            })
        }
    };
    serde_json::from_slice(&bytes).map_err(|e| WalletStoreError::Malformed {
        reason: e.to_string(),
    })
}

/// Write a store.
///
/// Pretty-printed, matching the on-disk form these files already have so a
/// migrated file stays as readable and diffable as it was.
#[tauri::command]
pub async fn wallet_store_write<R: Runtime>(
    app: AppHandle<R>,
    store_id: String,
    contents: BTreeMap<String, serde_json::Value>,
) -> Result<(), WalletStoreError> {
    let path = store_path(&app, &store_id)?;
    let bytes = serde_json::to_vec_pretty(&contents).map_err(|e| WalletStoreError::Malformed {
        reason: e.to_string(),
    })?;
    write_store_to_path(&path, &bytes).map_err(|e| WalletStoreError::Io {
        reason: e.to_string(),
    })
}

fn create_temp_file(path: &Path) -> io::Result<(PathBuf, File)> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    for _ in 0..10 {
        let mut temp_name = std::ffi::OsString::from(".");
        temp_name.push(name);
        temp_name.push(format!(".{:016x}.tmp", OsRng.next_u64()));
        let temp_path = parent.join(temp_name);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&temp_path) {
            Ok(file) => return Ok((temp_path, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::from(io::ErrorKind::AlreadyExists))
}

fn write_store_to_path(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    fs::create_dir_all(parent)?;
    let (temp_path, mut temp) = create_temp_file(path)?;
    let result = (|| {
        temp.write_all(bytes)?;
        temp.flush()?;
        temp.sync_all()?;
        drop(temp); // Windows cannot rename an open file.
        fs::rename(&temp_path, path)?;
        #[cfg(unix)]
        {
            // Persist the directory entry after the file contents. Some Unix
            // filesystems do not support directory fsync; retain the rename.
            match File::open(parent).and_then(|dir| dir.sync_all()) {
                Ok(()) => {}
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::Unsupported | io::ErrorKind::InvalidInput
                    ) => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    })();
    if result.is_err() {
        // If the rename already succeeded, this is a harmless NotFound. On an
        // earlier failure it removes only the uncommitted temp file.
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "wallet-store-test-{}-{:016x}",
                std::process::id(),
                OsRng.next_u64()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn catalog(&self) -> PathBuf {
            self.0.join("vaults.v1.json")
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn writing_replaces_a_complete_catalog_and_leaves_no_temp_file() {
        let dir = TestDirectory::new();
        let path = dir.catalog();
        let old = br#"{"wallet":"old"}"#;
        let new = br#"{"wallet":"new","count":2}"#;
        write_store_to_path(&path, old).unwrap();
        assert_eq!(fs::read(&path).unwrap(), old);
        write_store_to_path(&path, new).unwrap();
        assert_eq!(fs::read(&path).unwrap(), new);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn interrupted_temp_file_does_not_replace_the_last_complete_catalog() {
        let dir = TestDirectory::new();
        let path = dir.catalog();
        write_store_to_path(&path, br#"{"wallet":"old"}"#).unwrap();
        fs::write(
            dir.0.join(".vaults.v1.json.abandoned.tmp"),
            br#"{"wallet":"new"}"#,
        )
        .unwrap();
        assert_eq!(read_store_from_path(&path).unwrap()["wallet"], "old");
        write_store_to_path(&path, br#"{"wallet":"latest"}"#).unwrap();
        assert_eq!(read_store_from_path(&path).unwrap()["wallet"], "latest");
    }

    #[test]
    fn temp_file_cannot_mask_a_corrupt_committed_catalog() {
        let dir = TestDirectory::new();
        let path = dir.catalog();
        fs::write(&path, b"incomplete JSON").unwrap();
        fs::write(
            dir.0.join(".vaults.v1.json.abandoned.tmp"),
            br#"{"wallet":"new"}"#,
        )
        .unwrap();
        assert!(matches!(
            read_store_from_path(&path),
            Err(WalletStoreError::Malformed { .. })
        ));
    }

    /// The file names the plugin used, and therefore the names already on disk.
    /// Changing one without a migration strands that store's data.
    const EXPECTED: &[(&str, &str)] = &[
        ("vaults", "vaults.v1.json"),
        ("addressbook", "addressbook.v1.json"),
        ("notifications", "notifications.v1.json"),
        ("activity", "activity.v1.json"),
        ("chain-health", "chain-health.v1.json"),
        ("sent-recipients", "sent-recipients.v1.json"),
        ("names", "names.v1.json"),
        ("pending-tx", "pending-tx.v1.json"),
        ("balance", "balance.v1.json"),
        ("agents", "agents.v1.json"),
    ];

    #[test]
    fn every_identifier_maps_to_the_file_name_already_on_disk() {
        // The migration proof. If this drifts, live data becomes unreachable.
        for (id, file) in EXPECTED {
            assert_eq!(
                store_file_name(id),
                Some(*file),
                "store `{id}` no longer resolves to `{file}` — existing data would be stranded"
            );
        }
        assert_eq!(
            store_ids().len(),
            EXPECTED.len(),
            "the store table gained or lost an entry without this list being updated"
        );
    }

    #[test]
    fn an_unknown_identifier_is_refused_not_defaulted() {
        // The property: refuse, never coerce. A `None` here is what makes
        // `store_path` return `UnknownStore` before touching the filesystem.
        for bogus in [
            "",
            "unknown",
            "Vaults",         // case matters
            "vaults.v1.json", // the file name is not an identifier
            "vaults ",        // no trimming
            "../vaults",
            "..",
            "../../secrets",
            "/etc/passwd",
            "C:\\Windows\\System32\\config\\SAM",
            "\\\\server\\share\\x",
            "\\\\?\\C:\\evil.json",
            "C:evil.json",
            "vaults/../../evil",
        ] {
            assert_eq!(
                store_file_name(bogus),
                None,
                "`{bogus}` resolved to a file name — an unknown identifier must be refused"
            );
        }
    }

    #[test]
    fn no_identifier_can_traverse_because_none_reaches_the_path() {
        // Anti-vacuity companion to the test above: prove the ACCEPTED
        // identifiers produce plain single-component file names, so the join
        // cannot escape even for a valid input.
        for id in store_ids() {
            let file = store_file_name(id).expect("registered id resolves");
            assert!(
                !file.contains('/') && !file.contains('\\') && !file.contains(".."),
                "`{id}` maps to `{file}`, which is not a plain file name"
            );
            assert_eq!(
                std::path::Path::new(file).components().count(),
                1,
                "`{file}` is not a single path component"
            );
        }
    }

    #[test]
    fn identifiers_are_unique() {
        let mut ids = store_ids();
        let before = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(before, ids.len(), "duplicate store identifier");
    }
}
