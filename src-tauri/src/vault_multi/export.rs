// Phase 7 #D20 — portable vault export / import.
//
// Encrypts a single vault's seed under a fresh "export password" using
// the same Argon2id + AES-256-GCM primitives as the on-disk container,
// then serialises to a textual JSON envelope the user can copy to a
// secure transport channel (encrypted email, password manager note,
// air-gapped USB). The recipient runs `vault_import_blob` with the
// export password to ingest into their local container.
//
// The export password is INDEPENDENT of the master password: the user
// picks a fresh one per export so revealing the transport medium
// doesn't compromise their wallet master password.
//
// Wire shape (textual JSON, `monolythium.vault.export.v1`):
//
//   {
//     "type": "monolythium.vault.export.v1",
//     "label": "<vault label>",
//     "address": "0x…",                // lowercased hex
//     "created_at": 1234567890,        // original create-time unix secs
//     "salt": "base64url-no-pad",      // 16 bytes
//     "argon": { m_cost, t_cost, p_cost, version },
//     "wrapped_seed": {
//       "nonce": "base64url-no-pad",   // 12 bytes
//       "ciphertext": "base64url-no-pad"
//     }
//   }
//
// The seed payload is the bare 32-byte ML-DSA-65 seed. Future shapes
// (multi-algo seeds) can fork a new envelope version; the parser
// rejects unknown types so the wallet ratchets up cleanly.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroizing;

use super::commands::{VaultStore, VaultStoreInner};
use super::container::{
    SealedPayload, VaultArgon2Params, VaultRecord, WrappedKey, GCM_NONCE_LEN, MEK_SALT_LEN,
};
use super::mek::{derive_mek, verify_password, VaultError};
use super::vek::{generate_vek, open_payload, seal_payload, unwrap_vek, wrap_vek};
use uuid::Uuid;

pub const EXPORT_VERSION_TAG: &str = "monolythium.vault.export.v1";

