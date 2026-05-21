// Multi-vault on-disk container schema.
//
// Wire format (serialized as JSON, persisted to `vault.v1.json` in
// Tauri's `app_data_dir`):
//
//   {
//     "version": 1,
//     "mek_salt": "<base64url, 16 bytes>",
//     "mek_argon_params": { "m_cost": 65536, "t_cost": 3, "p_cost": 1, "version": 19 },
//     "vaults": [
//       {
//         "id": "<uuid>",
//         "label": "Personal",
//         "address": "0x...",
//         "created_at": 1735689600,
//         "wrapped_vek": { "nonce": "<b64u>", "ciphertext": "<b64u>" },
//         "sealed_payload": { "nonce": "<b64u>", "ciphertext": "<b64u>" }
//       },
//       …
//     ]
//   }
//
// Sizes:
//   mek_salt           — 16 bytes (OWASP min, matches single-vault salt)
//   wrapped_vek.nonce  — 12 bytes (GCM standard)
//   wrapped_vek.ct     — 32 byte VEK + 16 byte GCM tag = 48 bytes
//   sealed_payload.ct  — variable (32-byte ML-DSA seed today + 16-byte tag)
//
// Notes on layering:
//   • The Argon2id KDF + AES-256-GCM AEADs are the same primitives the
//     single-vault `vault.rs` already uses. We keep both crates as our
//     only crypto deps.
//   • `WrappedKey` and `SealedPayload` share a shape but are kept as
//     distinct types so the type system enforces "key wrap vs payload
//     seal" — they're never interchangeable on the wire.
//   • All sensitive in-memory buffers are zeroized when dropped (handled
//     in mek.rs / vek.rs once those land); the container itself only
//     carries ciphertext + public metadata.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current wire-format version. Bump if the schema changes; legacy
/// containers retain their original version so the migrator (Commit 9)
/// can branch on it.
pub const CONTAINER_VERSION: u32 = 1;

/// Length of the MEK-derivation salt. Matches the single-vault salt
/// length (OWASP recommended Argon2id minimum). 128 random bits.
pub const MEK_SALT_LEN: usize = 16;

/// GCM standard nonce length, shared by both `WrappedKey` and `SealedPayload`.
pub const GCM_NONCE_LEN: usize = 12;

/// On-disk Argon2id parameters for the MEK derivation. Mirrors the
/// single-vault `VaultArgon2Params` shape so audit tooling reads both
/// without translation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultArgon2Params {
    /// Memory cost in KiB.
    pub m_cost: u32,
    /// Iteration count.
    pub t_cost: u32,
    /// Parallelism factor.
    pub p_cost: u32,
    /// Argon2 spec version (0x13 = 1.3).
    pub version: u32,
}

impl VaultArgon2Params {
    /// OWASP 2024 desktop recommendation. The container records the
    /// params used at creation time so vaults stay decryptable even if
    /// we later tune for a less-powerful platform.
    pub fn recommended() -> Self {
        Self {
            m_cost: 65_536,
            t_cost: 3,
            p_cost: 1,
            // argon2::Version::V0x13 as u32 = 19.
            version: 19,
        }
    }
}

/// AES-256-GCM wrapped key. `ciphertext` includes the 16-byte GCM tag.
/// Used for wrapping the per-vault VEK under the MEK.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    /// base64url-no-pad encoded GCM nonce (12 bytes).
    pub nonce: String,
    /// base64url-no-pad encoded ciphertext + GCM tag.
    pub ciphertext: String,
}

impl WrappedKey {
    /// Construct from raw bytes — base64-encoded on the way in.
    pub fn from_bytes(nonce: &[u8; GCM_NONCE_LEN], ciphertext: &[u8]) -> Self {
        Self {
            nonce: URL_SAFE_NO_PAD.encode(nonce),
            ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
        }
    }

    /// Decode back to raw bytes. Returns InvalidArgument on either
    /// malformed base64 or wrong-length nonce.
    pub fn decode(&self) -> Result<([u8; GCM_NONCE_LEN], Vec<u8>), ContainerError> {
        let nonce = URL_SAFE_NO_PAD
            .decode(&self.nonce)
            .map_err(|_| ContainerError::Malformed)?;
        if nonce.len() != GCM_NONCE_LEN {
            return Err(ContainerError::Malformed);
        }
        let ciphertext = URL_SAFE_NO_PAD
            .decode(&self.ciphertext)
            .map_err(|_| ContainerError::Malformed)?;
        let mut nonce_arr = [0u8; GCM_NONCE_LEN];
        nonce_arr.copy_from_slice(&nonce);
        Ok((nonce_arr, ciphertext))
    }
}

/// AES-256-GCM sealed payload. Same on-disk shape as `WrappedKey` but
/// type-distinct so the API can't accidentally swap them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedPayload {
    pub nonce: String,
    pub ciphertext: String,
}

