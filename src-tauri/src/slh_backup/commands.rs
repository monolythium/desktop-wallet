// Tauri command surface for the SLH-DSA emergency backup.
//
// Surface (every command returns Result<T, SlhCommandError>):
//
//   slh_enroll_backup(vault_id, recovery_password)
//       -> { entropy_b64, public_key_b64 }
//   slh_get_backup_status(vault_id) -> SlhBackupStatus
//   slh_test_recovery(vault_id, recovery_password, entropy_b64)
//       -> bool   (true iff inputs match the enrolled backup)
//   slh_remove_backup(vault_id, master_password, recovery_password)
//       -> ()
//
// The actual recovery flow (which re-keys the vault under a new
// master password using the recovered SLH key) lives in Commit 11
// (`recover_with_slh_backup` command).
//
// Dual-slot storage
// =================
// `sealed_secret`  — 64-byte SLH-DSA secret sealed under the
//                    vault's VEK; accessible whenever the vault is
//                    unlocked. Used by the rotation path that
//                    re-derives a fresh ML-DSA key from the SLH-
//                    backup (out of scope for Phase 8).
// `sealed_entropy` — 32-byte BIP-39 entropy sealed under a key
//                    derived from the recovery password via
//                    Argon2id. The recovery flow needs this slot
//                    when the master password is lost (the user
//                    types in the recovery password AND the 24-word
//                    mnemonic; the mnemonic decodes to the entropy
//                    used to verify against this sealed slot).
//
// Both slots share the same payload-AEAD primitive (AES-256-GCM
// from the existing Phase 5 vault code) — only the keying material
// differs.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use zeroize::Zeroizing;

use super::keys::{
    generate_slh_keypair, generate_slh_keypair_from_entropy, SlhBackupError,
    SlhPublicKey, SLH_ENTROPY_LEN, SLH_PK_LEN, SLH_SK_LEN,
};
use crate::vault_multi::commands::{VaultStore, VaultStoreInner};
use crate::vault_multi::container::{
    SealedPayload, VaultArgon2Params, GCM_NONCE_LEN, MEK_SALT_LEN,
};
use crate::vault_multi::mek::{derive_mek, verify_password, VaultError};
use crate::vault_multi::vek::{open_payload, seal_payload, unwrap_vek};

/// On-disk record. Lives inside `VaultRecord.slh_backup`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlhBackupRecord {
    /// base64url-no-pad encoded 32-byte SLH-DSA public key.
    pub public_key: String,
    /// 64-byte SLH-DSA secret sealed under the vault's VEK.
    pub sealed_secret: SealedPayload,
    /// 32-byte BIP-39 entropy sealed under the recovery-password
    /// Argon2id derivation.
    pub sealed_entropy: SealedPayload,
    /// base64url-no-pad encoded 16-byte salt used to derive the
    /// recovery key from the recovery password.
    pub recovery_salt: String,
    /// Recovery-key Argon2id parameters. Same OWASP defaults as
    /// `VaultArgon2Params::recommended()` so the recovery cost is
    /// matched to the master-password cost.
    pub recovery_argon_params: VaultArgon2Params,
    pub created_at: u64,
    /// `true` once the recovery flow has consumed this backup. After
    /// activation the SLH-DSA pubkey becomes the active signing key
    /// (until a fresh ML-DSA-65 key is re-derived — out of scope
    /// for Phase 8).
    #[serde(default)]
    pub activated: bool,
    /// UNIX seconds at activation, `None` until then.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activated_at: Option<u64>,
}

/// UI-facing status payload (no secret material).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SlhBackupStatus {
    NotEnrolled,
    Enrolled { created_at: u64 },
    Activated { created_at: u64, activated_at: u64 },
}

impl SlhBackupRecord {
    pub fn status(&self) -> SlhBackupStatus {
        if self.activated {
            SlhBackupStatus::Activated {
                created_at: self.created_at,
                activated_at: self.activated_at.unwrap_or(self.created_at),
            }
        } else {
            SlhBackupStatus::Enrolled {
                created_at: self.created_at,
            }
        }
    }
}