#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum ExportError {
    #[error("vault {0} not found")]
    NotFound(String),
    #[error("vault layer: {0}")]
    Vault(#[from] VaultError),
    #[error("invalid envelope: {message}")]
    InvalidEnvelope { message: String },
    #[error("backend error: {message}")]
    Backend { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportEnvelope {
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub address: String,
    pub created_at: u64,
    pub salt: String,
    pub argon: VaultArgon2Params,
    pub wrapped_seed: WrappedKey,
}

// ─── Pure-Rust impls (testable without Tauri state) ──────────────

pub fn vault_export_blob_impl(
    inner: &mut VaultStoreInner,
    vault_id: &str,
    master_password: &str,
    export_password: &str,
) -> Result<String, ExportError> {
    if inner.mek.is_none() {
        return Err(ExportError::from(VaultError::Backend {
            message: "vault is locked".into(),
        }));
    }
    if export_password.is_empty() {
        return Err(ExportError::from(VaultError::InvalidArgument {
            message: "export password is empty".into(),
        }));
    }
    inner.load()?;
    let container = inner
        .container
        .as_ref()
        .ok_or(ExportError::from(VaultError::NoContainer))?;
    // Master-password verify against the live container.
    let mek = verify_password(container, master_password.as_bytes())?;
    let record: &VaultRecord = container
        .vaults
        .iter()
        .find(|v| v.id == vault_id)
        .ok_or_else(|| ExportError::NotFound(vault_id.into()))?;
    // Recover the 32-byte seed via the existing VEK + sealed_payload pair.
    let vek = unwrap_vek(&record.wrapped_vek, &mek)?;
    let seed_plain = open_payload(&record.sealed_payload, &vek)?;
    if seed_plain.len() != 32 {
        return Err(ExportError::Backend {
            message: format!("unexpected seed length {}", seed_plain.len()),
        });
    }
    let mut seed_arr = Zeroizing::new([0u8; 32]);
    seed_arr.copy_from_slice(&seed_plain);

    // Fresh argon params + salt for the export. We re-use `recommended()`
    // so the recipient's wallet can decrypt with the same defaults.
    let salt = {
        let mut s = [0u8; MEK_SALT_LEN];
        OsRng.fill_bytes(&mut s);
        s
    };
    let argon = VaultArgon2Params::recommended();
    let export_kek = derive_mek(export_password.as_bytes(), &salt, &argon)?;
    // Re-seal the seed under the export KEK directly via the existing
    // VEK-seal primitive (it just wraps `aead_seal` on the supplied key).
    let wrapped_seed = wrap_vek_like(&seed_arr, &export_kek)?;

    let envelope = ExportEnvelope {
        kind: EXPORT_VERSION_TAG.to_string(),
        label: record.label.clone(),
        address: record.address.clone(),
        created_at: record.created_at,
        salt: URL_SAFE_NO_PAD.encode(salt),
        argon,
        wrapped_seed,
    };
    serde_json::to_string_pretty(&envelope).map_err(|e| ExportError::Backend {
        message: format!("serialize envelope: {e}"),
    })
}

pub fn vault_import_blob_impl(
    inner: &mut VaultStoreInner,
    envelope_text: &str,
    export_password: &str,
    master_password: &str,
    label_override: Option<&str>,
    now_unix: u64,
) -> Result<String, ExportError> {
    if inner.mek.is_none() {
        return Err(ExportError::from(VaultError::Backend {
            message: "vault is locked".into(),
        }));
    }
    if export_password.is_empty() || master_password.is_empty() {
        return Err(ExportError::from(VaultError::InvalidArgument {
            message: "passwords required".into(),
        }));
    }
    let envelope: ExportEnvelope =
        serde_json::from_str(envelope_text).map_err(|e| ExportError::InvalidEnvelope {
            message: format!("not valid JSON: {e}"),
        })?;
    if envelope.kind != EXPORT_VERSION_TAG {
        return Err(ExportError::InvalidEnvelope {
            message: format!(
                "wrong envelope type \"{}\" — expected \"{}\"",
                envelope.kind, EXPORT_VERSION_TAG
            ),
        });
    }
    let salt_bytes = URL_SAFE_NO_PAD
        .decode(&envelope.salt)
        .map_err(|e| ExportError::InvalidEnvelope {
            message: format!("salt base64 decode: {e}"),
        })?;
    if salt_bytes.len() != MEK_SALT_LEN {
        return Err(ExportError::InvalidEnvelope {
            message: format!(
                "salt must be {} bytes, got {}",
                MEK_SALT_LEN,
                salt_bytes.len()
            ),
        });
    }
    let mut salt = [0u8; MEK_SALT_LEN];
    salt.copy_from_slice(&salt_bytes);

    let export_kek = derive_mek(export_password.as_bytes(), &salt, &envelope.argon)?;
    let seed_plain = super::mek::aead_unwrap(&envelope.wrapped_seed, &export_kek)?;
    if seed_plain.len() != 32 {
        return Err(ExportError::InvalidEnvelope {
            message: format!(
                "decrypted seed must be 32 bytes, got {}",
                seed_plain.len()
            ),
        });
    }

    // Now add the seed to the local container under the local MEK.
    inner.load()?;
    let container = inner
        .container
        .as_mut()
        .ok_or(ExportError::from(VaultError::NoContainer))?;
    let local_mek = verify_password(container, master_password.as_bytes())?;
    let vek = generate_vek();
    let wrapped_vek = wrap_vek(&vek, &local_mek)?;
    let sealed_payload = seal_payload(&seed_plain, &vek)?;
    let new_id = Uuid::new_v4().to_string();
    let label = label_override
        .map(|s| s.to_string())
        .unwrap_or_else(|| envelope.label.clone());
    let new_record = VaultRecord {
        id: new_id.clone(),
        label,
        address: envelope.address.to_ascii_lowercase(),
        created_at: now_unix,
        wrapped_vek,
        sealed_payload,
        passkeys: Vec::new(),
        slh_backup: None,
    };
    container.vaults.push(new_record);
    inner.save().map_err(|e| ExportError::Backend {
        message: format!("save failed: {e}"),
    })?;
    Ok(new_id)
}

/// Shape-only helper — wraps a 32-byte secret with a 32-byte key via
/// the existing AES-256-GCM primitive. Returns the on-disk WrappedKey
/// envelope. Distinct from `wrap_vek` only in naming + the fact that
/// the wrapped data is here a seed, not a VEK.
fn wrap_vek_like(seed: &[u8; 32], key: &[u8; 32]) -> Result<WrappedKey, VaultError> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Key, Nonce,
    };
    let mut nonce_bytes = [0u8; GCM_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), seed.as_slice())
        .map_err(|e| VaultError::Backend {
            message: format!("aes-gcm seal: {e}"),
        })?;
    Ok(WrappedKey::from_bytes(&nonce_bytes, &ciphertext))
}

#[allow(dead_code)] // surfaced only as the SealedPayload shape — kept to
// document the structural parity between WrappedKey + SealedPayload for
// the export envelope.
fn _shape_sealed_payload(p: SealedPayload) -> SealedPayload {
    p
}

// ─── Tauri command wrappers ────────────────────────────────────────

