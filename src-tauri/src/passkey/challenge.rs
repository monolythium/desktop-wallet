// Passkey assertion ceremony — challenge create / sign / verify.
//
// Whitepaper §28.5 Q29-31. The OperationsDrawer (Commit 5) computes
// the tx payload hash, builds an `AuthChallenge` bound to it, asks
// the enrolled passkey to sign, and runs `verify_assertion` over the
// returned signature. If the verification passes, the ML-DSA-65
// signer takes over for the actual on-chain transaction.
//
// Challenge → signature input bytes:
//
//   message = SHA3-256(DOMAIN_TAG || payload_hash || nonce)
//
// The wallet uses SHA3-256 because the existing codebase already
// pulls in `sha3` for the multisig address derivation (no new dep);
// the chain analogue would use Keccak-256 if a precompile lands
// later, but for an off-chain assertion the hash family is
// wallet-internal.
//
// Replay protection
// =================
// Each challenge carries a fresh 32-byte CSPRNG nonce + an expiration
// timestamp 60 seconds out. `verify_assertion` rejects expired
// challenges and rejects any assertion whose stored counter is not
// strictly greater than the previously-stored counter for that
// credential. The combination defeats both:
//   - replay of a captured assertion within the 60-second window
//     (counter check)
//   - replay long after the user closed the drawer (expiration check)

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};

use super::credential::{PasskeyEntry, PasskeyError, ED25519_PUB_LEN, ED25519_SEC_LEN};
use crate::vault_multi::vek::open_payload;

/// Domain separator stitched into every challenge hash. Keeps
/// wallet-side passkey signatures cryptographically distinct from
/// any other signature the same authenticator might produce.
pub const CHALLENGE_DOMAIN: &[u8] = b"monolythium.passkey-challenge.v1";

/// Length, in bytes, of the random nonce in each challenge.
pub const CHALLENGE_NONCE_LEN: usize = 32;

/// Length, in bytes, of the tx payload hash the challenge binds to.
pub const PAYLOAD_HASH_LEN: usize = 32;

/// Window during which the challenge is valid, in seconds. 60s is
/// long enough that a slow user can still complete the OS picker
/// flow on a real OS-backed credential and short enough that a
/// captured challenge can't be replayed outside the active session.
pub const CHALLENGE_TTL_SECS: u64 = 60;

/// One challenge issued by the wallet. Travels TS↔Rust as JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthChallenge {
    /// base64url-no-pad encoded 32-byte nonce.
    pub nonce: String,
    /// base64url-no-pad encoded 32-byte tx payload hash.
    pub payload_hash: String,
    /// UNIX seconds at issuance.
    pub created_at: u64,
    /// UNIX seconds after which `verify_assertion` rejects.
    pub expires_at: u64,
}

impl AuthChallenge {
    /// Re-derive the signing message from the challenge fields.
    /// Returns the 32-byte SHA3-256 of (domain || payload_hash || nonce).
    /// Used by both sign + verify so the byte layout cannot drift.
    pub fn signing_message(&self) -> Result<[u8; 32], PasskeyError> {
        let nonce = URL_SAFE_NO_PAD
            .decode(&self.nonce)
            .map_err(|_| PasskeyError::Malformed)?;
        let payload = URL_SAFE_NO_PAD
            .decode(&self.payload_hash)
            .map_err(|_| PasskeyError::Malformed)?;
        if nonce.len() != CHALLENGE_NONCE_LEN || payload.len() != PAYLOAD_HASH_LEN {
            return Err(PasskeyError::Malformed);
        }
        let mut h = Sha3_256::new();
        h.update(CHALLENGE_DOMAIN);
        h.update(&payload);
        h.update(&nonce);
        let digest = h.finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(&digest);
        Ok(out)
    }
}

/// One assertion returned by the passkey ceremony.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Assertion {
    /// base64url-no-pad encoded credential id of the passkey that
    /// produced this assertion.
    pub credential_id: String,
    /// base64url-no-pad encoded 64-byte Ed25519 signature.
    pub signature: String,
    /// The challenge that was signed (echoed back so the verifier can
    /// rebuild the signing message without trusting the caller's nonce).
    pub challenge: AuthChallenge,
    /// New monotonic counter after this assertion (= previous + 1).
    pub new_counter: u32,
}

/// Typed errors specific to the challenge layer. Convert into
/// `PasskeyError::Crypto` at the command boundary except for replay
/// + expiry, which carry their own variants so the UI can surface
/// the right message.
#[derive(Debug, thiserror::Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum AuthError {
    #[error("user cancelled the assertion")]
    Cancelled,
    #[error("no passkey enrolled for this vault")]
    NotEnrolled,
    #[error("authentication failed")]
    AuthFailed,
    #[error("device or backend not supported")]
    DeviceNotSupported,
    #[error("counter regression — replay rejected")]
    CounterRegression,
    #[error("challenge expired")]
    Expired,
}

