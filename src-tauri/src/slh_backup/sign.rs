// SLH-DSA sign + verify wrappers.
//
// Both helpers thread the wallet's domain tag through fips205's
// `ctx` argument so a signature produced by the wallet can't be
// replayed against a different application's verification path.
// fips205 uses the FIPS-205 `hedged` randomized-signature variant
// (parameter `true`) by default — same posture the standard's
// security claims target.

use fips205::traits::{Signer, Verifier};
use serde::{Deserialize, Serialize};

use super::keys::{
    private_key_from_bytes, public_key_from_bytes, SlhBackupError, SlhPublicKey, SlhSecretKey,
    SLH_BACKUP_DOMAIN_TAG, SLH_SIG_LEN,
};

/// 7856-byte SLH-DSA-SHA2-128s signature. Serialized as a Vec<u8>
/// (not a `[u8; SLH_SIG_LEN]`) because Serde derives + 7856-element
/// arrays don't mix cleanly without nightly; the length is asserted
/// at deserialization.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlhSignature(pub Vec<u8>);

impl std::fmt::Debug for SlhSignature {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // 7856 bytes is unreadable in logs — print the prefix only.
        let prefix: String = self
            .0
            .iter()
            .take(8)
            .map(|b| format!("{b:02x}"))
            .collect();
        write!(f, "SlhSignature({} bytes: {}...)", self.0.len(), prefix)
    }
}

impl SlhSignature {
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    pub fn into_bytes(self) -> Vec<u8> {
        self.0
    }
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, SlhBackupError> {
        if bytes.len() != SLH_SIG_LEN {
            return Err(SlhBackupError::Malformed);
        }
        Ok(Self(bytes))
    }
}

/// Sign `message` with the SLH-DSA secret key, threading the wallet's
/// domain tag through `ctx`. Uses the hedged (randomized) variant
/// per fips205's recommendation.
pub fn sign_with_slh(
    secret: &SlhSecretKey,
    message: &[u8],
) -> Result<SlhSignature, SlhBackupError> {
    let sk = private_key_from_bytes(secret.as_bytes())?;
    let sig_bytes: [u8; SLH_SIG_LEN] = sk
        .try_sign(message, SLH_BACKUP_DOMAIN_TAG, true)
        .map_err(|_| SlhBackupError::Sign)?;
    Ok(SlhSignature(sig_bytes.to_vec()))
}

/// Verify a signature against the public key + message. Returns
/// `Err(Verify)` on signature rejection or any malformed input.
pub fn verify_slh(
    public: &SlhPublicKey,
    message: &[u8],
    signature: &SlhSignature,
) -> Result<(), SlhBackupError> {
    let pk = public_key_from_bytes(public.as_bytes())?;
    if signature.0.len() != SLH_SIG_LEN {
        return Err(SlhBackupError::Malformed);
    }
    let mut sig_arr = [0u8; SLH_SIG_LEN];
    sig_arr.copy_from_slice(&signature.0);
    let ok = pk.verify(message, &sig_arr, SLH_BACKUP_DOMAIN_TAG);
    if ok {
        Ok(())
    } else {
        Err(SlhBackupError::Verify)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slh_backup::keys::{
        generate_slh_keypair_from_entropy, SLH_ENTROPY_LEN, SLH_PK_LEN, SLH_SIG_LEN,
    };

    fn fresh_keypair() -> (SlhPublicKey, SlhSecretKey) {
        generate_slh_keypair_from_entropy(&[0x42u8; SLH_ENTROPY_LEN]).unwrap()
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let (pk, sk) = fresh_keypair();
        let msg = b"recovery test message";
        let sig = sign_with_slh(&sk, msg).unwrap();
        assert_eq!(sig.as_bytes().len(), SLH_SIG_LEN);
        verify_slh(&pk, msg, &sig).unwrap();
    }

    #[test]
    fn verify_rejects_wrong_message() {
        let (pk, sk) = fresh_keypair();
        let sig = sign_with_slh(&sk, b"original").unwrap();
        let err = verify_slh(&pk, b"tampered", &sig).unwrap_err();
        assert_eq!(err, SlhBackupError::Verify);
    }

    #[test]
    fn verify_rejects_wrong_pubkey() {
        let (_pk_a, sk_a) = fresh_keypair();
        let (pk_b, _sk_b) =
            generate_slh_keypair_from_entropy(&[0x99u8; SLH_ENTROPY_LEN]).unwrap();
        let sig = sign_with_slh(&sk_a, b"hello").unwrap();
        let err = verify_slh(&pk_b, b"hello", &sig).unwrap_err();
        assert_eq!(err, SlhBackupError::Verify);
    }

    #[test]
    fn verify_rejects_tampered_signature() {
        let (pk, sk) = fresh_keypair();
        let mut sig = sign_with_slh(&sk, b"hello").unwrap();
        // Flip a single bit in the middle.
        let idx = sig.0.len() / 2;
        sig.0[idx] ^= 0x01;
        let err = verify_slh(&pk, b"hello", &sig).unwrap_err();
        assert_eq!(err, SlhBackupError::Verify);
    }

    #[test]
    fn signature_from_bytes_rejects_wrong_length() {
        let err = SlhSignature::from_bytes(vec![0u8; 100]).unwrap_err();
        assert_eq!(err, SlhBackupError::Malformed);
    }

    #[test]
    fn signature_serialization_round_trips_through_json() {
        let (_, sk) = fresh_keypair();
        let sig = sign_with_slh(&sk, b"msg").unwrap();
        let bytes = serde_json::to_vec(&sig).unwrap();
        let decoded: SlhSignature = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.as_bytes(), sig.as_bytes());
    }

    #[test]
    fn pubkey_round_trips_through_json() {
        let (pk, _) = fresh_keypair();
        let bytes = serde_json::to_vec(&pk).unwrap();
        let decoded: SlhPublicKey = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.as_bytes(), pk.as_bytes());
        assert_eq!(decoded.as_bytes().len(), SLH_PK_LEN);
    }
}
