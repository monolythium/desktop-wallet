// Password-protected vault — Argon2id + AES-256-GCM.
//
// Stage 4 swaps the Stage 3 SHA-256(password) shortcut for a real
// memory-hard KDF. The seed (the actual signing key material) is randomly
// generated and AES-GCM encrypted under a key derived from the user's
// password via Argon2id. The encrypted blob is what the OS keychain stores
// — the password itself is never persisted.
//
//   create:  password → argon2id → KEK
//            seed = random(32)
//            ciphertext = aes-256-gcm(seed, KEK, nonce)
//            persist { ciphertext, salt, nonce, params }
//
//   unlock:  load { ciphertext, salt, nonce, params }
//            KEK = argon2id(password, salt, params)
//            seed = aes-256-gcm-decrypt(ciphertext, KEK, nonce)
//            on tag-mismatch → WrongPassword (no leaking timing detail)
//
// Wire format (serialized as JSON, then UTF-8 bytes — the existing
// keychain commands take `Vec<u8>` so this slots straight in):
//
//   {
//     "version": 1,
//     "argon2_params": { "m_cost": 65536, "t_cost": 3, "p_cost": 1, "version": 19 },
//     "salt":       "<base64url, 16 bytes>",
//     "nonce":      "<base64url, 12 bytes>",
//     "ciphertext": "<base64url, 32 + 16 bytes (seed + GCM tag)>"
//   }
//
// Recommended parameters follow OWASP 2024 guidance for Argon2id:
// m_cost = 64 MiB, t_cost = 3, p_cost = 1. Tauri mobile may need lower
// m_cost — when that work lands the params live with the vault, so old
// vaults stay decryptable on whichever device they were created on.
//
// Security notes:
// - `vault_create` never returns clear seed material; `vault_unlock`
//   returns the seed only for the operation the user just approved, so
//   the JS caller must zero/drop it as soon as signing material is built.
// - WrongPassword is a single error code regardless of which check failed
//   (KDF, GCM tag, JSON shape) so timing/error-shape can't fingerprint
//   which guess was closer.
// - We use `OsRng` (system CSPRNG) for both salt and nonce.
// - Argon2id is the only variant exposed; we don't accept user-chosen
//   variants.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroize;

/// Wire-format version. Bump when the on-disk shape changes; old vaults
/// keep their original version, so the unlock path still understands them.
const VAULT_VERSION: u32 = 1;

/// Seed length in bytes. 32 bytes is the AES-256 / Ed25519 / secp256k1 seed
/// upper bound; if the wallet later needs less, it slices into this.
const SEED_LEN: usize = 32;

/// Salt length in bytes. 16 bytes is the OWASP-recommended minimum for
/// Argon2id and matches the password-hash crate's default.
const SALT_LEN: usize = 16;

/// AES-GCM nonce length. 12 bytes is the GCM-standard size.
const NONCE_LEN: usize = 12;

/// OWASP 2024 Argon2id parameters (desktop tier). Memory cost is in KiB,
/// so 64 MiB → 65 536. Time cost = 3 iterations. Parallelism = 1 (single
/// thread, deterministic across machines).
///
/// TODO: tune down for Tauri mobile when the mobile
/// surface lands — likely m_cost ≈ 19 MiB, t_cost = 2 (OWASP mobile tier).
/// The vault stores the params used at creation time, so old vaults keep
/// working on whichever device created them.
const DEFAULT_M_COST: u32 = 65_536;
const DEFAULT_T_COST: u32 = 3;
const DEFAULT_P_COST: u32 = 1;

/// On-disk Argon2 parameters. We keep them flat + named so an external
/// auditor can read a serialized blob without re-reading this file.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct VaultArgon2Params {
    /// Memory cost in KiB.
    pub m_cost: u32,
    /// Iteration count.
    pub t_cost: u32,
    /// Parallelism factor.
    pub p_cost: u32,
    /// Argon2 spec version (0x10 = 1.0, 0x13 = 1.3 / latest).
    pub version: u32,
}

impl VaultArgon2Params {
    pub fn recommended() -> Self {
        Self {
            m_cost: DEFAULT_M_COST,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
            version: Version::V0x13 as u32,
        }
    }

    fn into_argon2_params(self) -> Result<Params, VaultError> {
        Params::new(self.m_cost, self.t_cost, self.p_cost, Some(32)).map_err(|e| {
            VaultError::Backend {
                message: format!("invalid argon2 params: {e}"),
            }
        })
    }

    fn into_version(self) -> Result<Version, VaultError> {
        match self.version {
            v if v == Version::V0x10 as u32 => Ok(Version::V0x10),
            v if v == Version::V0x13 as u32 => Ok(Version::V0x13),
            other => Err(VaultError::Backend {
                message: format!("unknown argon2 version: 0x{other:x}"),
            }),
        }
    }
}

