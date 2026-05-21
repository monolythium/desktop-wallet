// Multisig vault data model — Phase 6 §28.5 Q70+Q75.
//
// A multisig vault is a sibling shape to the Phase 5 single-signer
// VaultRecord. It carries a roster of signers + a threshold + a
// queue of pending proposals. The container itself stores both
// shapes side-by-side in a discriminated `VaultKind` so the picker
// can render mixed lists.
//
// Wire format addition to vault.v1.json:
//
//   {
//     "version": 1,
//     ...,
//     "multisig_vaults": [
//       {
//         "id": "<uuid>",
//         "label": "Treasury",
//         "address": "0x...",                  // computed from signers+threshold
//         "created_at": 1735689600,
//         "signers": [ { id, label, pubkey, address, kind, created_at }, ... ],
//         "threshold": 2,
//         "pending_proposal_ids": [ "p1", "p2" ]
//       }
//     ]
//   }
//
// The proposals themselves live in a separate `proposals` array on
// the container (Commit 2) — keeps the multisig vault record small
// while supporting proposal lookup across multisig vaults.
//
// Address derivation (multisig vault):
//   keccak256(
//     "monolythium.multisig.v1"  // domain tag
//     || sorted_signer_pubkeys   // canonical, lowercased hex, sorted
//     || threshold-byte
//   )[12..32]
//
// This makes the multisig address deterministic from its config: the
// same N signers + same threshold always produce the same address,
// regardless of which signer creates the vault. Two wallets that
// import the same signer set will agree on the address — important
// for off-band signature coordination.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use thiserror::Error;
use uuid::Uuid;

/// ML-DSA-65 public key length per FIPS-204.
pub const ML_DSA_65_PUBKEY_LEN: usize = 1952;

/// Hard cap on signers per multisig vault. Aligned with the browser-
/// wallet's MAX_SIGNERS — keeps proposal records human-reviewable
/// and the address-derivation hash input bounded.
pub const MAX_SIGNERS: u8 = 15;

/// Domain tag mixed into the multisig address derivation.
pub const ADDRESS_DOMAIN_TAG: &[u8] = b"monolythium.multisig.v1";

/// Signer role discriminant. Re-export of `SignerKindInner` for the
/// public crate surface — `SignerEntry` itself flattens the kind, but
/// callers that want to name the enum standalone (governance ops,
/// import payloads) use this alias.
#[allow(dead_code)]
pub type SignerKind = SignerKindInner;

/// One signer entry inside a MultisigVaultRecord.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignerEntry {
    /// Stable id used by proposals to reference this signer. UUID-v4
    /// at creation. Distinct from `address` because address derivation
    /// from a pubkey is deterministic — the id lets us key off the
    /// signer regardless of any address collisions across re-imports.
    pub id: String,
    /// User-facing label, 1..=32 chars after trim.
    pub label: String,
    /// 0x-prefixed lowercased hex of the 1952-byte ML-DSA-65 public
    /// key. Mandatory — drives both address derivation + signature
    /// verification.
    pub pubkey: String,
    /// 0x-prefixed lowercased hex address derived from the pubkey
    /// via keccak256(pubkey)[12..32]. Cached so the UI can render
    /// without recomputing.
    pub address: String,
    /// Whether the wallet can sign for this entry locally.
    #[serde(flatten)]
    pub kind_inner: SignerKindInner,
    pub created_at: u64,
}

/// Flattened wrapper so the `kind` discriminant + payload land at the
/// top level of the SignerEntry JSON. Distinct type from `SignerKind`
/// so callers can pattern-match on either shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SignerKindInner {
    Local { vault_id: String },
    External,
}

impl SignerKindInner {
    #[allow(dead_code)]
    pub fn is_local(&self) -> bool {
        matches!(self, SignerKindInner::Local { .. })
    }

    #[allow(dead_code)]
    pub fn local_vault_id(&self) -> Option<&str> {
        match self {
            SignerKindInner::Local { vault_id } => Some(vault_id.as_str()),
            SignerKindInner::External => None,
        }
    }
}

/// Multisig vault record. Sibling shape to Phase 5 `VaultRecord`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultisigVaultRecord {
    pub id: String,
    pub label: String,
    /// Deterministic address derived from signers + threshold.
    pub address: String,
    pub created_at: u64,
    pub signers: Vec<SignerEntry>,
    pub threshold: u8,
    /// Proposal ids belonging to this multisig vault. The proposals
    /// themselves live in `VaultContainerV1.proposals` (Commit 2).
    #[serde(default)]
    pub pending_proposal_ids: Vec<String>,
}

/// Public-facing summary for the UI. No on-disk crypto material —
/// pubkeys + addresses are already public.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultisigVaultSummary {
    pub id: String,
    pub label: String,
    pub address: String,
    pub created_at: u64,
    pub threshold: u8,
    pub signer_count: u8,
    pub signers: Vec<SignerEntry>,
    pub is_active: bool,
    pub pending_proposal_count: u32,
}

