// Password-protected vault — Argon2id + XChaCha20-Poly1305.
//
// The vault seals the wallet's secret material under a key derived from the
// user's password via Argon2id (OWASP 2024 desktop params). What the OS
// keychain stores is the encrypted blob — the password itself is never
// persisted. XChaCha20-Poly1305 is the keystore AEAD (whitepaper §13.3); its
// 24-byte nonce makes a fresh random nonce per seal safe.
//
// Two pieces of secret material can be sealed together:
//   - the 32-byte ML-DSA-65 keygen seed (always present) — what every unlock
//     returns and what signing consumes; and
//   - the 32-byte PQM-1 payload (the reversible BIP-39 entropy) — present for
//     wallets created or imported in-app, and what powers "Show recovery
//     phrase". A vault sealed without it simply cannot reveal a phrase.
//
//   seal:    password → argon2id → KEK
//            plaintext  = [secret_kind] || seed[32] || payload[32]?
//            ciphertext = xchacha20poly1305(plaintext, KEK, nonce, AAD)
//            persist { version, aead, argon2_params, salt, nonce, ciphertext }
//
//   unlock:  load blob → KEK = argon2id(password, salt, params)
//            plaintext = xchacha20poly1305-open(ciphertext, KEK, nonce, AAD)
//            return seed (plaintext[1..33]); on auth failure → WrongPassword
//
//   reveal:  same decrypt, but returns the payload (plaintext[33..65]) when
//            present, never the seed; absent → NoRecoveryMaterial.
//
// Wire format (JSON, then UTF-8 bytes — the keychain commands take Vec<u8>):
//
//   {
//     "version": 2,
//     "aead": "xchacha20-poly1305",
//     "argon2_params": { "m_cost": 65536, "t_cost": 3, "p_cost": 1, "version": 19 },
//     "salt":       "<base64url, 16 bytes>",
//     "nonce":      "<base64url, 24 bytes>",
//     "ciphertext": "<base64url, plaintext + 16-byte Poly1305 tag>"
//   }
//
// Argon2id params follow OWASP 2024 guidance: m_cost = 64 MiB, t_cost = 3,
// p_cost = 1. The params live with the vault, so a vault stays decryptable on
// whichever device created it.
//
// Security notes:
// - `vault_unlock` returns the seed only for the operation the user just
//   approved; the JS caller zeroes it once signing material is built.
// - `vault_reveal` returns only the payload, never the seed.
// - WrongPassword is a single error code regardless of which check failed
//   (KDF, AEAD tag, JSON shape) so timing/error-shape can't fingerprint which
//   guess was closer. The one exception is a blob from an older, unsupported
//   format: it returns a clear "re-import your recovery phrase" message.
// - We use `OsRng` (system CSPRNG) for both salt and nonce.
// - Argon2id is the only KDF variant exposed.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    Key, XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

/// On-disk format version. v2 = XChaCha20-Poly1305 over the
/// `[secret_kind || seed || payload?]` plaintext. Bumped from the historical
/// v1 (AES-256-GCM, seed-only); v1 is not read by this build.
const VAULT_VERSION: u32 = 2;

/// AEAD identifier written into the blob so the format is self-describing.
const VAULT_AEAD: &str = "xchacha20-poly1305";

/// Associated data bound into every seal/open. Ties the ciphertext to this
/// format so a tampered `version`/`aead` field fails authentication rather
/// than silently selecting another path.
const VAULT_AAD: &[u8] = b"monolythium.vault.v2";

/// Seed length in bytes (the ML-DSA-65 keygen seed).
const SEED_LEN: usize = 32;

/// PQM-1 payload length in bytes (the reversible BIP-39 entropy).
const PAYLOAD_LEN: usize = 32;

/// Salt length in bytes. 16 bytes is the OWASP-recommended minimum for
/// Argon2id and matches the password-hash crate's default.
const SALT_LEN: usize = 16;

/// XChaCha20 extended-nonce length.
const XNONCE_LEN: usize = 24;

