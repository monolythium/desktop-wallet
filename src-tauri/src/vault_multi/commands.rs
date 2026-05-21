// Tauri command surface for the multi-vault container.
//
// Surface (every command returns Result<T, VaultError>):
//
//   vaults_list()                           → Vec<VaultRecordSummary>
//   vault_select(vault_id)                  → VaultRecordSummary
//   vault_unlock(password)                  → VaultRecordSummary    (active vault)
//   vault_lock()                            → ()                    (in-memory MEK wipe)
//   vault_create(label, password, seed)     → VaultRecordSummary
//   vault_rename(vault_id, new_label)       → ()
//   vault_delete(vault_id, confirm_token)   → ()
//
// `confirm_token` for delete is the last-4 chars of the lowercased
// address — anti-fat-finger gate. Constant-time compare.
//
// State (held via Tauri's `manage()`):
//
//   VaultStore = tokio::Mutex<Inner>
//   Inner {
//     container_path: PathBuf,
//     container:      Option<VaultContainerV1>,   // None when not yet loaded
//     mek:            Option<Zeroizing<[u8;32]>>, // Some only when unlocked
//     lockout:        UnlockLockout,              // 3-strike backoff
//   }
//
// Lock-state semantics: `mek = None` is "locked"; `mek = Some(…)` is
// "unlocked." `vault_lock` clears it; the auto-lock timer (Commit 10)
// invokes the same Tauri command.

use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rand::{rngs::OsRng, RngCore};
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::container::{
    VaultArgon2Params, VaultContainerV1, VaultRecord, VaultRecordSummary,
};
use super::mek::{derive_mek, generate_mek_salt, verify_password, VaultError};
use super::vek::{generate_vek, seal_payload, wrap_vek};

/// Number of failed unlocks before a hard pause kicks in. Browser-wallet
/// uses the same constant; the values are tuned for "casual fat-finger
/// vs deliberate online attack" — 3 strikes is widely cited as the
/// shoulder-surf threshold.
const UNLOCK_MAX_ATTEMPTS: u32 = 3;
/// Backoff once attempts exhausted. The constant is doubled on each
/// further failure, capped at 5 minutes.
const UNLOCK_BACKOFF_BASE: Duration = Duration::from_secs(30);
const UNLOCK_BACKOFF_CAP: Duration = Duration::from_secs(300);

/// 3-strike lockout state. Lives inside `Inner` so the Tauri-side
/// state survives across IPC calls until `vault_lock` (or process exit).
#[derive(Debug, Default)]
struct UnlockLockout {
    /// Failures since the last successful unlock.
    failed_streak: u32,
    /// When the current backoff window started; `None` if no backoff.
    backoff_started: Option<Instant>,
    /// Current backoff duration. Doubles on each failure past
    /// `UNLOCK_MAX_ATTEMPTS`, capped at `UNLOCK_BACKOFF_CAP`.
    backoff_duration: Duration,
}

impl UnlockLockout {
    /// Returns `Err(VaultError::Backend{message: "locked out for Xs"})`
    /// if the caller is still in a backoff window.
    fn check(&self) -> Result<(), VaultError> {
        let Some(started) = self.backoff_started else {
            return Ok(());
        };
        let elapsed = started.elapsed();
        if elapsed < self.backoff_duration {
            let remaining = self.backoff_duration - elapsed;
            return Err(VaultError::Backend {
                message: format!(
                    "too many failed attempts; locked out for {}s",
                    remaining.as_secs() + 1
                ),
            });
        }
        Ok(())
    }

    /// Record a failed unlock. Once the streak passes
    /// `UNLOCK_MAX_ATTEMPTS`, arms / doubles the backoff window.
    fn record_failure(&mut self) {
        self.failed_streak = self.failed_streak.saturating_add(1);
        if self.failed_streak >= UNLOCK_MAX_ATTEMPTS {
            // Arm or extend the backoff. Doubles on each extra failure
            // past the threshold; saturates at the cap.
            let new_dur = if self.backoff_duration.is_zero() {
                UNLOCK_BACKOFF_BASE
            } else {
                self.backoff_duration.saturating_mul(2)
            };
            self.backoff_duration = new_dur.min(UNLOCK_BACKOFF_CAP);
            self.backoff_started = Some(Instant::now());
        }
    }

