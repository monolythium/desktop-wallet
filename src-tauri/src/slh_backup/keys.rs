// SLH-DSA-SHA2-128s keypair generation + Zeroizing wrappers.
//
// `generate_slh_keypair_from_entropy(entropy)` is the deterministic
// path used by the recovery flow: SHAKE256 expansion of `(domain ||
// entropy)` seeds a `rand::StdRng`, which feeds `fips205::try_keygen_
// with_rng` to produce a reproducible (PublicKey, PrivateKey). The
// same entropy at enrolment + recovery → same keypair, so the user's
// 24-word BIP-39 mnemonic is sufficient to re-derive the backup key.
//
// `generate_slh_keypair()` is the live-enrolment path: a fresh
// 32-byte entropy is sampled via OsRng and the deterministic helper
// is invoked. Returns the entropy alongside the keypair so the
// caller can show the user the mnemonic + seal the entropy under
// the recovery password.

use fips205::slh_dsa_sha2_128s::{self, PrivateKey, PublicKey, PK_LEN, SIG_LEN, SK_LEN};
use fips205::traits::{KeyGen, SerDes};
use rand::{rngs::OsRng, RngCore, SeedableRng};
use serde::{Deserialize, Serialize};
use sha3::{digest::{ExtendableOutput, Update, XofReader}, Shake256};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

/// Chain-side algorithm id for SLH-DSA-SHA2-128s. Per Monolythium v2
/// spec + the emergency-key-registry precompile at 0x1100, this is
/// the `u16` value the chain expects in `register(uint16, bytes)`.
pub const SLH_BACKUP_ALGO_ID: u16 = 1101;

/// SLH-DSA-SHA2-128s public key length per FIPS 205 Table 1.
pub const SLH_PK_LEN: usize = PK_LEN;
/// SLH-DSA-SHA2-128s secret key length per FIPS 205 Table 1.
pub const SLH_SK_LEN: usize = SK_LEN;
/// SLH-DSA-SHA2-128s signature length per FIPS 205 Table 1 (small
/// variant — 7856 bytes; the 'f' variant produces 17088-byte
/// signatures but signs slower).
pub const SLH_SIG_LEN: usize = SIG_LEN;

/// Length of the BIP-39 entropy the wallet generates per backup.
/// 32 bytes → 24 words → covers the 128-bit PQ security target with
/// comfortable headroom. Matches browser-wallet's same field.
pub const SLH_ENTROPY_LEN: usize = 32;

/// SHAKE256 domain tag for backup seed expansion. Identical to the
/// browser-wallet's `SLH_DSA_BACKUP_DOMAIN_TAG` so an emergency
/// signature generated on one platform verifies on the other once
/// the chain accepts SLH-DSA proofs.
pub const SLH_BACKUP_DOMAIN_TAG: &[u8] = b"monolythium.slh-dsa-backup.v1";

/// Zeroizing wrapper around the 64-byte SLH-DSA secret key. Drop
/// wipes the contents; access is via `as_bytes()`.
pub struct SlhSecretKey(Zeroizing<[u8; SLH_SK_LEN]>);

impl SlhSecretKey {
    pub fn from_bytes(bytes: [u8; SLH_SK_LEN]) -> Self {
        Self(Zeroizing::new(bytes))
    }
    pub fn as_bytes(&self) -> &[u8; SLH_SK_LEN] {
        &self.0
    }
}

impl std::fmt::Debug for SlhSecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SlhSecretKey(<redacted>)")
    }
}

/// Plain public-key wrapper. Public material — no zeroization needed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlhPublicKey(pub [u8; SLH_PK_LEN]);

impl SlhPublicKey {
    pub fn from_bytes(bytes: [u8; SLH_PK_LEN]) -> Self {
        Self(bytes)
    }
    pub fn as_bytes(&self) -> &[u8; SLH_PK_LEN] {
        &self.0
    }
}

/// Errors specific to the SLH-DSA backup layer.
#[derive(Debug, Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum SlhBackupError {
    #[error("invalid entropy length (must be {expected} bytes)")]
    InvalidEntropy { expected: usize },
    #[error("keygen failed")]
    Keygen,
    #[error("sign failed")]
    Sign,
    #[error("verify failed")]
    Verify,
    #[error("malformed payload")]
    Malformed,
}

/// SHAKE256-expand `(domain || entropy)` into the 32-byte StdRng
/// seed. Exported so the test seam can pin a known entropy → seed
/// derivation.
pub fn derive_rng_seed(entropy: &[u8; SLH_ENTROPY_LEN]) -> [u8; 32] {
    let mut hasher = Shake256::default();
    hasher.update(SLH_BACKUP_DOMAIN_TAG);
    hasher.update(entropy);
    let mut reader = hasher.finalize_xof();
    let mut seed = [0u8; 32];
    reader.read(&mut seed);
    seed
}

