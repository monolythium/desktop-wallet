// Per-vault VEK (Vault Encryption Key) wrap / unwrap + payload seal /
// open.
//
// Every vault has its own 32-byte VEK, generated fresh at vault
// creation. The VEK seals the actual signing-key payload (ML-DSA-65
// seed today; future PQ key material later) under AES-256-GCM. The
// VEK itself is wrapped under the MEK and stored in the container.
//
// This two-layer split has two practical benefits:
//
//   1. A user changing master password only re-wraps every VEK; no
//      re-seal of the payload (which would re-derive ML-DSA material).
//   2. A vault export becomes "the wrapped_vek + sealed_payload",
//      portable across machines if the recipient knows the master
//      password — Phase 6+ feature, design-friendly here.

use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

use super::container::{SealedPayload, WrappedKey, GCM_NONCE_LEN};
use super::mek::{aead_open, aead_seal, aead_unwrap, VaultError};

/// Generate a fresh 32-byte VEK via the OS CSPRNG.
#[must_use]
pub fn generate_vek() -> Zeroizing<[u8; 32]> {
    let mut vek = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(vek.as_mut());
    vek
}

/// Wrap `vek` under `mek` via AES-256-GCM with a fresh nonce. Returns
/// the on-disk `WrappedKey` shape.
pub fn wrap_vek(vek: &[u8; 32], mek: &[u8; 32]) -> Result<WrappedKey, VaultError> {
    let (nonce, ciphertext) = aead_seal(mek, vek)?;
    Ok(WrappedKey::from_bytes(&nonce, &ciphertext))
}

/// Unwrap `wrapped` under `mek`. AEAD failures collapse to
/// `VaultError::WrongPassword` for timing-safe parity. On success,
/// returns the VEK wrapped in `Zeroizing<[u8; 32]>` — callers should
/// keep the lifetime as short as possible.
///
/// Used by the operation-execution path (next commits) + the migration
/// helper (Commit 9).
#[allow(dead_code)]
pub fn unwrap_vek(
    wrapped: &WrappedKey,
    mek: &[u8; 32],
) -> Result<Zeroizing<[u8; 32]>, VaultError> {
    let plaintext = aead_unwrap(wrapped, mek)?;
    if plaintext.len() != 32 {
        // Wrong size means the wrap produced a non-32-byte key — either
        // tamper or a different shape than what we ship. Either way:
        // wrong-password parity.
        return Err(VaultError::WrongPassword);
    }
    let mut vek = Zeroizing::new([0u8; 32]);
    vek.copy_from_slice(&plaintext);
    Ok(vek)
}

/// Seal `payload` under `vek` via AES-256-GCM with a fresh nonce.
/// Returns the on-disk `SealedPayload` shape.
pub fn seal_payload(payload: &[u8], vek: &[u8; 32]) -> Result<SealedPayload, VaultError> {
    let (nonce, ciphertext) = aead_seal(vek, payload)?;
    Ok(SealedPayload::from_bytes(&nonce, &ciphertext))
}

/// Open `sealed` under `vek`. AEAD failures collapse to
/// `VaultError::WrongPassword` for parity. Returns the plaintext
/// wrapped in `Zeroizing<Vec<u8>>`.
///
/// Used by the operation-execution path (post-Commit-5 callers wire
/// `unlock-then-open` for signing).
#[allow(dead_code)]
pub fn open_payload(
    sealed: &SealedPayload,
    vek: &[u8; 32],
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    aead_open(sealed, vek)
}

// Re-export for callers that don't want to dig into the GCM constant.
pub use super::container::GCM_NONCE_LEN as VAULT_GCM_NONCE_LEN;
#[allow(dead_code)]
const _: () = {
    // Sanity assertion at compile time — keep the public re-export in
    // sync with the container module's source of truth.
    assert!(VAULT_GCM_NONCE_LEN == GCM_NONCE_LEN);
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vek_generates_non_zero() {
        let vek = generate_vek();
        assert_ne!(vek.as_ref(), &[0u8; 32]);
    }

    #[test]
    fn vek_generates_unique() {
        // Two consecutive generations should differ (overwhelmingly).
        let a = generate_vek();
        let b = generate_vek();
        assert_ne!(a.as_ref(), b.as_ref());
    }

    #[test]
    fn wrap_unwrap_round_trips() {
        let mek = [42u8; 32];
        let vek = generate_vek();
        let wrapped = wrap_vek(&vek, &mek).unwrap();
        let unwrapped = unwrap_vek(&wrapped, &mek).unwrap();
        assert_eq!(unwrapped.as_ref(), vek.as_ref());
    }

    #[test]
    fn wrap_uses_fresh_nonce_per_call() {
        let mek = [9u8; 32];
        let vek = [1u8; 32];
        let a = wrap_vek(&vek, &mek).unwrap();
        let b = wrap_vek(&vek, &mek).unwrap();
        assert_ne!(a.nonce, b.nonce);
        // Same plaintext + key + different nonce → different ciphertext.
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn unwrap_with_wrong_mek_rejected() {
        let mek_good = [42u8; 32];
        let mek_bad = [43u8; 32];
        let vek = [1u8; 32];
        let wrapped = wrap_vek(&vek, &mek_good).unwrap();
        let err = unwrap_vek(&wrapped, &mek_bad).unwrap_err();
        assert_eq!(err, VaultError::WrongPassword);
    }

    #[test]
    fn unwrap_tampered_ciphertext_rejected() {
        let mek = [42u8; 32];
        let vek = [1u8; 32];
        let mut wrapped = wrap_vek(&vek, &mek).unwrap();
        // Flip a char in the ciphertext.
        let mut ct = wrapped.ciphertext.into_bytes();
        let last = ct.len() - 1;
        ct[last] = if ct[last] == b'A' { b'B' } else { b'A' };
        wrapped.ciphertext = String::from_utf8(ct).unwrap();
        let err = unwrap_vek(&wrapped, &mek).unwrap_err();
        assert_eq!(err, VaultError::WrongPassword);
    }

    #[test]
    fn seal_open_round_trips() {
        let vek = [7u8; 32];
        let payload = b"the eagle has landed".to_vec();
        let sealed = seal_payload(&payload, &vek).unwrap();
        let opened = open_payload(&sealed, &vek).unwrap();
        assert_eq!(opened.as_slice(), payload.as_slice());
    }

    #[test]
    fn seal_uses_fresh_nonce_per_call() {
        let vek = [7u8; 32];
        let payload = b"same plaintext";
        let a = seal_payload(payload, &vek).unwrap();
        let b = seal_payload(payload, &vek).unwrap();
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn open_with_wrong_vek_rejected() {
        let vek_a = [7u8; 32];
        let vek_b = [8u8; 32];
        let payload = b"secret".to_vec();
        let sealed = seal_payload(&payload, &vek_a).unwrap();
        let err = open_payload(&sealed, &vek_b).unwrap_err();
        assert_eq!(err, VaultError::WrongPassword);
    }

    #[test]
    fn open_payload_preserves_arbitrary_byte_content() {
        let vek = [3u8; 32];
        let payload = vec![0xFFu8, 0x00, 0xAB, 0xCD, 0x12, 0x34, 0x56];
        let sealed = seal_payload(&payload, &vek).unwrap();
        let opened = open_payload(&sealed, &vek).unwrap();
        assert_eq!(opened.as_slice(), payload.as_slice());
    }
}