impl MultisigVaultRecord {
    #[allow(dead_code)]
    pub fn summary(&self, is_active: bool) -> MultisigVaultSummary {
        MultisigVaultSummary {
            id: self.id.clone(),
            label: self.label.clone(),
            address: self.address.clone(),
            created_at: self.created_at,
            threshold: self.threshold,
            signer_count: self.signers.len() as u8,
            signers: self.signers.clone(),
            is_active,
            pending_proposal_count: self.pending_proposal_ids.len() as u32,
        }
    }
}

/// Errors specific to the multisig data layer.
#[derive(Debug, Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum MultisigError {
    #[error("label must be 1-64 characters after trim")]
    InvalidLabel,
    #[error("must have between 1 and {max} signers, got {got}", max = MAX_SIGNERS)]
    InvalidSignerCount { got: usize },
    #[error("threshold {threshold} must be in 1..={signer_count}")]
    InvalidThreshold { threshold: u8, signer_count: u8 },
    #[error("signer pubkey must be 0x + 3904 hex chars (1952 bytes)")]
    InvalidPubkey,
    #[error("signer address must be 0x + 40 hex chars")]
    InvalidSignerAddress,
    #[error("signer label must be 1-32 characters after trim")]
    InvalidSignerLabel,
    #[error("duplicate signer pubkey or address")]
    DuplicateSigner,
    #[error("local signer must reference an existing vault id")]
    InvalidLocalVaultRef,
    #[error("multisig vault {0} not found")]
    NotFound(String),
}

/// Default threshold for an N-signer multisig — simple majority
/// (floor(N/2) + 1). Whitepaper §28.5 default; users can override
/// at creation.
///
/// Public consumers land in Commits 2/3 (multisig_create command) +
/// Commit 5 (UI default chip). Marked allow-dead-code so Commit 1
/// can land cleanly.
#[allow(dead_code)]
#[must_use]
pub fn default_threshold(signer_count: u8) -> u8 {
    (signer_count / 2) + 1
}

/// Validate a (threshold, signer_count) pair.
#[allow(dead_code)]
pub fn validate_threshold(threshold: u8, signer_count: u8) -> Result<(), MultisigError> {
    if signer_count == 0 || signer_count > MAX_SIGNERS {
        return Err(MultisigError::InvalidSignerCount {
            got: signer_count as usize,
        });
    }
    if threshold == 0 || threshold > signer_count {
        return Err(MultisigError::InvalidThreshold {
            threshold,
            signer_count,
        });
    }
    Ok(())
}

/// Validate a signer's externally-supplied fields. Does NOT validate
/// uniqueness — caller runs that against the full roster.
#[allow(dead_code)]
pub fn validate_signer(signer: &SignerEntry) -> Result<(), MultisigError> {
    let trimmed = signer.label.trim();
    if trimmed.is_empty() || trimmed.len() > 32 {
        return Err(MultisigError::InvalidSignerLabel);
    }
    let pubkey_hex = signer.pubkey.strip_prefix("0x").unwrap_or(&signer.pubkey);
    if pubkey_hex.len() != ML_DSA_65_PUBKEY_LEN * 2 {
        return Err(MultisigError::InvalidPubkey);
    }
    if !pubkey_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(MultisigError::InvalidPubkey);
    }
    let addr_hex = signer.address.strip_prefix("0x").unwrap_or(&signer.address);
    if addr_hex.len() != 40 || !addr_hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(MultisigError::InvalidSignerAddress);
    }
    Ok(())
}

/// Assert no two signers share a pubkey or address. One-signer-one-vote.
#[allow(dead_code)]
pub fn assert_signer_set_unique(signers: &[SignerEntry]) -> Result<(), MultisigError> {
    let mut pubkeys = std::collections::HashSet::new();
    let mut addresses = std::collections::HashSet::new();
    for s in signers {
        let pk = s.pubkey.to_ascii_lowercase();
        let addr = s.address.to_ascii_lowercase();
        if !pubkeys.insert(pk) {
            return Err(MultisigError::DuplicateSigner);
        }
        if !addresses.insert(addr) {
            return Err(MultisigError::DuplicateSigner);
        }
    }
    Ok(())
}