    /// Successful unlock — reset everything.
    fn record_success(&mut self) {
        self.failed_streak = 0;
        self.backoff_started = None;
        self.backoff_duration = Duration::ZERO;
    }
}

/// Internal store state. Wrapped in `tokio::Mutex` and exposed to Tauri
/// via `manage()`.
pub struct VaultStoreInner {
    pub container_path: PathBuf,
    pub container: Option<VaultContainerV1>,
    pub mek: Option<Zeroizing<[u8; 32]>>,
    lockout: UnlockLockout,
}

impl VaultStoreInner {
    pub fn new(container_path: PathBuf) -> Self {
        Self {
            container_path,
            container: None,
            mek: None,
            lockout: UnlockLockout::default(),
        }
    }

    /// Load the container from disk into memory. NoContainer if the
    /// file doesn't exist; Backend on shape failures.
    fn load(&mut self) -> Result<(), VaultError> {
        if self.container.is_some() {
            return Ok(());
        }
        match std::fs::read(&self.container_path) {
            Ok(bytes) => {
                let container: VaultContainerV1 =
                    serde_json::from_slice(&bytes).map_err(|e| VaultError::Backend {
                        message: format!("container parse failed: {e}"),
                    })?;
                if container.version != super::CONTAINER_VERSION {
                    return Err(VaultError::Backend {
                        message: format!("unsupported container version: {}", container.version),
                    });
                }
                self.container = Some(container);
                Ok(())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(VaultError::NoContainer),
            Err(e) => Err(VaultError::Backend {
                message: format!("container read failed: {e}"),
            }),
        }
    }

    /// Persist the in-memory container to disk atomically (write to
    /// temp + rename).
    fn save(&self) -> Result<(), VaultError> {
        let container = self.container.as_ref().ok_or(VaultError::Backend {
            message: "no container to save".into(),
        })?;
        // Ensure parent dir exists.
        if let Some(parent) = self.container_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| VaultError::Backend {
                message: format!("create container dir: {e}"),
            })?;
        }
        let bytes = serde_json::to_vec(container).map_err(|e| VaultError::Backend {
            message: format!("container serialize: {e}"),
        })?;
        // Atomic: write tmp + rename. Avoids half-written files on
        // power loss / crash mid-write.
        let tmp_path = self.container_path.with_extension("v1.json.tmp");
        std::fs::write(&tmp_path, &bytes).map_err(|e| VaultError::Backend {
            message: format!("container write tmp: {e}"),
        })?;
        std::fs::rename(&tmp_path, &self.container_path).map_err(|e| VaultError::Backend {
            message: format!("container rename: {e}"),
        })?;
        Ok(())
    }
}

/// Tauri-managed store wrapper.
pub struct VaultStore(pub Mutex<VaultStoreInner>);

impl VaultStore {
    pub fn new(container_path: PathBuf) -> Self {
        Self(Mutex::new(VaultStoreInner::new(container_path)))
    }
}

// ─── Pure-Rust testable command implementations ──────────────────
// Tauri commands further down are thin wrappers around these; the
// split lets us unit-test the logic without spinning up a runtime
// or touching the filesystem (we pass a tmp PathBuf).

/// Public-facing list — returns every vault's summary. Does NOT require
/// the vault to be unlocked.
pub fn vaults_list_impl(inner: &mut VaultStoreInner) -> Result<Vec<VaultRecordSummary>, VaultError> {
    match inner.load() {
        Ok(_) => Ok(inner
            .container
            .as_ref()
            .map(|c| c.summaries())
            .unwrap_or_default()),
        Err(VaultError::NoContainer) => Ok(Vec::new()),
        Err(other) => Err(other),
    }
}