impl SealedPayload {
    pub fn from_bytes(nonce: &[u8; GCM_NONCE_LEN], ciphertext: &[u8]) -> Self {
        Self {
            nonce: URL_SAFE_NO_PAD.encode(nonce),
            ciphertext: URL_SAFE_NO_PAD.encode(ciphertext),
        }
    }

    /// Used by `mek::aead_open` + the migration helper (Commit 9).
    #[allow(dead_code)]
    pub fn decode(&self) -> Result<([u8; GCM_NONCE_LEN], Vec<u8>), ContainerError> {
        let nonce = URL_SAFE_NO_PAD
            .decode(&self.nonce)
            .map_err(|_| ContainerError::Malformed)?;
        if nonce.len() != GCM_NONCE_LEN {
            return Err(ContainerError::Malformed);
        }
        let ciphertext = URL_SAFE_NO_PAD
            .decode(&self.ciphertext)
            .map_err(|_| ContainerError::Malformed)?;
        let mut nonce_arr = [0u8; GCM_NONCE_LEN];
        nonce_arr.copy_from_slice(&nonce);
        Ok((nonce_arr, ciphertext))
    }
}

/// One vault inside the container. The `id` is a UUID-shaped string
/// generated at creation; `address` is the EIP-55 0x-hex address derived
/// from the sealed ML-DSA payload — kept in the clear so the UI can
/// render it without unsealing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultRecord {
    pub id: String,
    pub label: String,
    pub address: String,
    pub created_at: u64,
    pub wrapped_vek: WrappedKey,
    pub sealed_payload: SealedPayload,
}

/// Public-facing summary handed to the UI by `vaults_list`. Carries no
/// secret material — everything in here is already public.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultRecordSummary {
    pub id: String,
    pub label: String,
    pub address: String,
    pub created_at: u64,
    pub is_active: bool,
}

impl VaultRecord {
    /// Build a UI-facing summary. `is_active` is supplied by the caller
    /// (the active-vault id lives in `VaultContainerV1::active_id`).
    pub fn summary(&self, is_active: bool) -> VaultRecordSummary {
        VaultRecordSummary {
            id: self.id.clone(),
            label: self.label.clone(),
            address: self.address.clone(),
            created_at: self.created_at,
            is_active,
        }
    }
}

/// On-disk multi-vault container.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultContainerV1 {
    /// Always 1 in this iteration. Bump on schema change.
    pub version: u32,
    /// base64url-no-pad encoded MEK Argon2id salt (16 bytes).
    pub mek_salt: String,
    pub mek_argon_params: VaultArgon2Params,
    /// Single-signer vault records in creation order. Order is
    /// meaningful to the UI (the picker renders them in this order).
    pub vaults: Vec<VaultRecord>,
    /// Phase 6 — multisig vault records. Sibling list to `vaults`.
    /// `serde(default)` so pre-Phase-6 v1 containers keep parsing.
    #[serde(default)]
    pub multisig_vaults: Vec<super::multisig::MultisigVaultRecord>,
    /// Phase 6 — proposals belonging to all multisig vaults. Held at
    /// the container level (rather than nested inside each multisig
    /// vault) so cross-vault lookups stay O(1) and import paths can
    /// reach any proposal by id.
    #[serde(default)]
    pub proposals: Vec<super::proposal::Proposal>,
    /// Currently-active vault id (UI selection). May reference either
    /// a single-signer `vaults[i].id` OR a `multisig_vaults[i].id`
    /// (Phase 6 picker treats both as first-class). `None` only on a
    /// fresh container before any vault is created.
    #[serde(default)]
    pub active_id: Option<String>,
}

impl VaultContainerV1 {
    /// Construct an empty container with a fresh random salt. The first
    /// `vault_create` call populates `vaults[0]` and the active id.
    /// Callers in production go through `commands::vault_create` rather
    /// than this directly; this constructor is intended for tests and
    /// the migration path (Commit 9).
    #[allow(dead_code)]
    pub fn empty_with_salt(salt: &[u8; MEK_SALT_LEN], params: VaultArgon2Params) -> Self {
        Self {
            version: CONTAINER_VERSION,
            mek_salt: URL_SAFE_NO_PAD.encode(salt),
            mek_argon_params: params,
            vaults: Vec::new(),
            multisig_vaults: Vec::new(),
            proposals: Vec::new(),
            active_id: None,
        }
    }

    /// Decode the MEK salt back to bytes. Returns Malformed if the
    /// base64 is broken or the length is wrong.
    pub fn mek_salt_bytes(&self) -> Result<[u8; MEK_SALT_LEN], ContainerError> {
        let salt = URL_SAFE_NO_PAD
            .decode(&self.mek_salt)
            .map_err(|_| ContainerError::Malformed)?;
        if salt.len() != MEK_SALT_LEN {
            return Err(ContainerError::Malformed);
        }
        let mut out = [0u8; MEK_SALT_LEN];
        out.copy_from_slice(&salt);
        Ok(out)
    }