/// Derive the multisig vault's deterministic address from its signers
/// + threshold. The same signer set + same threshold produces the
/// same address regardless of which wallet creates the vault.
///
/// Steps:
///   1. Collect lowercased pubkey hex from each signer (without 0x).
///   2. Sort lexicographically. Order-independence.
///   3. keccak256( ADDRESS_DOMAIN_TAG || concat(sorted_pubkeys) ||
///      [threshold] ).
///   4. Take the last 20 bytes; hex-encode with 0x prefix.
#[allow(dead_code)]
#[must_use]
pub fn derive_multisig_address(signers: &[SignerEntry], threshold: u8) -> String {
    let mut pubkeys: Vec<String> = signers
        .iter()
        .map(|s| s.pubkey.strip_prefix("0x").unwrap_or(&s.pubkey).to_ascii_lowercase())
        .collect();
    pubkeys.sort();
    let mut hasher = Keccak256::new();
    hasher.update(ADDRESS_DOMAIN_TAG);
    for pk in &pubkeys {
        let bytes = hex_decode(pk);
        if let Some(bytes) = bytes {
            hasher.update(&bytes);
        }
    }
    hasher.update([threshold]);
    let digest = hasher.finalize();
    let addr_bytes = &digest[12..32];
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for b in addr_bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Derive a signer's address from their pubkey via keccak256(pubkey)[12..32].
/// Used by the create flow + import path to fill in the cached `address`
/// field before storage.
#[allow(dead_code)]
#[must_use]
pub fn derive_signer_address(pubkey_hex: &str) -> Option<String> {
    let stripped = pubkey_hex.strip_prefix("0x").unwrap_or(pubkey_hex);
    let bytes = hex_decode(stripped)?;
    if bytes.len() != ML_DSA_65_PUBKEY_LEN {
        return None;
    }
    let mut hasher = Keccak256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    let addr_bytes = &digest[12..32];
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for b in addr_bytes {
        out.push_str(&format!("{b:02x}"));
    }
    Some(out)
}

/// Generate a fresh signer id.
#[allow(dead_code)]
#[must_use]
pub fn generate_signer_id() -> String {
    Uuid::new_v4().to_string()
}

/// Generate a fresh multisig vault id.
#[allow(dead_code)]
#[must_use]
pub fn generate_multisig_vault_id() -> String {
    Uuid::new_v4().to_string()
}

#[allow(dead_code)]
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for chunk in bytes.chunks(2) {
        let a = hex_nibble(chunk[0])?;
        let b = hex_nibble(chunk[1])?;
        out.push((a << 4) | b);
    }
    Some(out)
}

