// Passkey enrollment ceremony.
//
// Software-backend enrollment generates a fresh Ed25519 keypair via
// the OS CSPRNG, encodes the pubkey base64url, seals the 32-byte
// secret under the vault's VEK with AES-256-GCM, and returns a
// `PasskeyEntry` ready to be appended to the vault's `passkeys` list.
//
// The secret is zeroized immediately after sealing — only the
// ciphertext + nonce survive in memory past the function boundary.
//
// The cap check (`MAX_PASSKEYS_PER_VAULT`) lives here so the caller
// can fail-fast on the host-side before invoking the OS picker for
// real OS-backed credentials.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use zeroize::Zeroize;

use super::credential::{
    encode_credential_id, generate_credential_id, validate_label, PasskeyBackend, PasskeyEntry,
    PasskeyError, ED25519_SEC_LEN, MAX_PASSKEYS_PER_VAULT,
};
use crate::vault_multi::vek::seal_payload;

/// Inputs for enrollment. `vek` is the unwrapped per-vault encryption
/// key — the caller is responsible for unwrapping it from the cached
/// MEK before calling and dropping it immediately after. `now` is the
/// current UNIX timestamp; passed in so tests can pin time.
pub struct EnrollInputs<'a> {
    pub vek: &'a [u8; 32],
    pub label: String,
    pub device_name: Option<String>,
    pub now: u64,
    pub existing_count: usize,
}

/// Enroll a fresh software-backend passkey. Returns the persistable
/// `PasskeyEntry` — the caller appends it to the vault's `passkeys`
/// list and writes the container back to disk.
pub fn enroll_passkey(inputs: EnrollInputs<'_>) -> Result<PasskeyEntry, PasskeyError> {
    if inputs.existing_count >= MAX_PASSKEYS_PER_VAULT {
        return Err(PasskeyError::LimitReached {
            max: MAX_PASSKEYS_PER_VAULT,
        });
    }

    let label = validate_label(&inputs.label)?;
    let id_bytes = generate_credential_id();

    // Generate the keypair. The signing key holds its own RNG draw;
    // we expose the public verifying key for the on-disk record and
    // seal the secret bytes under the VEK.
    let signing_key = SigningKey::generate(&mut OsRng);
    let public_bytes = signing_key.verifying_key().to_bytes();
    let mut secret_bytes = signing_key.to_bytes();
    debug_assert_eq!(secret_bytes.len(), ED25519_SEC_LEN);

    let sealed = match seal_payload(&secret_bytes, inputs.vek) {
        Ok(p) => p,
        Err(_) => {
            secret_bytes.zeroize();
            return Err(PasskeyError::Crypto);
        }
    };
    secret_bytes.zeroize();

    Ok(PasskeyEntry {
        id: encode_credential_id(&id_bytes),
        backend: PasskeyBackend::Software,
        public_key: URL_SAFE_NO_PAD.encode(public_bytes),
        sealed_secret: Some(sealed),
        counter: 0,
        label,
        device_name: inputs.device_name,
        created_at: inputs.now,
        last_used: inputs.now,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_multi::vek::open_payload;

    fn fixture_vek() -> [u8; 32] {
        [0x42u8; 32]
    }

    #[test]
    fn enroll_produces_well_formed_entry() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "Test passkey".into(),
            device_name: Some("test-host".into()),
            now: 1_700_000_000,
            existing_count: 0,
        })
        .unwrap();

        assert_eq!(entry.backend, PasskeyBackend::Software);
        assert_eq!(entry.counter, 0);
        assert_eq!(entry.label, "Test passkey");
        assert_eq!(entry.device_name.as_deref(), Some("test-host"));
        assert_eq!(entry.created_at, 1_700_000_000);
        assert_eq!(entry.last_used, 1_700_000_000);
        assert!(entry.sealed_secret.is_some());

        // Credential id decodes to 16 bytes.
        let raw = URL_SAFE_NO_PAD.decode(&entry.id).unwrap();
        assert_eq!(raw.len(), 16);

        // Public key decodes to 32 bytes.
        let pub_raw = URL_SAFE_NO_PAD.decode(&entry.public_key).unwrap();
        assert_eq!(pub_raw.len(), 32);
    }

    #[test]
    fn enroll_seals_secret_recoverable_with_vek() {
        let vek = fixture_vek();
        let entry = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "Test".into(),
            device_name: None,
            now: 0,
            existing_count: 0,
        })
        .unwrap();

        let sealed = entry.sealed_secret.unwrap();
        let secret = open_payload(&sealed, &vek).unwrap();
        assert_eq!(secret.len(), ED25519_SEC_LEN);
        // Re-derive the pubkey from the unsealed secret — should match.
        let mut sec_arr = [0u8; ED25519_SEC_LEN];
        sec_arr.copy_from_slice(&secret[..]);
        let signing = SigningKey::from_bytes(&sec_arr);
        let pub_decoded = URL_SAFE_NO_PAD.decode(&entry.public_key).unwrap();
        assert_eq!(signing.verifying_key().to_bytes().as_slice(), pub_decoded.as_slice());
    }

    #[test]
    fn enroll_rejects_at_cap() {
        let vek = fixture_vek();
        let err = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "Test".into(),
            device_name: None,
            now: 0,
            existing_count: MAX_PASSKEYS_PER_VAULT,
        })
        .unwrap_err();
        assert_eq!(err, PasskeyError::LimitReached { max: MAX_PASSKEYS_PER_VAULT });
    }

    #[test]
    fn enroll_rejects_empty_label() {
        let vek = fixture_vek();
        let err = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "   ".into(),
            device_name: None,
            now: 0,
            existing_count: 0,
        })
        .unwrap_err();
        assert_eq!(err, PasskeyError::InvalidLabel);
    }

    #[test]
    fn enroll_two_credentials_produce_distinct_ids_and_keys() {
        let vek = fixture_vek();
        let a = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "A".into(),
            device_name: None,
            now: 0,
            existing_count: 0,
        })
        .unwrap();
        let b = enroll_passkey(EnrollInputs {
            vek: &vek,
            label: "B".into(),
            device_name: None,
            now: 0,
            existing_count: 1,
        })
        .unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.public_key, b.public_key);
    }
}