/// Switch the active vault. Requires the container to be unlocked
/// (i.e. `vault_unlock` ran successfully) so the caller can't side-
/// step the password.
pub fn vault_select_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
) -> Result<VaultRecordSummary, VaultError> {
    if inner.mek.is_none() {
        return Err(VaultError::Backend {
            message: "vault is locked".into(),
        });
    }
    inner.load()?;
    let container = inner.container.as_mut().ok_or(VaultError::NoContainer)?;
    if container.find(vault_id).is_none() {
        return Err(VaultError::NotFound {
            id: vault_id.into(),
        });
    }
    container.active_id = Some(vault_id.into());
    let summary = container
        .find(vault_id)
        .expect("just found")
        .summary(true);
    inner.save()?;
    Ok(summary)
}

/// Verify password + load the MEK into in-memory state. Returns the
/// active vault's summary.
pub fn vault_unlock_impl(
    inner: &mut VaultStoreInner,
    password: &str,
) -> Result<VaultRecordSummary, VaultError> {
    inner.lockout.check()?;
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }
    inner.load()?;
    let container = inner.container.as_ref().ok_or(VaultError::NoContainer)?;
    match verify_password(container, password.as_bytes()) {
        Ok(mek) => {
            inner.lockout.record_success();
            inner.mek = Some(mek);
            // Active vault — default to the first if not set.
            let active_id = container
                .active_id
                .clone()
                .or_else(|| container.vaults.first().map(|v| v.id.clone()))
                .ok_or(VaultError::EmptyContainer)?;
            let container_mut = inner.container.as_mut().expect("just loaded");
            container_mut.active_id = Some(active_id.clone());
            inner.save()?;
            let summary = inner
                .container
                .as_ref()
                .expect("just saved")
                .find(&active_id)
                .expect("active present")
                .summary(true);
            Ok(summary)
        }
        Err(err) => {
            if matches!(err, VaultError::WrongPassword) {
                inner.lockout.record_failure();
            }
            Err(err)
        }
    }
}

/// Wipe the in-memory MEK. Container stays loaded on disk; vault is
/// "locked" but vaults_list still works.
pub fn vault_lock_impl(inner: &mut VaultStoreInner) {
    inner.mek = None;
}

/// Create a new vault under the existing master password. If the
/// container is empty (first vault ever), `password` BECOMES the
/// master password. The caller supplies the ML-DSA-65 seed (32 bytes)
/// to seal — the TS side derives it from the PQM-1 mnemonic per the
/// existing Phase 1 path.
pub fn vault_create_impl(
    inner: &mut VaultStoreInner,
    label: &str,
    password: &str,
    seed: &[u8; 32],
    address: &str,
    now_unix: u64,
) -> Result<VaultRecordSummary, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }
    if label.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "label is empty".into(),
        });
    }
    if address.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "address is empty".into(),
        });
    }

    // Two paths depending on whether the container exists yet.
    let load_result = inner.load();

    let (mek, params, salt_b64) = match load_result {
        Ok(_) => {
            // Container exists — password must match the master.
            let container = inner.container.as_ref().expect("just loaded");
            if container.vaults.is_empty() {
                // First vault — populate salt + params now using the
                // existing-but-empty container's pre-set values
                // (commands.rs only constructs empty containers via
                // `vault_create_impl`, so this branch is rare).
                let mek = derive_mek(
                    password.as_bytes(),
                    &container.mek_salt_bytes().map_err(|_| VaultError::Backend {
                        message: "container salt malformed".into(),
                    })?,
                    &container.mek_argon_params,
                )?;
                (
                    mek,
                    container.mek_argon_params,
                    container.mek_salt.clone(),
                )
            } else {
                // Verify password against existing vaults.
                let mek = verify_password(container, password.as_bytes())?;
                (
                    mek,
                    container.mek_argon_params,
                    container.mek_salt.clone(),
                )
            }
        }
        Err(VaultError::NoContainer) => {
            // First-ever vault. Generate a fresh salt + params, derive MEK.
            let salt = generate_mek_salt();
            let params = VaultArgon2Params::recommended();
            let mek = derive_mek(password.as_bytes(), &salt, &params)?;
            let salt_b64 =
                base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, salt);
            inner.container = Some(VaultContainerV1 {
                version: super::CONTAINER_VERSION,
                mek_salt: salt_b64.clone(),
                mek_argon_params: params,
                vaults: Vec::new(),
                multisig_vaults: Vec::new(),
                active_id: None,
            });
            (mek, params, salt_b64)
        }
        Err(other) => return Err(other),
    };

    let _ = params;
    let _ = salt_b64;

    // Build the new vault record.
    let vek = generate_vek();
    let wrapped_vek = wrap_vek(&vek, &mek)?;
    let sealed_payload = seal_payload(seed, &vek)?;
    let new_id = Uuid::new_v4().to_string();
    let new_record = VaultRecord {
        id: new_id.clone(),
        label: label.into(),
        address: address.to_ascii_lowercase(),
        created_at: now_unix,
        wrapped_vek,
        sealed_payload,
    };

    let container = inner.container.as_mut().ok_or(VaultError::Backend {
        message: "container missing after load".into(),
    })?;
    container.vaults.push(new_record);
    container.active_id = Some(new_id.clone());
    inner.mek = Some(mek);
    inner.lockout.record_success();
    inner.save()?;

    Ok(inner
        .container
        .as_ref()
        .expect("just saved")
        .find(&new_id)
        .expect("just inserted")
        .summary(true))
}