#[allow(dead_code)]
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_pubkey(seed: u8) -> String {
        let mut hex = String::with_capacity(2 + ML_DSA_65_PUBKEY_LEN * 2);
        hex.push_str("0x");
        for i in 0..ML_DSA_65_PUBKEY_LEN {
            let b = seed.wrapping_add(i as u8);
            hex.push_str(&format!("{b:02x}"));
        }
        hex
    }

    fn signer(seed: u8, label: &str) -> SignerEntry {
        let pubkey = dummy_pubkey(seed);
        let address = derive_signer_address(&pubkey).expect("derive address");
        SignerEntry {
            id: format!("signer-{}", seed),
            label: label.into(),
            pubkey,
            address,
            kind_inner: SignerKindInner::External,
            created_at: 1_000_000,
        }
    }

    #[test]
    fn default_threshold_simple_majority() {
        assert_eq!(default_threshold(1), 1);
        assert_eq!(default_threshold(2), 2);
        assert_eq!(default_threshold(3), 2);
        assert_eq!(default_threshold(4), 3);
        assert_eq!(default_threshold(5), 3);
        assert_eq!(default_threshold(6), 4);
        assert_eq!(default_threshold(7), 4);
    }

    #[test]
    fn validate_threshold_accepts_in_range() {
        assert!(validate_threshold(1, 1).is_ok());
        assert!(validate_threshold(2, 3).is_ok());
        assert!(validate_threshold(15, 15).is_ok());
    }

    #[test]
    fn validate_threshold_rejects_out_of_range() {
        assert!(matches!(
            validate_threshold(0, 3),
            Err(MultisigError::InvalidThreshold { .. })
        ));
        assert!(matches!(
            validate_threshold(4, 3),
            Err(MultisigError::InvalidThreshold { .. })
        ));
        assert!(matches!(
            validate_threshold(1, 0),
            Err(MultisigError::InvalidSignerCount { .. })
        ));
        assert!(matches!(
            validate_threshold(1, 16),
            Err(MultisigError::InvalidSignerCount { .. })
        ));
    }

    #[test]
    fn validate_signer_accepts_well_formed_entry() {
        let s = signer(1, "Alice");
        assert!(validate_signer(&s).is_ok());
    }

    #[test]
    fn validate_signer_rejects_short_pubkey() {
        let mut s = signer(1, "Alice");
        s.pubkey = "0xabcd".into();
        assert_eq!(validate_signer(&s), Err(MultisigError::InvalidPubkey));
    }

    #[test]
    fn validate_signer_rejects_non_hex_pubkey() {
        let mut s = signer(1, "Alice");
        let bad = "z".repeat(ML_DSA_65_PUBKEY_LEN * 2);
        s.pubkey = format!("0x{bad}");
        assert_eq!(validate_signer(&s), Err(MultisigError::InvalidPubkey));
    }

    #[test]
    fn validate_signer_rejects_empty_label() {
        let mut s = signer(1, "   ");
        s.label = "   ".into();
        assert_eq!(validate_signer(&s), Err(MultisigError::InvalidSignerLabel));
    }

    #[test]
    fn validate_signer_rejects_too_long_label() {
        let mut s = signer(1, "x");
        s.label = "x".repeat(33);
        assert_eq!(validate_signer(&s), Err(MultisigError::InvalidSignerLabel));
    }

    #[test]
    fn assert_signer_set_unique_detects_pubkey_collision() {
        let a = signer(1, "A");
        let b = signer(1, "B"); // same seed → same pubkey
        assert_eq!(
            assert_signer_set_unique(&[a, b]),
            Err(MultisigError::DuplicateSigner)
        );
    }

    #[test]
    fn assert_signer_set_unique_accepts_distinct_set() {
        let a = signer(1, "A");
        let b = signer(2, "B");
        let c = signer(3, "C");
        assert!(assert_signer_set_unique(&[a, b, c]).is_ok());
    }

    #[test]
    fn derive_multisig_address_is_deterministic() {
        let a = signer(1, "A");
        let b = signer(2, "B");
        let addr1 = derive_multisig_address(&[a.clone(), b.clone()], 2);
        let addr2 = derive_multisig_address(&[a, b], 2);
        assert_eq!(addr1, addr2);
        assert!(addr1.starts_with("0x"));
        assert_eq!(addr1.len(), 42);
    }

    #[test]
    fn derive_multisig_address_is_order_independent() {
        let a = signer(1, "A");
        let b = signer(2, "B");
        let c = signer(3, "C");
        let addr_abc = derive_multisig_address(&[a.clone(), b.clone(), c.clone()], 2);
        let addr_cab = derive_multisig_address(&[c, a, b], 2);
        assert_eq!(addr_abc, addr_cab);
    }

    #[test]
    fn derive_multisig_address_changes_with_threshold() {
        let a = signer(1, "A");
        let b = signer(2, "B");
        let addr_t1 = derive_multisig_address(&[a.clone(), b.clone()], 1);
        let addr_t2 = derive_multisig_address(&[a, b], 2);
        assert_ne!(addr_t1, addr_t2);
    }

    #[test]
    fn derive_multisig_address_changes_with_signers() {
        let a = signer(1, "A");
        let b = signer(2, "B");
        let c = signer(3, "C");
        let addr_ab = derive_multisig_address(&[a.clone(), b.clone()], 2);
        let addr_ac = derive_multisig_address(&[a, c], 2);
        assert_ne!(addr_ab, addr_ac);
    }

    #[test]
    fn derive_signer_address_from_pubkey_round_trips() {
        let pubkey = dummy_pubkey(42);
        let addr = derive_signer_address(&pubkey).expect("derive");
        assert!(addr.starts_with("0x"));
        assert_eq!(addr.len(), 42);
        // Same pubkey → same address.
        let addr2 = derive_signer_address(&pubkey).expect("derive");
        assert_eq!(addr, addr2);
    }

    #[test]
    fn multisig_record_serializes_round_trip() {
        let a = signer(1, "Alice");
        let b = signer(2, "Bob");
        let address = derive_multisig_address(&[a.clone(), b.clone()], 2);
        let record = MultisigVaultRecord {
            id: "vault-1".into(),
            label: "Treasury".into(),
            address,
            created_at: 1_700_000_000,
            signers: vec![a, b],
            threshold: 2,
            pending_proposal_ids: vec!["p1".into(), "p2".into()],
        };
        let bytes = serde_json::to_vec(&record).unwrap();
        let decoded: MultisigVaultRecord = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.id, record.id);
        assert_eq!(decoded.threshold, 2);
        assert_eq!(decoded.signers.len(), 2);
        assert_eq!(decoded.pending_proposal_ids, record.pending_proposal_ids);
    }

    #[test]
    fn multisig_record_summary_carries_signer_count_and_threshold() {
        let a = signer(1, "A");
        let b = signer(2, "B");
        let c = signer(3, "C");
        let address = derive_multisig_address(&[a.clone(), b.clone(), c.clone()], 2);
        let record = MultisigVaultRecord {
            id: "v".into(),
            label: "T".into(),
            address,
            created_at: 0,
            signers: vec![a, b, c],
            threshold: 2,
            pending_proposal_ids: vec![],
        };
        let sum = record.summary(true);
        assert_eq!(sum.signer_count, 3);
        assert_eq!(sum.threshold, 2);
        assert!(sum.is_active);
        assert_eq!(sum.pending_proposal_count, 0);
    }
}