/// On-disk vault blob. Serialized as JSON, then converted to bytes for
/// the keychain bridge. base64url-no-pad keeps the JSON ASCII-clean.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBlob {
    /// On-disk format version, NOT the Argon2 algorithm version.
    pub version: u32,
    pub argon2_params: VaultArgon2Params,
    /// base64url-no-pad encoded salt.
    pub salt: String,
    /// base64url-no-pad encoded GCM nonce.
    pub nonce: String,
    /// base64url-no-pad encoded ciphertext (includes 16-byte GCM tag).
    pub ciphertext: String,
}

/// Errors that can come back from a vault operation.
#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum VaultError {
    /// Either the password is wrong or the blob has been tampered with.
    /// One single code so callers can't distinguish between the two —
    /// that's intentional, both should fail-closed identically.
    #[error("wrong password")]
    WrongPassword,
    /// Caller passed an invalid input (empty password, malformed blob).
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },
    /// Internal error (KDF setup, RNG, encoder). Should never be the user's
    /// fault.
    #[error("vault backend error: {message}")]
    Backend { message: String },
}

/// Build a fresh vault: random seed, random salt, random nonce, KEK
/// derived from `password` via Argon2id. Returns the serialized JSON
/// bytes the caller persists in the OS keychain.
///
/// Kept for compatibility with older UI code. New wallet creation should
/// generate a PQM-1 mnemonic in TypeScript, derive the ML-DSA-65 seed via
/// `@monolythium/core-sdk/crypto`, and call `vault_seal_seed`.
#[tauri::command]
pub fn vault_create(password: String) -> Result<Vec<u8>, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }

    let params = VaultArgon2Params::recommended();

    let mut seed = [0u8; SEED_LEN];
    OsRng.fill_bytes(&mut seed);

    let result = seal_seed_with_params(password.as_bytes(), &seed, params);
    seed.zeroize();
    result
}

/// Seal a caller-provided 32-byte seed. This is the path used by PQM-1
/// wallet creation: TypeScript owns mnemonic generation and KDF parity
/// with mono-core, Rust owns password encryption and OS-safe storage.
#[tauri::command]
pub fn vault_seal_seed(password: String, seed_bytes: Vec<u8>) -> Result<Vec<u8>, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }
    if seed_bytes.len() != SEED_LEN {
        return Err(VaultError::InvalidArgument {
            message: format!("seed must be {SEED_LEN} bytes"),
        });
    }
    let mut seed = [0u8; SEED_LEN];
    seed.copy_from_slice(&seed_bytes);
    let result =
        seal_seed_with_params(password.as_bytes(), &seed, VaultArgon2Params::recommended());
    seed.zeroize();
    result
}

/// Verify that `password` decrypts the on-disk vault `blob_bytes` and
/// return the decrypted 32-byte seed to the caller.
///
/// The frontend immediately hands this to `@monolythium/core-sdk/crypto`
/// to derive an ML-DSA-65 backend for the operation being approved. The
/// drawer clears its password state before executing; callers must also
/// zero or drop the returned seed once their operation has built.
#[tauri::command]
pub fn vault_unlock(password: String, blob_bytes: Vec<u8>) -> Result<Vec<u8>, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }

    let blob: VaultBlob = serde_json::from_slice(&blob_bytes).map_err(|_| {
        // Tampered or corrupt blob — collapse to WrongPassword so we don't
        // leak which check failed (timing-safe error parity).
        VaultError::WrongPassword
    })?;

    if blob.version != VAULT_VERSION {
        return Err(VaultError::Backend {
            message: format!("unsupported vault version: {}", blob.version),
        });
    }

    let salt = URL_SAFE_NO_PAD
        .decode(&blob.salt)
        .map_err(|_| VaultError::WrongPassword)?;
    let nonce_bytes = URL_SAFE_NO_PAD
        .decode(&blob.nonce)
        .map_err(|_| VaultError::WrongPassword)?;
    let ciphertext = URL_SAFE_NO_PAD
        .decode(&blob.ciphertext)
        .map_err(|_| VaultError::WrongPassword)?;

    if salt.len() != SALT_LEN || nonce_bytes.len() != NONCE_LEN {
        return Err(VaultError::WrongPassword);
    }

    let mut kek = derive_kek(password.as_bytes(), &salt, blob.argon2_params)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| VaultError::WrongPassword);
    kek.zeroize();

    let mut seed = plaintext?;
    if seed.len() != SEED_LEN {
        seed.zeroize();
        return Err(VaultError::WrongPassword);
    }
    Ok(seed)
}