/// `secret_kind` byte: only the seed is sealed (no recovery phrase to reveal).
const KIND_SEED_ONLY: u8 = 0x01;
/// `secret_kind` byte: seed followed by the 32-byte PQM-1 payload (revealable).
const KIND_SEED_AND_PAYLOAD: u8 = 0x02;

/// OWASP 2024 Argon2id parameters (desktop tier). Memory cost is in KiB, so
/// 64 MiB → 65 536. Time cost = 3 iterations. Parallelism = 1 (single thread,
/// deterministic across machines).
///
/// TODO: tune down for Tauri mobile when the mobile surface lands — likely
/// m_cost ≈ 19 MiB, t_cost = 2 (OWASP mobile tier). The vault stores the
/// params used at creation time, so old vaults keep working on whichever
/// device created them.
const DEFAULT_M_COST: u32 = 65_536;
const DEFAULT_T_COST: u32 = 3;
const DEFAULT_P_COST: u32 = 1;

/// On-disk Argon2 parameters. We keep them flat + named so an external auditor
/// can read a serialized blob without re-reading this file.
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

/// On-disk vault blob. Serialized as JSON, then converted to bytes for the
/// keychain bridge. base64url-no-pad keeps the JSON ASCII-clean.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultBlob {
    /// On-disk format version, NOT the Argon2 algorithm version.
    pub version: u32,
    /// AEAD identifier. Defaulted so a blob written by an unsupported older
    /// format still parses far enough to reach the version check and produce a
    /// clear "re-import" message instead of an opaque parse failure.
    #[serde(default)]
    pub aead: String,
    pub argon2_params: VaultArgon2Params,
    /// base64url-no-pad encoded salt.
    pub salt: String,
    /// base64url-no-pad encoded XChaCha20 nonce.
    pub nonce: String,
    /// base64url-no-pad encoded ciphertext (includes the 16-byte Poly1305 tag).
    pub ciphertext: String,
}

/// Errors that can come back from a vault operation.
#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum VaultError {
    /// Either the password is wrong or the blob has been tampered with. One
    /// single code so callers can't distinguish between the two — that's
    /// intentional, both should fail-closed identically.
    #[error("wrong password")]
    WrongPassword,
    /// Caller passed an invalid input (empty password, malformed blob).
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },
    /// Internal error (KDF setup, RNG, encoder) or an unsupported on-disk
    /// format. Should never be the user's fault.
    #[error("vault backend error: {message}")]
    Backend { message: String },
}

/// Outcome of a `vault_reveal` call. `Payload` carries the 32-byte PQM-1
/// payload (the reversible BIP-39 entropy); `NoRecoveryMaterial` means the
/// vault was sealed seed-only and has no phrase to show. Serialized with a
/// `kind` discriminator so the TS side gets `{ kind: "payload", payload }` or
/// `{ kind: "no_recovery_material" }`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RevealResult {
    Payload { payload: Vec<u8> },
    NoRecoveryMaterial,
}

/// Build a fresh vault from a random seed (no recovery phrase). Returns the
/// serialized JSON bytes the caller persists in the OS keychain.
///
/// Kept for compatibility with older UI code. New wallet creation generates a
/// PQM-1 mnemonic in TypeScript, derives the ML-DSA-65 seed via
/// `@monolythium/core-sdk/crypto`, and calls `vault_seal_v2` with the payload.
#[tauri::command]
pub fn vault_create(password: String) -> Result<Vec<u8>, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }

    let mut seed = [0u8; SEED_LEN];
    OsRng.fill_bytes(&mut seed);

    let result = seal_v2_with_params(
        password.as_bytes(),
        &seed,
        None,
        VaultArgon2Params::recommended(),
    );
    seed.zeroize();
    result
}

/// Seal a caller-provided 32-byte seed with no recovery payload. The resulting
/// vault unlocks for signing but cannot reveal a recovery phrase.
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
        seal_v2_with_params(password.as_bytes(), &seed, None, VaultArgon2Params::recommended());
    seed.zeroize();
    result
}