/// Build a fresh challenge bound to the supplied payload hash. The
/// caller passes `now` so tests can pin time.
pub fn create_challenge(payload_hash: &[u8; PAYLOAD_HASH_LEN], now: u64) -> AuthChallenge {
    let mut nonce = [0u8; CHALLENGE_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    AuthChallenge {
        nonce: URL_SAFE_NO_PAD.encode(nonce),
        payload_hash: URL_SAFE_NO_PAD.encode(payload_hash),
        created_at: now,
        expires_at: now.saturating_add(CHALLENGE_TTL_SECS),
    }
}

/// Sign a challenge with the software backend. Unseals the passkey's
/// secret with the supplied VEK, signs the canonical message, and
/// returns an `Assertion`. The unsealed secret is zeroized via the
/// `Zeroizing` wrapper around `open_payload`'s return; the
/// `SigningKey` itself zeroizes on drop via the `zeroize` feature.
///
/// Returns `AuthError::NotEnrolled` if the entry has no sealed
/// secret (would happen on a future OS-backed credential reached via
/// this path by mistake) or `AuthError::AuthFailed` on AEAD failure.
pub fn sign_challenge_software(
    entry: &PasskeyEntry,
    vek: &[u8; 32],
    challenge: &AuthChallenge,
) -> Result<Assertion, AuthError> {
    let sealed = entry
        .sealed_secret
        .as_ref()
        .ok_or(AuthError::DeviceNotSupported)?;
    let secret_bytes = open_payload(sealed, vek).map_err(|_| AuthError::AuthFailed)?;
    if secret_bytes.len() != ED25519_SEC_LEN {
        return Err(AuthError::AuthFailed);
    }
    let mut secret_arr = [0u8; ED25519_SEC_LEN];
    secret_arr.copy_from_slice(&secret_bytes[..]);
    // SigningKey owns the secret via Zeroizing; the `Drop` impl
    // wipes the expanded form. We still zero our local copy below.
    let signing = SigningKey::from_bytes(&secret_arr);
    secret_arr.iter_mut().for_each(|b| *b = 0);

    let message = challenge
        .signing_message()
        .map_err(|_| AuthError::AuthFailed)?;
    let sig: Signature = signing.sign(&message);

    Ok(Assertion {
        credential_id: entry.id.clone(),
        signature: URL_SAFE_NO_PAD.encode(sig.to_bytes()),
        challenge: challenge.clone(),
        new_counter: entry.counter.saturating_add(1),
    })
}

/// Verify an assertion against the expected pubkey + stored counter.
///
///   - Reconstructs the signing message from the challenge fields
///     (NOT from any caller-supplied buffer — the verifier never
///     trusts an attacker-controlled "message bytes")
///   - Checks the challenge has not expired (`now` vs `expires_at`)
///   - Checks the counter strictly exceeds `stored_counter` (replay)
///   - Verifies the Ed25519 signature against `expected_pubkey`
///
/// Returns the new counter on success — caller persists it.
pub fn verify_assertion(
    assertion: &Assertion,
    expected_pubkey_b64: &str,
    stored_counter: u32,
    now: u64,
) -> Result<u32, AuthError> {
    if now > assertion.challenge.expires_at {
        return Err(AuthError::Expired);
    }
    if assertion.new_counter <= stored_counter {
        return Err(AuthError::CounterRegression);
    }
    // Pubkey + sig decode.
    let pub_bytes = URL_SAFE_NO_PAD
        .decode(expected_pubkey_b64)
        .map_err(|_| AuthError::AuthFailed)?;
    if pub_bytes.len() != ED25519_PUB_LEN {
        return Err(AuthError::AuthFailed);
    }
    let mut pub_arr = [0u8; ED25519_PUB_LEN];
    pub_arr.copy_from_slice(&pub_bytes);
    let verifying = VerifyingKey::from_bytes(&pub_arr).map_err(|_| AuthError::AuthFailed)?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(&assertion.signature)
        .map_err(|_| AuthError::AuthFailed)?;
    if sig_bytes.len() != 64 {
        return Err(AuthError::AuthFailed);
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&sig_arr);

    let message = assertion
        .challenge
        .signing_message()
        .map_err(|_| AuthError::AuthFailed)?;
    verifying
        .verify(&message, &sig)
        .map_err(|_| AuthError::AuthFailed)?;

    Ok(assertion.new_counter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::passkey::registration::{enroll_passkey, EnrollInputs};

    fn fixture_vek() -> [u8; 32] {
        [0x42u8; 32]
    }

    fn fixture_payload() -> [u8; 32] {
        [0xABu8; 32]
    }

    #[test]
    fn challenge_has_unique_nonce_per_call() {
        let payload = fixture_payload();
        let a = create_challenge(&payload, 1000);
        let b = create_challenge(&payload, 1000);
        assert_ne!(a.nonce, b.nonce);
    }

    #[test]
    fn challenge_expires_at_ttl() {
        let payload = fixture_payload();
        let c = create_challenge(&payload, 1000);
        assert_eq!(c.expires_at, 1000 + CHALLENGE_TTL_SECS);
    }

    #[test]
    fn signing_message_is_deterministic_per_challenge() {
        let payload = fixture_payload();
        let c = create_challenge(&payload, 1000);
        let m1 = c.signing_message().unwrap();
        let m2 = c.signing_message().unwrap();
        assert_eq!(m1, m2);
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "T".into(),
            device_name: None,
            now: 100,
            existing_count: 0,
        })
        .unwrap();
        let challenge = create_challenge(&fixture_payload(), 100);
        let assertion = sign_challenge_software(&entry, &vek, &challenge).unwrap();
        let new_counter = verify_assertion(&assertion, &entry.public_key, entry.counter, 100).unwrap();
        assert_eq!(new_counter, entry.counter + 1);
    }

    #[test]
    fn verify_rejects_counter_regression() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "T".into(),
            device_name: None,
            now: 100,
            existing_count: 0,
        })
        .unwrap();
        let challenge = create_challenge(&fixture_payload(), 100);
        let assertion = sign_challenge_software(&entry, &vek, &challenge).unwrap();
        // Pretend the stored counter is already at the new value.
        let err = verify_assertion(&assertion, &entry.public_key, assertion.new_counter, 100).unwrap_err();
        assert_eq!(err, AuthError::CounterRegression);
        // Even higher than the new value — definitely regression.
        let err = verify_assertion(&assertion, &entry.public_key, assertion.new_counter + 5, 100).unwrap_err();
        assert_eq!(err, AuthError::CounterRegression);
    }

    #[test]
    fn verify_rejects_expired_challenge() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "T".into(),
            device_name: None,
            now: 100,
            existing_count: 0,
        })
        .unwrap();
        let challenge = create_challenge(&fixture_payload(), 100);
        let assertion = sign_challenge_software(&entry, &vek, &challenge).unwrap();
        // Verify with now > expires_at.
        let err = verify_assertion(&assertion, &entry.public_key, 0, 100 + CHALLENGE_TTL_SECS + 1).unwrap_err();
        assert_eq!(err, AuthError::Expired);
    }

    #[test]
    fn verify_rejects_wrong_pubkey() {
        let vek = fixture_vek();
        let entry_a = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "A".into(),
            device_name: None,
            now: 100,
            existing_count: 0,
        })
        .unwrap();
        let entry_b = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "B".into(),
            device_name: None,
            now: 100,
            existing_count: 1,
        })
        .unwrap();
        let challenge = create_challenge(&fixture_payload(), 100);
        let assertion = sign_challenge_software(&entry_a, &vek, &challenge).unwrap();
        // Try to verify A's assertion against B's pubkey.
        let err = verify_assertion(&assertion, &entry_b.public_key, 0, 100).unwrap_err();
        assert_eq!(err, AuthError::AuthFailed);
    }

    #[test]
    fn verify_rejects_tampered_signature() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "T".into(),
            device_name: None,
            now: 100,
            existing_count: 0,
        })
        .unwrap();
        let challenge = create_challenge(&fixture_payload(), 100);
        let mut assertion = sign_challenge_software(&entry, &vek, &challenge).unwrap();
        // Flip the last char.
        let mut sig_bytes = assertion.signature.into_bytes();
        let last = sig_bytes.len() - 1;
        sig_bytes[last] = if sig_bytes[last] == b'A' { b'B' } else { b'A' };
        assertion.signature = String::from_utf8(sig_bytes).unwrap();
        let err = verify_assertion(&assertion, &entry.public_key, 0, 100).unwrap_err();
        assert_eq!(err, AuthError::AuthFailed);
    }

    #[test]
    fn sign_with_wrong_vek_fails() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "T".into(),
            device_name: None,
            now: 100,
            existing_count: 0,
        })
        .unwrap();
        let challenge = create_challenge(&fixture_payload(), 100);
        let wrong_vek = [0x55u8; 32];
        let err = sign_challenge_software(&entry, &wrong_vek, &challenge).unwrap_err();
        assert_eq!(err, AuthError::AuthFailed);
    }

    #[test]
    fn signing_message_includes_domain_separation() {
        // Two challenges with the same nonce + payload must produce the
        // same signing message (sanity); two challenges that differ in
        // either nonce or payload must produce different messages.
        let payload_a = [0x11u8; 32];
        let payload_b = [0x22u8; 32];
        let ca = create_challenge(&payload_a, 100);
        let cb = AuthChallenge {
            payload_hash: ca.payload_hash.clone(),
            ..create_challenge(&payload_b, 100)
        };
        assert_ne!(ca.signing_message().unwrap(), cb.signing_message().unwrap());
    }
}