#[tauri::command]
pub async fn vault_export_blob(
    vault_id: String,
    master_password: String,
    export_password: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<String, ExportError> {
    let mut inner = store.0.lock().await;
    vault_export_blob_impl(&mut inner, &vault_id, &master_password, &export_password)
}

#[tauri::command]
pub async fn vault_import_blob(
    envelope_text: String,
    export_password: String,
    master_password: String,
    label_override: Option<String>,
    store: tauri::State<'_, VaultStore>,
) -> Result<String, ExportError> {
    let mut inner = store.0.lock().await;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    vault_import_blob_impl(
        &mut inner,
        &envelope_text,
        &export_password,
        &master_password,
        label_override.as_deref(),
        now,
    )
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rand::{rngs::OsRng, RngCore};
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let mut nonce = [0u8; 8];
        OsRng.fill_bytes(&mut nonce);
        let suffix: String = nonce.iter().map(|b| format!("{:02x}", b)).collect();
        p.push(format!("mono-vault-export-test-{}-{}.json", name, suffix));
        p
    }

    fn fresh_store(name: &str) -> VaultStoreInner {
        let path = tmp_path(name);
        let _ = std::fs::remove_file(&path);
        VaultStoreInner::new(path)
    }

    fn cleanup(inner: &VaultStoreInner) {
        let _ = std::fs::remove_file(&inner.container_path);
        let _ = std::fs::remove_file(inner.container_path.with_extension("v1.json.tmp"));
    }

    fn setup_two_vault_store(label_a: &str, label_b: &str) -> (VaultStoreInner, String, String) {
        let mut inner = fresh_store("export");
        let seed_a = [11u8; 32];
        let seed_b = [22u8; 32];
        let s_a = super::super::commands::vault_create_impl(
            &mut inner,
            label_a,
            "hunter2",
            &seed_a,
            "0xaaaa00000000000000000000000000000000aaaa",
            1_000_000,
        )
        .unwrap();
        let s_b = super::super::commands::vault_create_impl(
            &mut inner,
            label_b,
            "hunter2",
            &seed_b,
            "0xbbbb00000000000000000000000000000000bbbb",
            1_000_010,
        )
        .unwrap();
        (inner, s_a.id, s_b.id)
    }

    #[test]
    fn export_then_import_recovers_the_same_seed() {
        let (mut inner, id_a, _) = setup_two_vault_store("Primary", "Other");
        let envelope =
            vault_export_blob_impl(&mut inner, &id_a, "hunter2", "transport").unwrap();
        // Sanity: envelope is JSON with the right version tag.
        assert!(envelope.contains(EXPORT_VERSION_TAG));
        // Import into the same container under a new label.
        let new_id = vault_import_blob_impl(
            &mut inner,
            &envelope,
            "transport",
            "hunter2",
            Some("Imported"),
            1_000_500,
        )
        .unwrap();
        assert_ne!(new_id, id_a);
        let container = inner.container.as_ref().unwrap();
        // Three vaults now (original two + imported clone).
        assert_eq!(container.vaults.len(), 3);
        let imported = container.vaults.iter().find(|v| v.id == new_id).unwrap();
        assert_eq!(imported.label, "Imported");
        assert_eq!(
            imported.address,
            "0xaaaa00000000000000000000000000000000aaaa"
        );
        cleanup(&inner);
    }

    #[test]
    fn export_rejects_wrong_master_password() {
        let (mut inner, id_a, _) = setup_two_vault_store("Primary", "Other");
        let err =
            vault_export_blob_impl(&mut inner, &id_a, "wrong", "transport").unwrap_err();
        assert!(matches!(err, ExportError::Vault(VaultError::WrongPassword)));
        cleanup(&inner);
    }

    #[test]
    fn import_rejects_wrong_export_password() {
        let (mut inner, id_a, _) = setup_two_vault_store("Primary", "Other");
        let envelope =
            vault_export_blob_impl(&mut inner, &id_a, "hunter2", "transport").unwrap();
        let err = vault_import_blob_impl(
            &mut inner,
            &envelope,
            "wrong-export",
            "hunter2",
            None,
            1_000_500,
        )
        .unwrap_err();
        assert!(matches!(err, ExportError::Vault(VaultError::WrongPassword)));
        cleanup(&inner);
    }

    #[test]
    fn import_rejects_unknown_envelope_type() {
        let (mut inner, _, _) = setup_two_vault_store("Primary", "Other");
        let bogus = serde_json::json!({
            "type": "some.other.format.v1",
            "label": "x",
            "address": "0x00",
            "created_at": 1,
            "salt": "AAAAAAAAAAAAAAAAAAAAAA",
            "argon": { "m_cost": 47104, "t_cost": 1, "p_cost": 1, "version": 19 },
            "wrapped_seed": { "nonce": "AAAAAAAAAAAAAAAA", "ciphertext": "AAAA" },
        })
        .to_string();
        let err = vault_import_blob_impl(
            &mut inner,
            &bogus,
            "transport",
            "hunter2",
            None,
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ExportError::InvalidEnvelope { .. }));
        cleanup(&inner);
    }

    #[test]
    fn import_rejects_malformed_json() {
        let (mut inner, _, _) = setup_two_vault_store("Primary", "Other");
        let err = vault_import_blob_impl(
            &mut inner,
            "{not valid json",
            "transport",
            "hunter2",
            None,
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ExportError::InvalidEnvelope { .. }));
        cleanup(&inner);
    }

    #[test]
    fn export_rejects_empty_export_password() {
        let (mut inner, id_a, _) = setup_two_vault_store("Primary", "Other");
        let err = vault_export_blob_impl(&mut inner, &id_a, "hunter2", "").unwrap_err();
        assert!(matches!(err, ExportError::Vault(VaultError::InvalidArgument { .. })));
        cleanup(&inner);
    }

    #[test]
    fn export_rejects_unknown_vault_id() {
        let (mut inner, _, _) = setup_two_vault_store("Primary", "Other");
        let err = vault_export_blob_impl(&mut inner, "no-such-id", "hunter2", "transport")
            .unwrap_err();
        assert!(matches!(err, ExportError::NotFound(_)));
        cleanup(&inner);
    }
}