/// Generate a keypair deterministically from `entropy`. Used by both
/// the enrolment path (fresh entropy from OsRng) and the recovery
/// path (entropy reconstructed from the user's BIP-39 mnemonic).
pub fn generate_slh_keypair_from_entropy(
    entropy: &[u8; SLH_ENTROPY_LEN],
) -> Result<(SlhPublicKey, SlhSecretKey), SlhBackupError> {
    let seed = derive_rng_seed(entropy);
    let mut rng = rand::rngs::StdRng::from_seed(seed);
    let (pk, sk) = slh_dsa_sha2_128s::KG::try_keygen_with_rng(&mut rng)
        .map_err(|_| SlhBackupError::Keygen)?;
    let pk_bytes = pk.into_bytes();
    let sk_bytes = sk.into_bytes();
    Ok((SlhPublicKey::from_bytes(pk_bytes), SlhSecretKey::from_bytes(sk_bytes)))
}

/// Live-enrolment helper: sample fresh 32-byte entropy via OsRng,
/// derive the keypair, return all three so the caller can seal the
/// entropy + secret + show the mnemonic. The returned entropy is in
/// a Zeroizing wrapper — caller is responsible for clearing it
/// after the mnemonic + seal slots have consumed it.
pub fn generate_slh_keypair(
) -> Result<(SlhPublicKey, SlhSecretKey, Zeroizing<[u8; SLH_ENTROPY_LEN]>), SlhBackupError> {
    let mut entropy = Zeroizing::new([0u8; SLH_ENTROPY_LEN]);
    OsRng.fill_bytes(entropy.as_mut());
    let (pk, sk) = generate_slh_keypair_from_entropy(&entropy)?;
    Ok((pk, sk, entropy))
}

/// Reconstruct the SLH-DSA `PrivateKey` value from its on-disk bytes.
/// fips205 demands the typed struct for signing, but we ship the raw
/// bytes on disk (sealed under VEK) — this helper converts. Returns
/// `Malformed` on bytes length / format mismatch.
pub(crate) fn private_key_from_bytes(
    bytes: &[u8; SLH_SK_LEN],
) -> Result<PrivateKey, SlhBackupError> {
    PrivateKey::try_from_bytes(bytes).map_err(|_| SlhBackupError::Malformed)
}

/// Reconstruct the SLH-DSA `PublicKey` value from its on-disk bytes.
pub(crate) fn public_key_from_bytes(
    bytes: &[u8; SLH_PK_LEN],
) -> Result<PublicKey, SlhBackupError> {
    PublicKey::try_from_bytes(bytes).map_err(|_| SlhBackupError::Malformed)
}

/// Test seam — zero-out a Zeroizing entropy explicitly. The Drop
/// impl runs at scope end too; this is just for tests that hold
/// the buffer past its natural lifetime and want to assert wiping.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) fn _test_zero_entropy(z: &mut Zeroizing<[u8; SLH_ENTROPY_LEN]>) {
    z.as_mut().zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_rng_seed_is_deterministic_for_same_entropy() {
        let e = [0x42u8; SLH_ENTROPY_LEN];
        let a = derive_rng_seed(&e);
        let b = derive_rng_seed(&e);
        assert_eq!(a, b);
    }

    #[test]
    fn derive_rng_seed_differs_for_different_entropy() {
        let a = derive_rng_seed(&[0u8; SLH_ENTROPY_LEN]);
        let b = derive_rng_seed(&[1u8; SLH_ENTROPY_LEN]);
        assert_ne!(a, b);
    }

    #[test]
    fn keypair_from_entropy_is_deterministic() {
        let e = [0x33u8; SLH_ENTROPY_LEN];
        let (pk_a, _sk_a) = generate_slh_keypair_from_entropy(&e).unwrap();
        let (pk_b, _sk_b) = generate_slh_keypair_from_entropy(&e).unwrap();
        assert_eq!(pk_a, pk_b);
    }

    #[test]
    fn keypair_from_different_entropies_diverges() {
        let (pk_a, _) =
            generate_slh_keypair_from_entropy(&[0u8; SLH_ENTROPY_LEN]).unwrap();
        let (pk_b, _) =
            generate_slh_keypair_from_entropy(&[1u8; SLH_ENTROPY_LEN]).unwrap();
        assert_ne!(pk_a, pk_b);
    }

    #[test]
    fn pubkey_has_correct_length() {
        let (pk, _) =
            generate_slh_keypair_from_entropy(&[7u8; SLH_ENTROPY_LEN]).unwrap();
        assert_eq!(pk.as_bytes().len(), 32);
    }

    #[test]
    fn secret_has_correct_length_and_zeroizes_on_drop() {
        let (_, sk) =
            generate_slh_keypair_from_entropy(&[7u8; SLH_ENTROPY_LEN]).unwrap();
        assert_eq!(sk.as_bytes().len(), 64);
        // Drop happens at scope end — we can't observe wipe directly
        // without unsafe, but Zeroizing's Drop impl is the contract.
        drop(sk);
    }

    #[test]
    fn algo_id_matches_spec() {
        assert_eq!(SLH_BACKUP_ALGO_ID, 1101);
    }

    #[test]
    fn live_keygen_produces_valid_shaped_outputs() {
        let (pk, sk, _entropy) = generate_slh_keypair().unwrap();
        assert_eq!(pk.as_bytes().len(), SLH_PK_LEN);
        assert_eq!(sk.as_bytes().len(), SLH_SK_LEN);
    }

    #[test]
    fn live_keygen_produces_unique_keypairs_across_calls() {
        let (pk_a, _, _) = generate_slh_keypair().unwrap();
        let (pk_b, _, _) = generate_slh_keypair().unwrap();
        assert_ne!(pk_a, pk_b);
    }
}
