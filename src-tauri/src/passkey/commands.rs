// Tauri command surface for the passkey signer.
//
// Surface (every command returns Result<T, PasskeyCommandError>):
//
//   passkey_list(vault_id)                          → Vec<PasskeyEntrySummary>
//   passkey_enroll(vault_id, label, device_name?)   → PasskeyEntrySummary
//   passkey_rename(vault_id, cred_id, new_label)    → PasskeyEntrySummary
//   passkey_remove(vault_id, cred_id, password)     → ()
//   passkey_challenge_create(payload_hash_b64)      → AuthChallenge
//   passkey_attest(vault_id, cred_id, challenge)    → Assertion
//
// All commands except `passkey_list` and `passkey_challenge_create`
// require the vault to be unlocked (i.e. `mek` cached in the store).
// `passkey_remove` additionally re-confirms the master password
// before destroying credential material — same defense-in-depth gate
// the browser-wallet uses on credential removal.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::challenge::{
    create_challenge, sign_challenge_software, verify_assertion, Assertion, AuthChallenge,
    AuthError, PAYLOAD_HASH_LEN,
};
use super::credential::{PasskeyEntry, PasskeyEntrySummary, PasskeyError};
use super::registration::{enroll_passkey, EnrollInputs};
use crate::vault_multi::commands::{VaultStore, VaultStoreInner};
use crate::vault_multi::mek::{verify_password, VaultError};
use crate::vault_multi::vek::unwrap_vek;

/// Boundary error for the Tauri command surface. Wraps the two
/// underlying error types so the TS side gets one tagged enum to
/// branch on.
#[derive(Debug, thiserror::Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum PasskeyCommandError {
    #[error("vault is locked")]
    VaultLocked,
    #[error("vault not found: {id}")]
    VaultNotFound { id: String },
    #[error("credential not found")]
    CredentialNotFound,
    #[error("credential limit reached ({max} per vault)")]
    LimitReached { max: usize },
    #[error("invalid label")]
    InvalidLabel,
    #[error("malformed credential payload")]
    Malformed,
    #[error("wrong master password")]
    WrongPassword,
    #[error("internal crypto error")]
    Crypto,
    #[error("user cancelled the assertion")]
    AssertionCancelled,
    #[error("no passkey enrolled")]
    NotEnrolled,
    #[error("authentication failed")]
    AuthFailed,
    #[error("counter regression — replay rejected")]
    CounterRegression,
    #[error("challenge expired")]
    Expired,
    #[error("device or backend not supported")]
    DeviceNotSupported,
    #[error("backend error: {message}")]
    Backend { message: String },
}

impl From<PasskeyError> for PasskeyCommandError {
    fn from(e: PasskeyError) -> Self {
        match e {
            PasskeyError::VaultNotFound => Self::VaultNotFound { id: String::new() },
            PasskeyError::CredentialNotFound => Self::CredentialNotFound,
            PasskeyError::LimitReached { max } => Self::LimitReached { max },
            PasskeyError::InvalidLabel => Self::InvalidLabel,
            PasskeyError::Malformed => Self::Malformed,
            PasskeyError::LastPasskeyBlocked => Self::Backend {
                message: "removing the last passkey is blocked by policy".into(),
            },
            PasskeyError::Crypto => Self::Crypto,
        }
    }
}

impl From<VaultError> for PasskeyCommandError {
    fn from(e: VaultError) -> Self {
        match e {
            VaultError::WrongPassword => Self::WrongPassword,
            VaultError::NotFound { id } => Self::VaultNotFound { id },
            VaultError::InvalidArgument { message } => Self::Backend { message },
            VaultError::NoContainer => Self::Backend {
                message: "no vault container".into(),
            },
            VaultError::EmptyContainer => Self::Backend {
                message: "empty container".into(),
            },
            VaultError::Backend { message } => Self::Backend { message },
        }
    }
}