#[derive(Debug, Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SlhCommandError {
    #[error("vault is locked")]
    VaultLocked,
    #[error("vault not found: {id}")]
    VaultNotFound { id: String },
    #[error("backup is already enrolled")]
    AlreadyEnrolled,
    #[error("backup not enrolled")]
    NotEnrolled,
    #[error("wrong master password")]
    WrongMasterPassword,
    #[error("wrong recovery password")]
    WrongRecoveryPassword,
    #[error("recovery password too weak (min 12 chars)")]
    RecoveryPasswordTooWeak,
    #[error("invalid entropy length (must be {expected} bytes)")]
    InvalidEntropyLength { expected: usize },
    #[error("malformed payload")]
    Malformed,
    #[error("internal crypto error")]
    Crypto,
    #[error("backend error: {message}")]
    Backend { message: String },
}

impl From<SlhBackupError> for SlhCommandError {
    fn from(e: SlhBackupError) -> Self {
        match e {
            SlhBackupError::InvalidEntropy { expected } => {
                Self::InvalidEntropyLength { expected }
            }
            SlhBackupError::Keygen
            | SlhBackupError::Sign
            | SlhBackupError::Verify => Self::Crypto,
            SlhBackupError::Malformed => Self::Malformed,
        }
    }
}

impl From<VaultError> for SlhCommandError {
    fn from(e: VaultError) -> Self {
        match e {
            VaultError::WrongPassword => Self::WrongMasterPassword,
            VaultError::NotFound { id } => Self::VaultNotFound { id },
            VaultError::InvalidArgument { message } | VaultError::Backend { message } => {
                Self::Backend { message }
            }
            VaultError::NoContainer => Self::Backend {
                message: "no vault container".into(),
            },
            VaultError::EmptyContainer => Self::Backend {
                message: "empty container".into(),
            },
        }
    }
}

/// Payload returned by `slh_enroll_backup`. The `entropy_b64` field
/// is the 32-byte BIP-39 entropy the caller needs to encode into a
/// 24-word mnemonic for the user. Caller MUST not persist it — the
/// only durable copies are the user's written mnemonic + the
/// AEAD-sealed entropy in the vault container.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlhEnrollResult {
    pub entropy_b64: String,
    pub public_key_b64: String,
    pub created_at: u64,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn require_unlocked(inner: &VaultStoreInner) -> Result<[u8; 32], SlhCommandError> {
    let zeroizing = inner.mek.as_ref().ok_or(SlhCommandError::VaultLocked)?;
    let mut out = [0u8; 32];
    out.copy_from_slice(zeroizing.as_ref());
    Ok(out)
}

/// Derive the recovery key from the recovery password + salt via
/// Argon2id. Returns a Zeroizing 32-byte key suitable for the AES-
/// GCM seal/open of the entropy slot.
fn derive_recovery_key(
    password: &str,
    salt: &[u8; MEK_SALT_LEN],
    params: &VaultArgon2Params,
) -> Result<Zeroizing<[u8; 32]>, SlhCommandError> {
    if password.len() < 12 {
        return Err(SlhCommandError::RecoveryPasswordTooWeak);
    }
    let key = derive_mek(password.as_bytes(), salt, params).map_err(SlhCommandError::from)?;
    Ok(key)
}

// ─── Pure-Rust testable impls ─────────────────────────────────────