/// Seal a 32-byte seed and, optionally, the 32-byte PQM-1 payload that makes
/// the recovery phrase revealable. This is the path PQM-1 wallet creation /
/// import uses: TypeScript owns mnemonic generation + KDF, Rust owns password
/// encryption and OS-safe storage.
#[tauri::command]
pub fn vault_seal_v2(
    password: String,
    seed_bytes: Vec<u8>,
    payload_bytes: Option<Vec<u8>>,
) -> Result<Vec<u8>, VaultError> {
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
    if let Some(ref p) = payload_bytes {
        if p.len() != PAYLOAD_LEN {
            return Err(VaultError::InvalidArgument {
                message: format!("payload must be {PAYLOAD_LEN} bytes"),
            });
        }
    }
    let mut seed = [0u8; SEED_LEN];
    seed.copy_from_slice(&seed_bytes);
    let result = seal_v2_with_params(
        password.as_bytes(),
        &seed,
        payload_bytes.as_deref(),
        VaultArgon2Params::recommended(),
    );
    seed.zeroize();
    if let Some(mut p) = payload_bytes {
        p.zeroize();
    }
    result
}

/// Verify that `password` decrypts the on-disk vault `blob_bytes` and return
/// the decrypted 32-byte seed to the caller.
///
/// The frontend immediately hands this to `@monolythium/core-sdk/crypto` to
/// derive an ML-DSA-65 backend for the operation being approved. Callers must
/// zero or drop the returned seed once their operation has built.
#[tauri::command]
pub fn vault_unlock(password: String, blob_bytes: Vec<u8>) -> Result<Vec<u8>, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }
    let plaintext = decrypt_v2(password.as_bytes(), &blob_bytes)?;
    // The seed is plaintext[1..33] for both secret kinds; the recovery payload,
    // if any, is never returned here.
    Ok(plaintext[1..1 + SEED_LEN].to_vec())
}

/// Decrypt the vault and return the recovery payload if it was sealed.
/// Distinct from `vault_unlock` so the signing path never carries the payload
/// and the reveal path never returns the seed.
#[tauri::command]
pub fn vault_reveal(password: String, blob_bytes: Vec<u8>) -> Result<RevealResult, VaultError> {
    if password.is_empty() {
        return Err(VaultError::InvalidArgument {
            message: "password is empty".into(),
        });
    }
    let plaintext = decrypt_v2(password.as_bytes(), &blob_bytes)?;
    match plaintext.first() {
        Some(&KIND_SEED_AND_PAYLOAD) => {
            // Return only the payload bytes; the seed (plaintext[1..33]) is
            // left untouched and zeroed when `plaintext` drops.
            let payload = plaintext[1 + SEED_LEN..1 + SEED_LEN + PAYLOAD_LEN].to_vec();
            Ok(RevealResult::Payload { payload })
        }
        _ => Ok(RevealResult::NoRecoveryMaterial),
    }
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

fn seal_v2_with_params(
    password: &[u8],
    seed: &[u8; SEED_LEN],
    payload: Option<&[u8]>,
    params: VaultArgon2Params,
) -> Result<Vec<u8>, VaultError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; XNONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    // Inner plaintext: [secret_kind] || seed || payload?
    let kind = if payload.is_some() {
        KIND_SEED_AND_PAYLOAD
    } else {
        KIND_SEED_ONLY
    };
    let mut plaintext = Zeroizing::new(Vec::with_capacity(1 + SEED_LEN + PAYLOAD_LEN));
    plaintext.push(kind);
    plaintext.extend_from_slice(seed);
    if let Some(p) = payload {
        plaintext.extend_from_slice(p);
    }

    let blob = (|| -> Result<VaultBlob, VaultError> {
        let mut kek = derive_kek(password, &salt, params)?;
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&kek));
        let ct = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &plaintext,
                    aad: VAULT_AAD,
                },
            )
            .map_err(|_| VaultError::Backend {
                message: "xchacha20-poly1305 encryption failed".into(),
            })?;
        // Self-check: the ciphertext we are about to persist must open back to
        // the exact plaintext. A vault that can't be re-opened would strand the
        // wallet, so we never return one.
        let check = Zeroizing::new(
            cipher
                .decrypt(
                    XNonce::from_slice(&nonce),
                    Payload {
                        msg: &ct,
                        aad: VAULT_AAD,
                    },
                )
                .map_err(|_| VaultError::Backend {
                    message: "vault seal self-check failed".into(),
                })?,
        );
        kek.zeroize();
        if check.as_slice() != plaintext.as_slice() {
            return Err(VaultError::Backend {
                message: "vault seal self-check mismatch".into(),
            });
        }
        Ok(VaultBlob {
            version: VAULT_VERSION,
            aead: VAULT_AEAD.to_string(),
            argon2_params: params,
            salt: URL_SAFE_NO_PAD.encode(salt),
            nonce: URL_SAFE_NO_PAD.encode(nonce),
            ciphertext: URL_SAFE_NO_PAD.encode(ct),
        })
    })()?;

    serde_json::to_vec(&blob).map_err(|e| VaultError::Backend {
        message: format!("vault serialize failed: {e}"),
    })
}