impl From<AuthError> for PasskeyCommandError {
    fn from(e: AuthError) -> Self {
        match e {
            AuthError::Cancelled => Self::AssertionCancelled,
            AuthError::NotEnrolled => Self::NotEnrolled,
            AuthError::AuthFailed => Self::AuthFailed,
            AuthError::DeviceNotSupported => Self::DeviceNotSupported,
            AuthError::CounterRegression => Self::CounterRegression,
            AuthError::Expired => Self::Expired,
        }
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ─── Pure-Rust testable impls ─────────────────────────────────────

/// List enrolled passkeys for a vault. Works whether the vault is
/// locked or unlocked — the summary carries only public material.
pub fn passkey_list_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
) -> Result<Vec<PasskeyEntrySummary>, PasskeyCommandError> {
    inner.load().map_err(PasskeyCommandError::from)?;
    let container = inner.container.as_ref().ok_or(PasskeyCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    Ok(vault.passkeys.iter().map(|p| p.summary()).collect())
}

/// Enroll a fresh passkey. Requires the vault unlocked. Generates a
/// new keypair, seals the secret under the vault's VEK, persists the
/// entry, returns its public summary.
pub fn passkey_enroll_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    label: &str,
    device_name: Option<String>,
    now: u64,
) -> Result<PasskeyEntrySummary, PasskeyCommandError> {
    let mek = require_unlocked(inner)?;
    inner.load().map_err(PasskeyCommandError::from)?;
    // Unwrap the VEK first (immutable borrow of container).
    let container = inner.container.as_ref().ok_or(PasskeyCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    let vek = unwrap_vek(&vault.wrapped_vek, &mek).map_err(PasskeyCommandError::from)?;
    let existing = vault.passkeys.len();
    let entry = enroll_passkey(EnrollInputs {
        vek: &vek,
        label: label.into(),
        device_name,
        now,
        existing_count: existing,
    })?;
    let summary = entry.summary();
    // Re-borrow mutably to append + save.
    let container = inner.container.as_mut().ok_or(PasskeyCommandError::Backend {
        message: "container vanished".into(),
    })?;
    let vault = container.find_mut(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    vault.passkeys.push(entry);
    inner.save().map_err(PasskeyCommandError::from)?;
    Ok(summary)
}

/// Rename a passkey. Vault must be unlocked.
pub fn passkey_rename_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    credential_id: &str,
    new_label: &str,
) -> Result<PasskeyEntrySummary, PasskeyCommandError> {
    let _ = require_unlocked(inner)?;
    inner.load().map_err(PasskeyCommandError::from)?;
    let label = super::credential::validate_label(new_label)?;
    let container = inner.container.as_mut().ok_or(PasskeyCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find_mut(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    let entry = vault
        .passkeys
        .iter_mut()
        .find(|p| p.id == credential_id)
        .ok_or(PasskeyCommandError::CredentialNotFound)?;
    entry.label = label;
    let summary = entry.summary();
    inner.save().map_err(PasskeyCommandError::from)?;
    Ok(summary)
}

/// Remove a passkey. Vault must be unlocked AND the caller must
/// re-supply the master password — defense-in-depth against a
/// drive-by removal once the wallet's already unlocked.
pub fn passkey_remove_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    credential_id: &str,
    password: &str,
) -> Result<(), PasskeyCommandError> {
    let _ = require_unlocked(inner)?;
    inner.load().map_err(PasskeyCommandError::from)?;
    let container = inner.container.as_ref().ok_or(PasskeyCommandError::Backend {
        message: "container missing".into(),
    })?;
    // Re-verify the master password against the container.
    let _ = verify_password(container, password.as_bytes()).map_err(PasskeyCommandError::from)?;
    let container = inner.container.as_mut().ok_or(PasskeyCommandError::Backend {
        message: "container vanished".into(),
    })?;
    let vault = container.find_mut(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    let before = vault.passkeys.len();
    vault.passkeys.retain(|p| p.id != credential_id);
    if vault.passkeys.len() == before {
        return Err(PasskeyCommandError::CredentialNotFound);
    }
    inner.save().map_err(PasskeyCommandError::from)?;
    Ok(())
}

/// Create a fresh challenge bound to `payload_hash_b64`. Stateless;
/// works whether the vault is locked or unlocked. The OperationsDrawer
/// pre-computes the tx payload hash, calls this, then hands the
/// returned challenge to `passkey_attest`.
pub fn passkey_challenge_create_impl(
    payload_hash_b64: &str,
    now: u64,
) -> Result<AuthChallenge, PasskeyCommandError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(payload_hash_b64)
        .map_err(|_| PasskeyCommandError::Malformed)?;
    if bytes.len() != PAYLOAD_HASH_LEN {
        return Err(PasskeyCommandError::Malformed);
    }
    let mut arr = [0u8; PAYLOAD_HASH_LEN];
    arr.copy_from_slice(&bytes);
    Ok(create_challenge(&arr, now))
}

/// Run the full assertion ceremony. Unseals the credential secret,
/// signs the challenge, verifies the result against the stored
/// pubkey, bumps the counter, persists.
pub fn passkey_attest_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    credential_id: &str,
    challenge: AuthChallenge,
    now: u64,
) -> Result<Assertion, PasskeyCommandError> {
    let mek = require_unlocked(inner)?;
    inner.load().map_err(PasskeyCommandError::from)?;
    let container = inner.container.as_ref().ok_or(PasskeyCommandError::Backend {
        message: "container missing".into(),
    })?;
    let vault = container.find(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    let entry: &PasskeyEntry = vault
        .passkeys
        .iter()
        .find(|p| p.id == credential_id)
        .ok_or(PasskeyCommandError::CredentialNotFound)?;
    let stored_counter = entry.counter;
    let pubkey_b64 = entry.public_key.clone();
    let entry_clone = entry.clone();

    let vek = unwrap_vek(&vault.wrapped_vek, &mek).map_err(PasskeyCommandError::from)?;
    let assertion = sign_challenge_software(&entry_clone, &vek, &challenge)?;
    // Self-verify before committing the counter bump — guards
    // against a corrupted secret producing a sig that wouldn't pass
    // the relying-party check.
    verify_assertion(&assertion, &pubkey_b64, stored_counter, now)?;

    let container = inner.container.as_mut().ok_or(PasskeyCommandError::Backend {
        message: "container vanished".into(),
    })?;
    let vault = container.find_mut(vault_id).ok_or(PasskeyCommandError::VaultNotFound {
        id: vault_id.into(),
    })?;
    let entry = vault
        .passkeys
        .iter_mut()
        .find(|p| p.id == credential_id)
        .ok_or(PasskeyCommandError::CredentialNotFound)?;
    entry.counter = assertion.new_counter;
    entry.last_used = now;
    inner.save().map_err(PasskeyCommandError::from)?;

    Ok(assertion)
}

/// Helper — clone the cached MEK out of the store, or fail with
/// `VaultLocked`. Returns a plain `[u8; 32]` so the borrow checker
/// doesn't fight with the subsequent mutable container access.
fn require_unlocked(inner: &VaultStoreInner) -> Result<[u8; 32], PasskeyCommandError> {
    let zeroizing = inner.mek.as_ref().ok_or(PasskeyCommandError::VaultLocked)?;
    let mut out = [0u8; 32];
    out.copy_from_slice(zeroizing.as_ref());
    Ok(out)
}

// ─── Tauri command thin wrappers ─────────────────────────────────

#[tauri::command]
pub async fn passkey_list(
    vault_id: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<PasskeyEntrySummary>, PasskeyCommandError> {
    let mut inner = store.0.lock().await;
    passkey_list_impl(&mut inner, &vault_id)
}

#[tauri::command]
pub async fn passkey_enroll(
    vault_id: String,
    label: String,
    device_name: Option<String>,
    store: tauri::State<'_, VaultStore>,
) -> Result<PasskeyEntrySummary, PasskeyCommandError> {
    let mut inner = store.0.lock().await;
    passkey_enroll_impl(&mut inner, &vault_id, &label, device_name, now_unix())
}

#[tauri::command]
pub async fn passkey_rename(
    vault_id: String,
    credential_id: String,
    new_label: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<PasskeyEntrySummary, PasskeyCommandError> {
    let mut inner = store.0.lock().await;
    passkey_rename_impl(&mut inner, &vault_id, &credential_id, &new_label)
}

#[tauri::command]
pub async fn passkey_remove(
    vault_id: String,
    credential_id: String,
    password: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<(), PasskeyCommandError> {
    let mut inner = store.0.lock().await;
    passkey_remove_impl(&mut inner, &vault_id, &credential_id, &password)
}

#[tauri::command]
pub async fn passkey_challenge_create(
    payload_hash_b64: String,
) -> Result<AuthChallenge, PasskeyCommandError> {
    passkey_challenge_create_impl(&payload_hash_b64, now_unix())
}

#[tauri::command]
pub async fn passkey_attest(
    vault_id: String,
    credential_id: String,
    challenge: AuthChallenge,
    store: tauri::State<'_, VaultStore>,
) -> Result<Assertion, PasskeyCommandError> {
    let mut inner = store.0.lock().await;
    passkey_attest_impl(&mut inner, &vault_id, &credential_id, challenge, now_unix())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_multi::commands::{vault_create_impl, vault_unlock_impl, VaultStoreInner};
    use std::path::PathBuf;

    fn tmp_inner() -> VaultStoreInner {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "mono-passkey-test-{}.v1.json",
            uuid::Uuid::new_v4()
        ));
        // Best-effort cleanup of any prior fixture at this path.
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
    fn list_returns_empty_for_fresh_vault() {
        let mut inner = tmp_inner();
        let id = seed_test_vault(&mut inner);
        let list = passkey_list_impl(&mut inner, &id).unwrap();
        assert!(list.is_empty());
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn enroll_then_list_and_attest_round_trip() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        // Already unlocked from vault_create.
        let summary = passkey_enroll_impl(
            &mut inner,
            &vault_id,
            "Test laptop",
            Some("host-1".into()),
            200,
        )
        .unwrap();
        assert_eq!(summary.label, "Test laptop");
        assert_eq!(summary.counter, 0);

        let list = passkey_list_impl(&mut inner, &vault_id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, summary.id);

        let payload = URL_SAFE_NO_PAD.encode([0x11u8; 32]);
        let challenge = passkey_challenge_create_impl(&payload, 250).unwrap();
        let assertion =
            passkey_attest_impl(&mut inner, &vault_id, &summary.id, challenge, 250).unwrap();
        assert_eq!(assertion.new_counter, 1);

        // Counter persisted.
        let list = passkey_list_impl(&mut inner, &vault_id).unwrap();
        assert_eq!(list[0].counter, 1);
        assert_eq!(list[0].last_used, 250);

        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn enroll_requires_unlocked_vault() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        // Lock the vault.
        inner.mek = None;
        let err = passkey_enroll_impl(&mut inner, &vault_id, "X", None, 100).unwrap_err();
        assert_eq!(err, PasskeyCommandError::VaultLocked);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn list_works_while_locked() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        passkey_enroll_impl(&mut inner, &vault_id, "Test", None, 100).unwrap();
        inner.mek = None;
        let list = passkey_list_impl(&mut inner, &vault_id).unwrap();
        assert_eq!(list.len(), 1);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn rename_updates_label() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        let s = passkey_enroll_impl(&mut inner, &vault_id, "Old", None, 100).unwrap();
        let updated =
            passkey_rename_impl(&mut inner, &vault_id, &s.id, "New name").unwrap();
        assert_eq!(updated.label, "New name");
        let list = passkey_list_impl(&mut inner, &vault_id).unwrap();
        assert_eq!(list[0].label, "New name");
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn remove_requires_correct_password() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        let s = passkey_enroll_impl(&mut inner, &vault_id, "Doomed", None, 100).unwrap();
        let err = passkey_remove_impl(&mut inner, &vault_id, &s.id, "wrong-pw").unwrap_err();
        assert_eq!(err, PasskeyCommandError::WrongPassword);
        // Credential still present.
        let list = passkey_list_impl(&mut inner, &vault_id).unwrap();
        assert_eq!(list.len(), 1);
        // Remove with the right password.
        passkey_remove_impl(&mut inner, &vault_id, &s.id, "password-12345").unwrap();
        let list = passkey_list_impl(&mut inner, &vault_id).unwrap();
        assert!(list.is_empty());
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn attest_after_relock_then_unlock_works() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        let s = passkey_enroll_impl(&mut inner, &vault_id, "T", None, 100).unwrap();
        // Lock + unlock.
        inner.mek = None;
        vault_unlock_impl(&mut inner, "password-12345").unwrap();

        let payload = URL_SAFE_NO_PAD.encode([0x22u8; 32]);
        let challenge = passkey_challenge_create_impl(&payload, 200).unwrap();
        let assertion =
            passkey_attest_impl(&mut inner, &vault_id, &s.id, challenge, 200).unwrap();
        assert_eq!(assertion.new_counter, 1);
        let _ = std::fs::remove_file(&inner.container_path);
    }

    #[test]
    fn attest_increments_counter_monotonically() {
        let mut inner = tmp_inner();
        let vault_id = seed_test_vault(&mut inner);
        let s = passkey_enroll_impl(&mut inner, &vault_id, "T", None, 100).unwrap();
        for i in 1..=3 {
            let payload = URL_SAFE_NO_PAD.encode([i as u8; 32]);
            let challenge = passkey_challenge_create_impl(&payload, 200).unwrap();
            let a = passkey_attest_impl(&mut inner, &vault_id, &s.id, challenge, 200).unwrap();
            assert_eq!(a.new_counter, i as u32);
        }
        let _ = std::fs::remove_file(&inner.container_path);
    }
}