pub fn slh_enroll_backup_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    recovery_password: &str,
    now: u64,
) -> Result<SlhEnrollResult, SlhCommandError> {
    let mek = require_unlocked(inner)?;
    inner.load().map_err(SlhCommandError::from)?;

    // Validate the recovery password BEFORE any keygen work.
    if recovery_password.len() < 12 {
        return Err(SlhCommandError::RecoveryPasswordTooWeak);
    }

    let container = inner.container.as_ref().ok_or(SlhCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find(vault_id).ok_or(SlhCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    if vault.slh_backup.is_some() {
        return Err(SlhCommandError::AlreadyEnrolled);
    }
    let vek = unwrap_vek(&vault.wrapped_vek, &mek).map_err(SlhCommandError::from)?;

    // Live-enrolment keygen (fresh entropy + deterministic
    // expansion). The entropy is returned to the TS layer so it can
    // be rendered to the user as a 24-word mnemonic.
    let (pk, sk, entropy) = generate_slh_keypair()?;

    // Seal the secret under VEK.
    let sealed_secret =
        seal_payload(sk.as_bytes(), &vek).map_err(SlhCommandError::from)?;

    // Derive the recovery key + seal the entropy under it.
    let mut salt = [0u8; MEK_SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let recovery_params = VaultArgon2Params::recommended();
    let recovery_key = derive_recovery_key(recovery_password, &salt, &recovery_params)?;
    let sealed_entropy =
        seal_payload(entropy.as_ref(), &recovery_key).map_err(SlhCommandError::from)?;

    let record = SlhBackupRecord {
        public_key: URL_SAFE_NO_PAD.encode(pk.as_bytes()),
        sealed_secret,
        sealed_entropy,
        recovery_salt: URL_SAFE_NO_PAD.encode(salt),
        recovery_argon_params: recovery_params,
        created_at: now,
        activated: false,
        activated_at: None,
    };

    // Build the return payload BEFORE persisting (entropy is the
    // sensitive piece — we need it for the caller, the record is
    // already stored).
    let entropy_b64 = URL_SAFE_NO_PAD.encode(entropy.as_ref());
    let public_key_b64 = record.public_key.clone();

    let container = inner.container.as_mut().ok_or(SlhCommandError::Backend {
        message: "container vanished".into(),
    })?;
    let vault = container.find_mut(vault_id).ok_or(SlhCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    vault.slh_backup = Some(record);
    inner.save().map_err(SlhCommandError::from)?;

    Ok(SlhEnrollResult {
        entropy_b64,
        public_key_b64,
        created_at: now,
    })
}

pub fn slh_get_backup_status_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
) -> Result<SlhBackupStatus, SlhCommandError> {
    inner.load().map_err(SlhCommandError::from)?;
    let container = inner.container.as_ref().ok_or(SlhCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find(vault_id).ok_or(SlhCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    Ok(match &vault.slh_backup {
        Some(rec) => rec.status(),
        None => SlhBackupStatus::NotEnrolled,
    })
}

pub fn slh_test_recovery_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    recovery_password: &str,
    entropy_b64: &str,
) -> Result<bool, SlhCommandError> {
    inner.load().map_err(SlhCommandError::from)?;
    let container = inner.container.as_ref().ok_or(SlhCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find(vault_id).ok_or(SlhCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    let record = vault
        .slh_backup
        .as_ref()
        .ok_or(SlhCommandError::NotEnrolled)?;

    // Re-derive the recovery key.
    let salt_bytes = URL_SAFE_NO_PAD
        .decode(&record.recovery_salt)
        .map_err(|_| SlhCommandError::Malformed)?;
    if salt_bytes.len() != MEK_SALT_LEN {
        return Err(SlhCommandError::Malformed);
    }
    let mut salt = [0u8; MEK_SALT_LEN];
    salt.copy_from_slice(&salt_bytes);
    let recovery_key =
        derive_recovery_key(recovery_password, &salt, &record.recovery_argon_params)?;

    // Decode the user-supplied entropy.
    let supplied_entropy_vec = URL_SAFE_NO_PAD
        .decode(entropy_b64)
        .map_err(|_| SlhCommandError::Malformed)?;
    if supplied_entropy_vec.len() != SLH_ENTROPY_LEN {
        return Err(SlhCommandError::InvalidEntropyLength {
            expected: SLH_ENTROPY_LEN,
        });
    }
    let mut supplied_entropy = [0u8; SLH_ENTROPY_LEN];
    supplied_entropy.copy_from_slice(&supplied_entropy_vec);

    // Try to open the sealed entropy with the derived recovery key.
    // Wrong recovery password → AEAD tag failure → `false`.
    let stored_entropy_z = match open_payload(&record.sealed_entropy, &recovery_key) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    if stored_entropy_z.len() != SLH_ENTROPY_LEN {
        return Err(SlhCommandError::Malformed);
    }
    let mut stored_entropy = [0u8; SLH_ENTROPY_LEN];
    stored_entropy.copy_from_slice(&stored_entropy_z[..]);

    // Compare stored entropy against supplied entropy. Constant-time
    // is overkill here (the user already authenticated via the
    // recovery password) but cheap.
    let mut diff: u8 = 0;
    for (a, b) in stored_entropy.iter().zip(supplied_entropy.iter()) {
        diff |= a ^ b;
    }
    if diff != 0 {
        return Ok(false);
    }

    // Defence-in-depth: regenerate the keypair from the entropy and
    // assert the public key matches the stored one. Mismatch here
    // would indicate either a corrupted record or a wallet-version
    // skew on the SHAKE256 derivation tag.
    let (regenerated_pk, _) = generate_slh_keypair_from_entropy(&supplied_entropy)?;
    let stored_pk = URL_SAFE_NO_PAD
        .decode(&record.public_key)
        .map_err(|_| SlhCommandError::Malformed)?;
    if regenerated_pk.as_bytes().as_slice() != stored_pk.as_slice() {
        return Ok(false);
    }
    Ok(true)
}

/// Activate the recovery — the Beta-critical path for §30.1. Given
/// the user-supplied recovery password + the 32-byte entropy
/// decoded from their written mnemonic, this:
///
///   1. Re-derives the recovery key from the password + stored salt
///   2. Opens the sealed_entropy slot — failure ⇒ wrong password
///   3. Byte-compares the stored entropy with the supplied one
///   4. Regenerates the SLH-DSA keypair from the supplied entropy
///      and asserts the pubkey matches the stored pubkey (defense-
///      in-depth)
///   5. Marks the backup as `activated = true` with the timestamp
///
/// Phase 8 scope: this does NOT re-key the vault's ML-DSA-65
/// sealed_payload under a new master password — that's a separate
/// operation deferred to Phase 9 (carries policy + ownership-proof
/// implications). The activation flag is enough for the chain-side
/// emergency-key precompile at 0x1100 to start accepting SLH-DSA
/// signatures from this vault's backup pubkey (chain GAP — see
/// Phase 8 final report).
///
/// Unlike enrolment, activation does NOT require the vault to be
/// unlocked. The whole point of the flow is that the user has lost
/// their master password.
pub fn slh_activate_recovery_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    recovery_password: &str,
    entropy_b64: &str,
    now: u64,
) -> Result<SlhBackupStatus, SlhCommandError> {
    inner.load().map_err(SlhCommandError::from)?;

    // Read-only validation phase first — we don't mutate until every
    // input is verified.
    let (verified, _stored_pubkey_bytes) = {
        let container = inner.container.as_ref().ok_or(SlhCommandError::Backend {
            message: "container missing".into(),
        })?;
        let vault = container
            .find(vault_id)
            .ok_or(SlhCommandError::VaultNotFound {
                id: vault_id.into(),
            })?;
        let record = vault
            .slh_backup
            .as_ref()
            .ok_or(SlhCommandError::NotEnrolled)?;

        // Re-derive the recovery key.
        let salt_bytes = URL_SAFE_NO_PAD
            .decode(&record.recovery_salt)
            .map_err(|_| SlhCommandError::Malformed)?;
        if salt_bytes.len() != MEK_SALT_LEN {
            return Err(SlhCommandError::Malformed);
        }
        let mut salt = [0u8; MEK_SALT_LEN];
        salt.copy_from_slice(&salt_bytes);
        let recovery_key = derive_recovery_key(
            recovery_password,
            &salt,
            &record.recovery_argon_params,
        )?;

        // Decode the user-supplied entropy.
        let supplied_vec = URL_SAFE_NO_PAD
            .decode(entropy_b64)
            .map_err(|_| SlhCommandError::Malformed)?;
        if supplied_vec.len() != SLH_ENTROPY_LEN {
            return Err(SlhCommandError::InvalidEntropyLength {
                expected: SLH_ENTROPY_LEN,
            });
        }
        let mut supplied = [0u8; SLH_ENTROPY_LEN];
        supplied.copy_from_slice(&supplied_vec);

        // Open the stored entropy slot — wrong recovery password
        // surfaces here as an AEAD tag failure.
        let stored_z = open_payload(&record.sealed_entropy, &recovery_key)
            .map_err(|_| SlhCommandError::WrongRecoveryPassword)?;
        if stored_z.len() != SLH_ENTROPY_LEN {
            return Err(SlhCommandError::Malformed);
        }
        let mut stored = [0u8; SLH_ENTROPY_LEN];
        stored.copy_from_slice(&stored_z[..]);

        // Constant-time entropy compare.
        let mut diff: u8 = 0;
        for (a, b) in stored.iter().zip(supplied.iter()) {
            diff |= a ^ b;
        }
        if diff != 0 {
            return Err(SlhCommandError::WrongRecoveryPassword);
        }

        // Regenerate keypair from supplied entropy + assert match
        // against stored pubkey.
        let (regenerated_pk, _) = generate_slh_keypair_from_entropy(&supplied)?;
        let stored_pubkey = URL_SAFE_NO_PAD
            .decode(&record.public_key)
            .map_err(|_| SlhCommandError::Malformed)?;
        if regenerated_pk.as_bytes().as_slice() != stored_pubkey.as_slice() {
            return Err(SlhCommandError::Malformed);
        }

        (true, stored_pubkey)
    };
    debug_assert!(verified);

    // Mutation phase — mark the backup activated.
    let container = inner.container.as_mut().ok_or(SlhCommandError::Backend {
        message: "container vanished".into(),
    })?;
    let vault = container
        .find_mut(vault_id)
        .ok_or(SlhCommandError::VaultNotFound {
            id: vault_id.into(),
        })?;
    let record = vault
        .slh_backup
        .as_mut()
        .ok_or(SlhCommandError::NotEnrolled)?;
    record.activated = true;
    record.activated_at = Some(now);
    let new_status = record.status();
    inner.save().map_err(SlhCommandError::from)?;
    Ok(new_status)
}

pub fn slh_remove_backup_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    master_password: &str,
    recovery_password: &str,
) -> Result<(), SlhCommandError> {
    let _ = require_unlocked(inner)?;
    inner.load().map_err(SlhCommandError::from)?;

    // Master-password re-confirmation.
    {
        let container = inner.container.as_ref().ok_or(SlhCommandError::Backend {
            message: "container missing".into(),
        })?;
        let _ = verify_password(container, master_password.as_bytes())
            .map_err(SlhCommandError::from)?;
    }

    // Verify the recovery password by attempting to open the entropy
    // slot. Fail-fast before mutating.
    {
        let container = inner.container.as_ref().ok_or(SlhCommandError::Backend {
            message: "container missing".into(),
        })?;
        let vault = container.find(vault_id).ok_or(SlhCommandError::VaultNotFound {
            id: vault_id.into(),
        })?;
        let record = vault
            .slh_backup
            .as_ref()
            .ok_or(SlhCommandError::NotEnrolled)?;
        let salt_bytes = URL_SAFE_NO_PAD
            .decode(&record.recovery_salt)
            .map_err(|_| SlhCommandError::Malformed)?;
        if salt_bytes.len() != MEK_SALT_LEN {
            return Err(SlhCommandError::Malformed);
        }
        let mut salt = [0u8; MEK_SALT_LEN];
        salt.copy_from_slice(&salt_bytes);
        let recovery_key =
            derive_recovery_key(recovery_password, &salt, &record.recovery_argon_params)?;
        if open_payload(&record.sealed_entropy, &recovery_key).is_err() {
            return Err(SlhCommandError::WrongRecoveryPassword);
        }
    }

    let container = inner.container.as_mut().ok_or(SlhCommandError::Backend {
        message: "container vanished".into(),
    })?;
    let vault = container.find_mut(vault_id).ok_or(SlhCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    vault.slh_backup = None;
    inner.save().map_err(SlhCommandError::from)?;
    Ok(())
}

// ─── Tauri command thin wrappers ─────────────────────────────────

#[tauri::command]
pub async fn slh_enroll_backup(
    vault_id: String,
    recovery_password: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<SlhEnrollResult, SlhCommandError> {
    let mut inner = store.0.lock().await;
    slh_enroll_backup_impl(&mut inner, &vault_id, &recovery_password, now_unix())
}

#[tauri::command]
pub async fn slh_get_backup_status(
    vault_id: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<SlhBackupStatus, SlhCommandError> {
    let mut inner = store.0.lock().await;
    slh_get_backup_status_impl(&mut inner, &vault_id)
}

#[tauri::command]
pub async fn slh_test_recovery(
    vault_id: String,
    recovery_password: String,
    entropy_b64: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<bool, SlhCommandError> {
    let mut inner = store.0.lock().await;
    slh_test_recovery_impl(&mut inner, &vault_id, &recovery_password, &entropy_b64)
}

#[tauri::command]
pub async fn slh_remove_backup(
    vault_id: String,
    master_password: String,
    recovery_password: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<(), SlhCommandError> {
    let mut inner = store.0.lock().await;
    slh_remove_backup_impl(&mut inner, &vault_id, &master_password, &recovery_password)
}

#[tauri::command]
pub async fn slh_activate_recovery(
    vault_id: String,
    recovery_password: String,
    entropy_b64: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<SlhBackupStatus, SlhCommandError> {
    let mut inner = store.0.lock().await;
    slh_activate_recovery_impl(
        &mut inner,
        &vault_id,
        &recovery_password,
        &entropy_b64,
        now_unix(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_multi::commands::{vault_create_impl, VaultStoreInner};

    fn tmp_inner() -> VaultStoreInner {
        let mut p = std::env::temp_dir();
        p.push(format!("mono-slh-test-{}.v1.json", uuid::Uuid::new_v4()));
        let _ = std::fs::remove_file(&p);
        VaultStoreInner::new(p)
    }

    fn seed_test_vault(inner: &mut VaultStoreInner) -> String {
        let seed = [0u8; 32];
        let summary = vault_create_impl(
            inner,
            "Test",
            "password-12345",
            &seed,
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            100,
        )
        .unwrap();
        summary.id
    }

    #[test]
    fn status_starts_not_enrolled() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let s = slh_get_backup_status_impl(&mut inner, &v).unwrap();
        assert_eq!(s, SlhBackupStatus::NotEnrolled);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn enroll_persists_record_and_returns_entropy() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let out = slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 200).unwrap();
        let entropy = URL_SAFE_NO_PAD.decode(&out.entropy_b64).unwrap();
        assert_eq!(entropy.len(), SLH_ENTROPY_LEN);
        let pk = URL_SAFE_NO_PAD.decode(&out.public_key_b64).unwrap();
        assert_eq!(pk.len(), SLH_PK_LEN);

        let s = slh_get_backup_status_impl(&mut inner, &v).unwrap();
        match s {
            SlhBackupStatus::Enrolled { created_at } => assert_eq!(created_at, 200),
            other => panic!("unexpected status: {other:?}"),
        }
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn enroll_rejects_weak_recovery_password() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let err = slh_enroll_backup_impl(&mut inner, &v, "short", 100).unwrap_err();
        assert_eq!(err, SlhCommandError::RecoveryPasswordTooWeak);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn enroll_rejects_when_already_enrolled() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        let err =
            slh_enroll_backup_impl(&mut inner, &v, "another-recovery-pw", 100).unwrap_err();
        assert_eq!(err, SlhCommandError::AlreadyEnrolled);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn enroll_requires_unlocked_vault() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        inner.mek = None;
        let err =
            slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap_err();
        assert_eq!(err, SlhCommandError::VaultLocked);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn test_recovery_accepts_correct_password_and_entropy() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let out = slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        let ok =
            slh_test_recovery_impl(&mut inner, &v, "strong-recovery-pw", &out.entropy_b64)
                .unwrap();
        assert!(ok);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn test_recovery_rejects_wrong_password() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let out = slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        let ok =
            slh_test_recovery_impl(&mut inner, &v, "wrong-recovery-pw", &out.entropy_b64)
                .unwrap();
        assert!(!ok);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn test_recovery_rejects_wrong_entropy() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        let bad_entropy = URL_SAFE_NO_PAD.encode([0u8; SLH_ENTROPY_LEN]);
        let ok =
            slh_test_recovery_impl(&mut inner, &v, "strong-recovery-pw", &bad_entropy)
                .unwrap();
        assert!(!ok);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn activate_recovery_marks_backup_activated() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let out =
            slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        let status = slh_activate_recovery_impl(
            &mut inner,
            &v,
            "strong-recovery-pw",
            &out.entropy_b64,
            300,
        )
        .unwrap();
        match status {
            SlhBackupStatus::Activated {
                created_at,
                activated_at,
            } => {
                assert_eq!(created_at, 100);
                assert_eq!(activated_at, 300);
            }
            other => panic!("unexpected status: {other:?}"),
        }
        // Re-querying status reflects activation.
        let again = slh_get_backup_status_impl(&mut inner, &v).unwrap();
        match again {
            SlhBackupStatus::Activated { .. } => {}
            other => panic!("status didn't persist: {other:?}"),
        }
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn activate_recovery_rejects_wrong_password() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let out =
            slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        let err = slh_activate_recovery_impl(
            &mut inner,
            &v,
            "wrong-password",
            &out.entropy_b64,
            300,
        )
        .unwrap_err();
        assert_eq!(err, SlhCommandError::WrongRecoveryPassword);
        // Status remains enrolled.
        let s = slh_get_backup_status_impl(&mut inner, &v).unwrap();
        match s {
            SlhBackupStatus::Enrolled { .. } => {}
            other => panic!("status changed on failure: {other:?}"),
        }
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn activate_recovery_rejects_wrong_entropy() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        // Supply a different 32-byte entropy.
        let bad = URL_SAFE_NO_PAD.encode([0xAAu8; SLH_ENTROPY_LEN]);
        let err = slh_activate_recovery_impl(
            &mut inner,
            &v,
            "strong-recovery-pw",
            &bad,
            300,
        )
        .unwrap_err();
        assert_eq!(err, SlhCommandError::WrongRecoveryPassword);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn activate_recovery_rejects_when_not_enrolled() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let ent = URL_SAFE_NO_PAD.encode([0u8; SLH_ENTROPY_LEN]);
        let err = slh_activate_recovery_impl(
            &mut inner,
            &v,
            "strong-recovery-pw",
            &ent,
            300,
        )
        .unwrap_err();
        assert_eq!(err, SlhCommandError::NotEnrolled);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn activate_recovery_works_while_vault_is_locked() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        let out =
            slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();
        // Lock the vault — recovery should still work (the whole
        // point of the flow is the master password is unavailable).
        inner.mek = None;
        let status = slh_activate_recovery_impl(
            &mut inner,
            &v,
            "strong-recovery-pw",
            &out.entropy_b64,
            400,
        )
        .unwrap();
        match status {
            SlhBackupStatus::Activated { .. } => {}
            other => panic!("unexpected: {other:?}"),
        }
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn remove_requires_master_and_recovery_passwords() {
        let mut inner = tmp_inner();
        let v = seed_test_vault(&mut inner);
        slh_enroll_backup_impl(&mut inner, &v, "strong-recovery-pw", 100).unwrap();

        // Wrong master.
        let err =
            slh_remove_backup_impl(&mut inner, &v, "wrong-master", "strong-recovery-pw")
                .unwrap_err();
        assert_eq!(err, SlhCommandError::WrongMasterPassword);
        // Wrong recovery.
        let err =
            slh_remove_backup_impl(&mut inner, &v, "password-12345", "wrong-recovery")
                .unwrap_err();
        assert_eq!(err, SlhCommandError::WrongRecoveryPassword);

        // Both correct.
        slh_remove_backup_impl(&mut inner, &v, "password-12345", "strong-recovery-pw")
            .unwrap();
        assert_eq!(
            slh_get_backup_status_impl(&mut inner, &v).unwrap(),
            SlhBackupStatus::NotEnrolled
        );
        let _ = std::fs::remove_file(&inner.container_path);
    }

}