/// Decrypt a v2 blob and return the full inner plaintext (`[kind] || seed ||
/// payload?`), validated for kind/length consistency. Shared by `vault_unlock`
/// and `vault_reveal`. The returned buffer is zeroed on drop.
fn decrypt_v2(password: &[u8], blob_bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    let blob: VaultBlob = serde_json::from_slice(blob_bytes).map_err(|_| {
        // Tampered or corrupt blob — collapse to WrongPassword so we don't
        // leak which check failed (timing-safe error parity).
        VaultError::WrongPassword
    })?;

    if blob.version != VAULT_VERSION {
        // Not a lockout in practice: PQM-1 is deterministic, so re-importing
        // the 24-word phrase reproduces the same wallet. Give a clear cue.
        return Err(VaultError::Backend {
            message: format!(
                "This vault uses an older, unsupported format (v{}). Re-import your 24-word recovery phrase to use it with this version.",
                blob.version
            ),
        });
    }
    if blob.aead != VAULT_AEAD {
        return Err(VaultError::Backend {
            message: format!("unsupported vault aead: {}", blob.aead),
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

    if salt.len() != SALT_LEN || nonce_bytes.len() != XNONCE_LEN {
        return Err(VaultError::WrongPassword);
    }

    let mut kek = derive_kek(password, &salt, blob.argon2_params)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&kek));
    let opened = cipher.decrypt(
        XNonce::from_slice(&nonce_bytes),
        Payload {
            msg: ciphertext.as_ref(),
            aad: VAULT_AAD,
        },
    );
    kek.zeroize();

    let plaintext = Zeroizing::new(opened.map_err(|_| VaultError::WrongPassword)?);

    // The Poly1305 tag already proved authenticity; this asserts the plaintext
    // shape matches its declared kind so the parser can't slice past the end.
    let consistent = match plaintext.first() {
        Some(&KIND_SEED_ONLY) => plaintext.len() == 1 + SEED_LEN,
        Some(&KIND_SEED_AND_PAYLOAD) => plaintext.len() == 1 + SEED_LEN + PAYLOAD_LEN,
        _ => false,
    };
    if !consistent {
        return Err(VaultError::Backend {
            message: "vault plaintext shape invalid".into(),
        });
    }

    Ok(plaintext)
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

    fn fast_seal(seed: &[u8; SEED_LEN], payload: Option<&[u8]>, password: &str) -> Vec<u8> {
        seal_v2_with_params(password.as_bytes(), seed, payload, fast_params()).unwrap()
    }

    /// Seal arbitrary plaintext bytes (test-only) so we can craft a blob whose
    /// inner shape disagrees with its `secret_kind`.
    fn seal_raw(plaintext: &[u8], password: &str) -> Vec<u8> {
        let params = fast_params();
        let mut salt = [0u8; SALT_LEN];
        let mut nonce = [0u8; XNONCE_LEN];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce);
        let kek = derive_kek(password.as_bytes(), &salt, params).unwrap();
        let cipher = XChaCha20Poly1305::new(Key::from_slice(&kek));
        let ct = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: VAULT_AAD,
                },
            )
            .unwrap();
        let blob = VaultBlob {
            version: VAULT_VERSION,
            aead: VAULT_AEAD.to_string(),
            argon2_params: params,
            salt: URL_SAFE_NO_PAD.encode(salt),
            nonce: URL_SAFE_NO_PAD.encode(nonce),
            ciphertext: URL_SAFE_NO_PAD.encode(ct),
        };
        serde_json::to_vec(&blob).unwrap()
    }

    fn sample_payload() -> [u8; PAYLOAD_LEN] {
        // [algo 0x01][version 0x01][30 bytes entropy] — shape only; opaque here.
        let mut p = [0u8; PAYLOAD_LEN];
        p[0] = 0x01;
        p[1] = 0x01;
        for (i, b) in p.iter_mut().enumerate().skip(2) {
            *b = i as u8;
        }
        p
    }

    #[test]
    fn round_trip_with_payload() {
        let seed = [7u8; SEED_LEN];
        let payload = sample_payload();
        let blob = fast_seal(&seed, Some(&payload), "correct horse battery staple");

        let got = vault_unlock("correct horse battery staple".into(), blob.clone()).unwrap();
        assert_eq!(got, seed.to_vec());

        match vault_reveal("correct horse battery staple".into(), blob).unwrap() {
            RevealResult::Payload { payload: p } => assert_eq!(p, payload.to_vec()),
            other => panic!("expected payload, got {other:?}"),
        }
    }

    #[test]
    fn round_trip_seed_only() {
        let seed = [9u8; SEED_LEN];
        let blob = fast_seal(&seed, None, "pw");
        assert_eq!(vault_unlock("pw".into(), blob.clone()).unwrap(), seed.to_vec());
        assert!(matches!(
            vault_reveal("pw".into(), blob).unwrap(),
            RevealResult::NoRecoveryMaterial
        ));
    }

    #[test]
    fn wrong_password_fails_closed_on_unlock_and_reveal() {
        let seed = [1u8; SEED_LEN];
        let payload = sample_payload();
        let blob = fast_seal(&seed, Some(&payload), "right");
        assert!(matches!(
            vault_unlock("wrong".into(), blob.clone()).unwrap_err(),
            VaultError::WrongPassword
        ));
        assert!(matches!(
            vault_reveal("wrong".into(), blob).unwrap_err(),
            VaultError::WrongPassword
        ));
    }

    #[test]
    fn nonce_unique_across_seals() {
        let seed = [3u8; SEED_LEN];
        let b1 = fast_seal(&seed, None, "pw");
        let b2 = fast_seal(&seed, None, "pw");
        let v1: VaultBlob = serde_json::from_slice(&b1).unwrap();
        let v2: VaultBlob = serde_json::from_slice(&b2).unwrap();
        assert_ne!(v1.nonce, v2.nonce, "nonces must differ across seals");
        assert_ne!(v1.ciphertext, v2.ciphertext);
        // 24-byte XChaCha nonce.
        assert_eq!(URL_SAFE_NO_PAD.decode(&v1.nonce).unwrap().len(), XNONCE_LEN);
    }

    #[test]
    fn tampered_ciphertext_fails_closed() {
        let seed = [4u8; SEED_LEN];
        let blob = fast_seal(&seed, None, "pw");
        let mut v: VaultBlob = serde_json::from_slice(&blob).unwrap();
        let mut ct = v.ciphertext.into_bytes();
        let last = ct.len() - 1;
        ct[last] = if ct[last] == b'A' { b'B' } else { b'A' };
        v.ciphertext = String::from_utf8(ct).unwrap();
        let bytes = serde_json::to_vec(&v).unwrap();
        assert!(matches!(
            vault_unlock("pw".into(), bytes).unwrap_err(),
            VaultError::WrongPassword
        ));
    }

    #[test]
    fn tampered_aead_field_rejected() {
        let seed = [5u8; SEED_LEN];
        let blob = fast_seal(&seed, None, "pw");
        let mut v: VaultBlob = serde_json::from_slice(&blob).unwrap();
        v.aead = "aes-256-gcm".into();
        let bytes = serde_json::to_vec(&v).unwrap();
        assert!(matches!(
            vault_unlock("pw".into(), bytes).unwrap_err(),
            VaultError::Backend { .. }
        ));
    }

    #[test]
    fn version_downgrade_rejected_with_reimport_message() {
        // The AAD binds the v2 domain; even reading a flipped-version blob, the
        // version gate fires first and returns the clear re-import message.
        let seed = [6u8; SEED_LEN];
        let blob = fast_seal(&seed, None, "pw");
        let mut v: VaultBlob = serde_json::from_slice(&blob).unwrap();
        v.version = 1;
        let bytes = serde_json::to_vec(&v).unwrap();
        match vault_unlock("pw".into(), bytes).unwrap_err() {
            VaultError::Backend { message } => {
                assert!(message.to_lowercase().contains("re-import"));
            }
            other => panic!("expected Backend re-import message, got {other:?}"),
        }
    }

    #[test]
    fn kind_length_mismatch_rejected() {
        // secret_kind claims a payload (0x02) but only 33 bytes are present.
        let mut bad = vec![KIND_SEED_AND_PAYLOAD];
        bad.extend_from_slice(&[1u8; SEED_LEN]);
        let blob = seal_raw(&bad, "pw");
        assert!(matches!(
            vault_unlock("pw".into(), blob).unwrap_err(),
            VaultError::Backend { .. }
        ));
    }

    #[test]
    fn unknown_kind_rejected() {
        let mut bad = vec![0x00u8];
        bad.extend_from_slice(&[1u8; SEED_LEN]);
        let blob = seal_raw(&bad, "pw");
        assert!(matches!(
            vault_unlock("pw".into(), blob).unwrap_err(),
            VaultError::Backend { .. }
        ));
    }

    #[test]
    fn reveal_never_returns_seed() {
        let seed = [8u8; SEED_LEN];
        let payload = sample_payload();
        let blob = fast_seal(&seed, Some(&payload), "pw");
        match vault_reveal("pw".into(), blob).unwrap() {
            RevealResult::Payload { payload: p } => {
                assert_eq!(p.len(), PAYLOAD_LEN);
                assert_ne!(p, seed.to_vec(), "reveal must not return the seed");
                assert_eq!(p, payload.to_vec());
            }
            other => panic!("expected payload, got {other:?}"),
        }
    }

    #[test]
    fn seal_via_command_round_trips() {
        let seed = vec![2u8; SEED_LEN];
        let payload = sample_payload().to_vec();
        // vault_seal_v2 uses production Argon2 params; this also exercises the
        // command-level validation + the seal self-check.
        let blob = vault_seal_v2("pw".into(), seed.clone(), Some(payload.clone())).unwrap();
        assert_eq!(vault_unlock("pw".into(), blob.clone()).unwrap(), seed);
        match vault_reveal("pw".into(), blob).unwrap() {
            RevealResult::Payload { payload: p } => assert_eq!(p, payload),
            other => panic!("expected payload, got {other:?}"),
        }
    }

    #[test]
    fn seal_rejects_wrong_lengths() {
        assert!(matches!(
            vault_seal_v2("pw".into(), vec![0u8; 31], None).unwrap_err(),
            VaultError::InvalidArgument { .. }
        ));
        assert!(matches!(
            vault_seal_v2("pw".into(), vec![0u8; SEED_LEN], Some(vec![0u8; 16])).unwrap_err(),
            VaultError::InvalidArgument { .. }
        ));
    }

    #[test]
    fn empty_password_rejected() {
        assert!(matches!(
            vault_create(String::new()).unwrap_err(),
            VaultError::InvalidArgument { .. }
        ));
        let blob = fast_seal(&[1u8; SEED_LEN], None, "pw");
        assert!(matches!(
            vault_unlock(String::new(), blob.clone()).unwrap_err(),
            VaultError::InvalidArgument { .. }
        ));
        assert!(matches!(
            vault_reveal(String::new(), blob).unwrap_err(),
            VaultError::InvalidArgument { .. }
        ));
    }
}