    /// Find a vault by id.
    pub fn find(&self, id: &str) -> Option<&VaultRecord> {
        self.vaults.iter().find(|v| v.id == id)
    }

    /// Find a vault by id, mutably.
    pub fn find_mut(&mut self, id: &str) -> Option<&mut VaultRecord> {
        self.vaults.iter_mut().find(|v| v.id == id)
    }

    /// Build the full list of UI summaries with the right `is_active` flag.
    pub fn summaries(&self) -> Vec<VaultRecordSummary> {
        self.vaults
            .iter()
            .map(|v| v.summary(self.active_id.as_deref() == Some(v.id.as_str())))
            .collect()
    }
}

/// Errors specific to the on-disk container layer. The Tauri command
/// surface (Commit 4) wraps these into the public `VaultError` for
/// uniform error reporting; pre-commit-4 callers see this enum.
#[derive(Debug, Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum ContainerError {
    #[error("container payload is malformed")]
    Malformed,
    #[error("unsupported container version: {version}")]
    UnsupportedVersion { version: u32 },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_record(id: &str, label: &str) -> VaultRecord {
        VaultRecord {
            id: id.into(),
            label: label.into(),
            address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".into(),
            created_at: 1_735_689_600,
            wrapped_vek: WrappedKey::from_bytes(&[0u8; GCM_NONCE_LEN], &vec![0u8; 48]),
            sealed_payload: SealedPayload::from_bytes(&[0u8; GCM_NONCE_LEN], &vec![0u8; 48]),
        }
    }

    #[test]
    fn empty_container_serializes_round_trip() {
        let salt = [42u8; MEK_SALT_LEN];
        let container = VaultContainerV1::empty_with_salt(&salt, VaultArgon2Params::recommended());
        let bytes = serde_json::to_vec(&container).unwrap();
        let decoded: VaultContainerV1 = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.version, CONTAINER_VERSION);
        assert_eq!(decoded.mek_salt_bytes().unwrap(), salt);
        assert!(decoded.vaults.is_empty());
        assert!(decoded.active_id.is_none());
    }

    #[test]
    fn container_with_records_round_trips_and_finds_by_id() {
        let salt = [1u8; MEK_SALT_LEN];
        let mut container =
            VaultContainerV1::empty_with_salt(&salt, VaultArgon2Params::recommended());
        container.vaults.push(fixture_record("a", "Personal"));
        container.vaults.push(fixture_record("b", "Work"));
        container.active_id = Some("a".into());

        let bytes = serde_json::to_vec(&container).unwrap();
        let decoded: VaultContainerV1 = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.vaults.len(), 2);
        assert_eq!(decoded.find("a").unwrap().label, "Personal");
        assert_eq!(decoded.find("b").unwrap().label, "Work");
        assert!(decoded.find("c").is_none());
        assert_eq!(decoded.active_id.as_deref(), Some("a"));
    }

    #[test]
    fn summaries_carry_is_active_flag() {
        let salt = [1u8; MEK_SALT_LEN];
        let mut container =
            VaultContainerV1::empty_with_salt(&salt, VaultArgon2Params::recommended());
        container.vaults.push(fixture_record("a", "P"));
        container.vaults.push(fixture_record("b", "W"));
        container.active_id = Some("b".into());

        let sums = container.summaries();
        assert_eq!(sums.len(), 2);
        assert!(!sums[0].is_active);
        assert!(sums[1].is_active);
    }

    #[test]
    fn wrapped_key_decode_round_trips() {
        let nonce = [7u8; GCM_NONCE_LEN];
        let ct = vec![1u8, 2, 3, 4, 5];
        let wk = WrappedKey::from_bytes(&nonce, &ct);
        let (n, c) = wk.decode().unwrap();
        assert_eq!(n, nonce);
        assert_eq!(c, ct);
    }

    #[test]
    fn wrapped_key_rejects_bad_base64() {
        let wk = WrappedKey {
            nonce: "!!!".into(),
            ciphertext: "ok".into(),
        };
        assert_eq!(wk.decode().unwrap_err(), ContainerError::Malformed);
    }

    #[test]
    fn wrapped_key_rejects_wrong_nonce_length() {
        let wk = WrappedKey {
            nonce: URL_SAFE_NO_PAD.encode([0u8; 8]), // 8 != 12
            ciphertext: URL_SAFE_NO_PAD.encode([0u8; 32]),
        };
        assert_eq!(wk.decode().unwrap_err(), ContainerError::Malformed);
    }

    #[test]
    fn argon_params_recommended_pins_owasp_defaults() {
        let p = VaultArgon2Params::recommended();
        assert_eq!(p.m_cost, 65_536);
        assert_eq!(p.t_cost, 3);
        assert_eq!(p.p_cost, 1);
        assert_eq!(p.version, 19);
    }
}