/// Pure metadata update.
pub fn vault_rename_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    new_label: &str,
) -> Result<(), VaultError> {
    if new_label.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "label is empty".into(),
        });
    }
    inner.load()?;
    let container = inner.container.as_mut().ok_or(VaultError::NoContainer)?;
    let record = container.find_mut(vault_id).ok_or(VaultError::NotFound {
        id: vault_id.into(),
    })?;
    record.label = new_label.into();
    inner.save()?;
    Ok(())
}

/// Delete a vault. Confirmation token = last-4-chars of lowercased
/// address. Last-vault protection: refuses to delete the only remaining
/// vault (UI must add another first). Active-vault deletion is allowed;
/// callers should `vault_select` to a different active id first.
pub fn vault_delete_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    confirm_token: &str,
) -> Result<(), VaultError> {
    inner.load()?;
    let container = inner.container.as_mut().ok_or(VaultError::NoContainer)?;
    if container.vaults.len() <= 1 {
        return Err(VaultError::InvalidArgument {
            message: "cannot delete the only remaining vault".into(),
        });
    }
    let record = container.find(vault_id).ok_or(VaultError::NotFound {
        id: vault_id.into(),
    })?;
    let expected = record
        .address
        .to_ascii_lowercase()
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    if !constant_time_eq(expected.as_bytes(), confirm_token.as_bytes()) {
        return Err(VaultError::InvalidArgument {
            message: "confirmation token does not match".into(),
        });
    }
    container.vaults.retain(|v| v.id != vault_id);
    // If the active vault was the deleted one, pick the first remaining.
    if container.active_id.as_deref() == Some(vault_id) {
        container.active_id = container.vaults.first().map(|v| v.id.clone());
    }
    inner.save()?;
    Ok(())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ─── Tauri command thin wrappers ─────────────────────────────────

#[tauri::command]
pub async fn vaults_list(
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<VaultRecordSummary>, VaultError> {
    let mut inner = store.0.lock().await;
    vaults_list_impl(&mut inner)
}

#[tauri::command]
pub async fn vault_select(
    vault_id: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<VaultRecordSummary, VaultError> {
    let mut inner = store.0.lock().await;
    vault_select_impl(&mut inner, &vault_id)
}

#[tauri::command]
pub async fn vault_unlock_multi(
    password: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<VaultRecordSummary, VaultError> {
    let mut inner = store.0.lock().await;
    vault_unlock_impl(&mut inner, &password)
}

#[tauri::command]
pub async fn vault_lock(store: tauri::State<'_, VaultStore>) -> Result<(), VaultError> {
    let mut inner = store.0.lock().await;
    vault_lock_impl(&mut inner);
    Ok(())
}

#[tauri::command]
pub async fn vault_create_multi(
    label: String,
    password: String,
    seed: Vec<u8>,
    address: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<VaultRecordSummary, VaultError> {
    if seed.len() != 32 {
        return Err(VaultError::InvalidArgument {
            message: format!("seed must be 32 bytes, got {}", seed.len()),
        });
    }
    let mut seed_arr = [0u8; 32];
    seed_arr.copy_from_slice(&seed);
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut inner = store.0.lock().await;
    let result = vault_create_impl(&mut inner, &label, &password, &seed_arr, &address, now_unix);
    // Wipe seed bytes regardless of outcome.
    seed_arr.iter_mut().for_each(|b| *b = 0);
    // The Vec<u8> from Tauri stays in the caller's allocation; best
    // effort to zero our local copy.
    let mut zero_seed = seed;
    OsRng.fill_bytes(&mut zero_seed); // overwrite with noise, then drop
    drop(zero_seed);
    result
}

#[tauri::command]
pub async fn vault_rename(
    vault_id: String,
    new_label: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<(), VaultError> {
    let mut inner = store.0.lock().await;
    vault_rename_impl(&mut inner, &vault_id, &new_label)
}

#[tauri::command]
pub async fn vault_delete(
    vault_id: String,
    confirm_token: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<(), VaultError> {
    let mut inner = store.0.lock().await;
    vault_delete_impl(&mut inner, &vault_id, &confirm_token)
}

/// Lazy migration of the legacy single-vault blob into the v1
/// container. The TS side unseals the legacy blob first (using the
/// existing `vault_unlock` from `vault.rs`), then hands the recovered
/// seed + the master password + label + address here. Persists the
/// new container; subsequent unlocks go through the v1 path.
///
/// Returns the freshly-active vault's summary.
#[tauri::command]
pub async fn vault_migrate_legacy(
    seed: Vec<u8>,
    password: String,
    label: String,
    address: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<VaultRecordSummary, VaultError> {
    if seed.len() != 32 {
        return Err(VaultError::InvalidArgument {
            message: format!("seed must be 32 bytes, got {}", seed.len()),
        });
    }
    let mut seed_arr = [0u8; 32];
    seed_arr.copy_from_slice(&seed);
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut inner = store.0.lock().await;
    // Refuse if a container already exists — migration must not
    // clobber a real v1 container. UI should never call this in that
    // state, but defensive.
    if inner.container_path.exists() {
        seed_arr.iter_mut().for_each(|b| *b = 0);
        return Err(VaultError::InvalidArgument {
            message: "container already exists; refusing to overwrite".into(),
        });
    }
    let result = (|| -> Result<VaultRecordSummary, VaultError> {
        let container = super::migration::build_migrated_container(
            &seed_arr,
            password.as_bytes(),
            &label,
            &address,
            now_unix,
        )?;
        let active_id = container.active_id.clone().ok_or(VaultError::Backend {
            message: "migration produced container without active_id".into(),
        })?;
        inner.container = Some(container);
        // Re-derive + cache MEK so the user is unlocked immediately
        // post-migration.
        let new_container = inner.container.as_ref().expect("just set");
        let mek = super::mek::verify_password(new_container, password.as_bytes())?;
        inner.mek = Some(mek);
        inner.save()?;
        let summary = inner
            .container
            .as_ref()
            .expect("just saved")
            .find(&active_id)
            .expect("active present")
            .summary(true);
        Ok(summary)
    })();
    seed_arr.iter_mut().for_each(|b| *b = 0);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        // Suffix with a random number to avoid collisions when tests
        // run concurrently.
        let mut nonce = [0u8; 8];
        OsRng.fill_bytes(&mut nonce);
        let suffix: String = nonce.iter().map(|b| format!("{:02x}", b)).collect();
        p.push(format!("mono-vault-test-{}-{}.json", name, suffix));
        p
    }

    fn fresh_store(name: &str) -> VaultStoreInner {
        let path = tmp_path(name);
        // Ensure no stale file from a previous run.
        let _ = std::fs::remove_file(&path);
        VaultStoreInner::new(path)
    }

    fn cleanup(inner: &VaultStoreInner) {
        let _ = std::fs::remove_file(&inner.container_path);
        let _ = std::fs::remove_file(inner.container_path.with_extension("v1.json.tmp"));
    }

    // Fast-params helper isn't strictly needed for these tests because
    // we use `recommended()` parameters; the suite stays under ~1s in
    // total because each test only runs a couple of Argon2 invocations.
    // If suite time grows, swap to fast-params and wrap container
    // construction in a helper.

    #[test]
    fn list_empty_returns_empty_vec_when_no_container() {
        let mut inner = fresh_store("list_empty");
        let v = vaults_list_impl(&mut inner).unwrap();
        assert_eq!(v.len(), 0);
        cleanup(&inner);
    }

    #[test]
    fn create_first_vault_seeds_container_and_unlocks() {
        let mut inner = fresh_store("create_first");
        let seed = [9u8; 32];
        let sum = vault_create_impl(
            &mut inner,
            "Personal",
            "hunter2",
            &seed,
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            1000,
        )
        .unwrap();
        assert_eq!(sum.label, "Personal");
        assert!(sum.is_active);
        assert!(inner.mek.is_some());
        assert_eq!(inner.container.as_ref().unwrap().vaults.len(), 1);
        cleanup(&inner);
    }

    #[test]
    fn create_second_vault_requires_master_password() {
        let mut inner = fresh_store("create_second");
        let seed = [9u8; 32];
        vault_create_impl(
            &mut inner,
            "P",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        // Wrong master password for the second vault.
        let err = vault_create_impl(
            &mut inner,
            "W",
            "wrong",
            &seed,
            "0x000000000000000000000000000000000000bbbb",
            2000,
        )
        .unwrap_err();
        assert!(matches!(err, VaultError::WrongPassword));
        // Correct master password.
        let ok = vault_create_impl(
            &mut inner,
            "Work",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000bbbb",
            2000,
        )
        .unwrap();
        assert_eq!(ok.label, "Work");
        assert_eq!(inner.container.as_ref().unwrap().vaults.len(), 2);
        cleanup(&inner);
    }

    #[test]
    fn unlock_with_correct_password_succeeds() {
        let mut inner = fresh_store("unlock_ok");
        let seed = [9u8; 32];
        vault_create_impl(
            &mut inner,
            "P",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        // Simulate a lock + unlock cycle.
        vault_lock_impl(&mut inner);
        assert!(inner.mek.is_none());
        let s = vault_unlock_impl(&mut inner, "hunter2").unwrap();
        assert_eq!(s.label, "P");
        assert!(inner.mek.is_some());
        cleanup(&inner);
    }

    #[test]
    fn unlock_with_wrong_password_increments_failure_streak() {
        let mut inner = fresh_store("unlock_wrong");
        let seed = [9u8; 32];
        vault_create_impl(
            &mut inner,
            "P",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        vault_lock_impl(&mut inner);
        // Two wrong attempts.
        let _ = vault_unlock_impl(&mut inner, "wrong").unwrap_err();
        let _ = vault_unlock_impl(&mut inner, "wrong").unwrap_err();
        assert_eq!(inner.lockout.failed_streak, 2);
        // 3rd wrong → backoff armed.
        let _ = vault_unlock_impl(&mut inner, "wrong").unwrap_err();
        assert!(inner.lockout.backoff_started.is_some());
        // 4th attempt immediately is rejected by the backoff window
        // BEFORE password verification — confirms the lockout layer.
        let err = vault_unlock_impl(&mut inner, "hunter2").unwrap_err();
        assert!(matches!(err, VaultError::Backend { .. }));
        cleanup(&inner);
    }

    #[test]
    fn rename_updates_label() {
        let mut inner = fresh_store("rename");
        let seed = [9u8; 32];
        let s = vault_create_impl(
            &mut inner,
            "Old",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        vault_rename_impl(&mut inner, &s.id, "New").unwrap();
        let summaries = vaults_list_impl(&mut inner).unwrap();
        assert_eq!(summaries[0].label, "New");
        cleanup(&inner);
    }

    #[test]
    fn delete_with_correct_confirm_token_succeeds() {
        let mut inner = fresh_store("delete_ok");
        let seed = [9u8; 32];
        // Need at least 2 vaults — last-vault protection guards
        // single-vault deletion.
        vault_create_impl(
            &mut inner,
            "A",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        let b = vault_create_impl(
            &mut inner,
            "B",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000bbbb",
            2000,
        )
        .unwrap();
        // Confirm token = last-4 of lowercased address.
        let token = &b.address[b.address.len() - 4..];
        vault_delete_impl(&mut inner, &b.id, token).unwrap();
        assert_eq!(inner.container.as_ref().unwrap().vaults.len(), 1);
        cleanup(&inner);
    }

    #[test]
    fn delete_with_wrong_confirm_token_rejected() {
        let mut inner = fresh_store("delete_wrong");
        let seed = [9u8; 32];
        vault_create_impl(
            &mut inner,
            "A",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        let b = vault_create_impl(
            &mut inner,
            "B",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000bbbb",
            2000,
        )
        .unwrap();
        let err = vault_delete_impl(&mut inner, &b.id, "ffff").unwrap_err();
        assert!(matches!(err, VaultError::InvalidArgument { .. }));
        cleanup(&inner);
    }

    #[test]
    fn delete_last_vault_is_blocked() {
        let mut inner = fresh_store("delete_last");
        let seed = [9u8; 32];
        let a = vault_create_impl(
            &mut inner,
            "A",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        let token = &a.address[a.address.len() - 4..];
        let err = vault_delete_impl(&mut inner, &a.id, token).unwrap_err();
        assert!(matches!(err, VaultError::InvalidArgument { .. }));
        cleanup(&inner);
    }

    #[test]
    fn select_requires_unlock() {
        let mut inner = fresh_store("select_locked");
        let seed = [9u8; 32];
        let a = vault_create_impl(
            &mut inner,
            "A",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        vault_lock_impl(&mut inner);
        let err = vault_select_impl(&mut inner, &a.id).unwrap_err();
        assert!(matches!(err, VaultError::Backend { .. }));
        cleanup(&inner);
    }

    #[test]
    fn select_after_unlock_updates_active_id() {
        let mut inner = fresh_store("select_after_unlock");
        let seed = [9u8; 32];
        let _a = vault_create_impl(
            &mut inner,
            "A",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000aaaa",
            1000,
        )
        .unwrap();
        let b = vault_create_impl(
            &mut inner,
            "B",
            "hunter2",
            &seed,
            "0x000000000000000000000000000000000000bbbb",
            2000,
        )
        .unwrap();
        // After create-2 the active_id is `b` (create switches active).
        // Switch back to `a` via select.
        let s = vault_select_impl(&mut inner, &_a.id).unwrap();
        assert!(s.is_active);
        assert_eq!(
            inner.container.as_ref().unwrap().active_id.as_deref(),
            Some(_a.id.as_str())
        );
        assert_ne!(_a.id, b.id);
        cleanup(&inner);
    }

    #[test]
    fn constant_time_eq_matches_byte_compare() {
        assert!(constant_time_eq(b"abcd", b"abcd"));
        assert!(!constant_time_eq(b"abcd", b"abcD"));
        assert!(!constant_time_eq(b"abcd", b"abc"));
        assert!(!constant_time_eq(b"", b"x"));
        assert!(constant_time_eq(b"", b""));
    }
}