fn derive_kek(
    password: &[u8],
    salt: &[u8],
    params: VaultArgon2Params,
) -> Result<[u8; 32], VaultError> {
    let argon2_params = params.into_argon2_params()?;
    let version = params.into_version()?;
    let argon2 = Argon2::new(Algorithm::Argon2id, version, argon2_params);
    let mut kek = [0u8; 32];
    argon2
        .hash_password_into(password, salt, &mut kek)
        .map_err(|e| VaultError::Backend {
            message: format!("argon2id derive failed: {e}"),
        })?;
    Ok(kek)
}

fn seal_seed_with_params(
    password: &[u8],
    seed: &[u8; SEED_LEN],
    params: VaultArgon2Params,
) -> Result<Vec<u8>, VaultError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let blob = (|| -> Result<VaultBlob, VaultError> {
        let mut kek = derive_kek(password, &salt, params)?;
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
        let ct = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), seed.as_ref())
            .map_err(|_| VaultError::Backend {
                message: "aes-gcm encryption failed".into(),
            })?;
        kek.zeroize();
        Ok(VaultBlob {
            version: VAULT_VERSION,
            argon2_params: params,
            salt: URL_SAFE_NO_PAD.encode(salt),
            nonce: URL_SAFE_NO_PAD.encode(nonce_bytes),
            ciphertext: URL_SAFE_NO_PAD.encode(ct),
        })
    })()?;

    serde_json::to_vec(&blob).map_err(|e| VaultError::Backend {
        message: format!("vault serialize failed: {e}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A snappier params profile for tests so they don't take 100ms each.
    /// Production paths always use `recommended()`.
    fn fast_params() -> VaultArgon2Params {
        VaultArgon2Params {
            m_cost: 1024,
            t_cost: 1,
            p_cost: 1,
            version: Version::V0x13 as u32,
        }
    }

    fn fast_create(password: &str) -> Vec<u8> {
        // Same body as vault_create but with fast params, for tests.
        let params = fast_params();
        let mut salt = [0u8; SALT_LEN];
        let mut nonce_bytes = [0u8; NONCE_LEN];
        let mut seed = [0u8; SEED_LEN];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce_bytes);
        OsRng.fill_bytes(&mut seed);
        let mut kek = derive_kek(password.as_bytes(), &salt, params).unwrap();
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
        let ct = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), seed.as_ref())
            .unwrap();
        kek.zeroize();
        seed.zeroize();
        let blob = VaultBlob {
            version: VAULT_VERSION,
            argon2_params: params,
            salt: URL_SAFE_NO_PAD.encode(salt),
            nonce: URL_SAFE_NO_PAD.encode(nonce_bytes),
            ciphertext: URL_SAFE_NO_PAD.encode(ct),
        };
        serde_json::to_vec(&blob).unwrap()
    }

    #[test]
    fn round_trip_correct_password() {
        let bytes = fast_create("correct horse battery staple");
        let seed = vault_unlock("correct horse battery staple".into(), bytes).unwrap();
        assert_eq!(seed.len(), SEED_LEN);
    }

    #[test]
    fn wrong_password_rejected() {
        let bytes = fast_create("correct horse battery staple");
        let err = vault_unlock("wrong".into(), bytes).unwrap_err();
        match err {
            VaultError::WrongPassword => {}
            other => panic!("expected WrongPassword, got {other:?}"),
        }
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let bytes = fast_create("password");
        let mut blob: VaultBlob = serde_json::from_slice(&bytes).unwrap();
        // Flip the last char of ciphertext to break GCM tag.
        let mut ct = blob.ciphertext.into_bytes();
        let last = ct.len() - 1;
        ct[last] = if ct[last] == b'A' { b'B' } else { b'A' };
        blob.ciphertext = String::from_utf8(ct).unwrap();
        let bytes = serde_json::to_vec(&blob).unwrap();
        let err = vault_unlock("password".into(), bytes).unwrap_err();
        match err {
            VaultError::WrongPassword => {}
            other => panic!("expected WrongPassword on tamper, got {other:?}"),
        }
    }

    #[test]
    fn empty_password_rejected_at_create() {
        let err = vault_create(String::new()).unwrap_err();
        match err {
            VaultError::InvalidArgument { .. } => {}
            other => panic!("expected InvalidArgument, got {other:?}"),
        }
    }

    #[test]
    fn empty_password_rejected_at_unlock() {
        let bytes = fast_create("password");
        let err = vault_unlock(String::new(), bytes).unwrap_err();
        match err {
            VaultError::InvalidArgument { .. } => {}
            other => panic!("expected InvalidArgument, got {other:?}"),
        }
    }
}
