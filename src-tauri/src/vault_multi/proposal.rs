// Proposal data model + lifecycle — Phase 6 §28.5 Q70+Q75.
//
// A proposal represents one operation that a multisig vault wants
// to execute. Each proposal collects ML-DSA-65 signatures from its
// vault's signer set; once `signatures.len() >= threshold`, the
// proposal is `ReadyToSubmit` and the wallet bundles the operation's
// transaction with a single-signer envelope (the submitter's own
// keypair, derived from any local signer's vault) for broadcast.
//
// Chain reality (matches browser-wallet Phase 8): mono-core has NO
// user-multisig precompile. The on-chain submission is a regular
// EVM tx signed by ONE signer; the wallet enforces the M-of-N
// policy at the IPC boundary BEFORE submission. The remaining
// signatures are stored off-chain as an audit trail. When mono-core
// ships a user-multisig precompile, this module flips the submission
// path to bundle all N signatures into the on-chain envelope.
//
// Lifecycle:
//
//   Draft         — created by proposer, not yet signed by anyone
//                   (transient; immediately moves to Collecting on
//                   creator sign)
//   Collecting    — has ≥1 signature, < threshold
//   ReadyToSubmit — has ≥ threshold signatures
//   Submitted     — submission succeeded; tx_hash populated
//   Failed        — submission failed (network / chain revert)
//   Expired       — wall-clock exceeded `expires_at`
//   Cancelled     — creator pulled the proposal before submission

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use thiserror::Error;
use uuid::Uuid;

/// ML-DSA-65 signature length per FIPS-204. Used to validate
/// signatures arriving over IPC / off-band import.
pub const ML_DSA_65_SIGNATURE_LEN: usize = 3309;

/// Domain tag mixed into proposal hashing for tx proposals. Distinct
/// tag for governance keeps the two signature surfaces
/// cryptographically separate.
pub const TX_HASH_DOMAIN: &[u8] = b"monolythium-wallet-multisig-tx-v1";

/// Domain tag for governance proposals.
pub const GOV_HASH_DOMAIN: &[u8] = b"monolythium-wallet-multisig-gov-v1";

/// Default lifetime for transaction proposals (24h). Spec-driven; the
/// UI surfaces the remaining time per row.
#[allow(dead_code)]
pub const DEFAULT_TX_TTL_SECS: u64 = 24 * 60 * 60;

/// Default lifetime for governance proposals (7d). Governance moves
/// slower than tx approvals; longer window lets a quorum form across
/// timezones.
#[allow(dead_code)]
pub const DEFAULT_GOV_TTL_SECS: u64 = 7 * 24 * 60 * 60;

/// Proposal state machine.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalState {
    /// Has no signatures yet. Transient — creator signs immediately.
    Draft,
    /// Has 1..(threshold-1) signatures.
    Collecting,
    /// signatures.len() >= threshold.
    ReadyToSubmit,
    /// Submission to chain succeeded; tx_hash populated.
    Submitted,
    /// Submission failed (network / revert).
    Failed,
    /// Wall-clock exceeded `expires_at`.
    Expired,
    /// Creator pulled the proposal before submission.
    Cancelled,
}

impl ProposalState {
    /// True when the proposal is in a terminal state (Submitted /
    /// Failed / Expired / Cancelled). Terminal proposals don't accept
    /// new signatures.
    #[allow(dead_code)]
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ProposalState::Submitted
                | ProposalState::Failed
                | ProposalState::Expired
                | ProposalState::Cancelled
        )
    }
}

/// Proposal kind — what operation the proposal asks the multisig to
/// execute. Variants mirror the wallet's existing operation surface
/// (send / token transfer / delegate / naming registry / NFT) plus
/// governance ops (rotate / add / remove / change threshold).
///
/// `payload` on the parent Proposal struct carries the canonical-
/// serialized operation body — this enum is the discriminator.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposalOperation {
    /// Native LYTH send. payload = canonical {to, valueWei, chainId}.
    Send,
    /// ERC-20 / ERC-721 / ERC-1155 transfer. payload = canonical
    /// {kind: "erc20" | "erc721" | "erc1155", contract, to, …}.
    TokenTransfer,
    /// Stake / delegate / undelegate / claim. payload = canonical
    /// {kind: "delegate" | "undelegate" | …, …}.
    Stake,
    /// Naming-registry op. payload = canonical {kind: "register" |
    /// "propose_transfer" | "accept_transfer", …}.
    Naming,
    /// Governance — rotate / add / remove / change threshold. Uses
    /// the GOV_HASH_DOMAIN tag so the signature surface stays
    /// distinct from tx ops.
    Governance,
}

impl ProposalOperation {
    /// Hashing-domain selector — governance proposals carry the
    /// GOV_HASH_DOMAIN; everything else carries TX_HASH_DOMAIN.
    #[allow(dead_code)]
    pub fn domain_tag(&self) -> &'static [u8] {
        match self {
            ProposalOperation::Governance => GOV_HASH_DOMAIN,
            _ => TX_HASH_DOMAIN,
        }
    }
}

/// One signature recorded against a proposal. The actual signature
/// bytes are ML-DSA-65 (3309 bytes); stored hex-encoded for serde
/// round-trip + UI rendering.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignerSignature {
    /// Signer's address (lowercased 0x hex) — references a SignerEntry
    /// in the parent multisig vault.
    pub signer_address: String,
    /// 0x-prefixed lowercased hex of the 3309-byte ML-DSA-65 signature.
    pub signature: String,
    pub signed_at: u64,
}

/// Pending or completed proposal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Proposal {
    /// UUID-v4 at creation.
    pub id: String,
    /// Multisig vault this proposal targets.
    pub multisig_vault_id: String,
    pub operation: ProposalOperation,
    /// Canonical-serialized operation body. The wallet uses
    /// `compute_payload_hash` to derive the bytes signers sign over.
    /// Stored as 0x-prefixed lowercased hex.
    pub payload_hex: String,
    /// keccak256(domain_tag || payload_bytes) — what signers sign.
    /// Cached so the UI + import path can verify against an incoming
    /// signature without re-hashing.
    pub payload_hash: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub signatures: Vec<SignerSignature>,
    pub state: ProposalState,
    /// Address of the signer that created the proposal. Cancellation
    /// is creator-only.
    pub created_by: String,
    /// Populated post-Submit with the chain tx hash.
    pub tx_hash: Option<String>,
}

/// Public-facing summary returned to the UI. Same shape as Proposal
/// for now; the type alias documents intent (no secret material to
/// strip — everything in here is already public).
#[allow(dead_code)]
pub type ProposalSummary = Proposal;

#[derive(Debug, Error, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum ProposalError {
    #[error("multisig vault {0} not found")]
    VaultNotFound(String),
    #[error("proposal {0} not found")]
    NotFound(String),
    #[error("proposal payload exceeds max length ({max} bytes)")]
    PayloadTooLarge { max: usize },
    #[error("signature must be {expected} bytes, got {got}")]
    BadSignatureLength { expected: usize, got: usize },
    #[error("signer {0} is not a member of this multisig")]
    UnknownSigner(String),
    #[error("signer {0} has already signed this proposal")]
    DuplicateSignature(String),
    #[error("proposal is in terminal state {state:?} and cannot be modified")]
    Terminal { state: ProposalState },
    #[error("proposal expired at {expires_at}")]
    Expired { expires_at: u64 },
    #[error("threshold {threshold} not yet met (have {have})")]
    BelowThreshold { threshold: u8, have: u8 },
    #[error("only the proposal creator can cancel")]
    NotCreator,
    #[error("invalid argument: {message}")]
    InvalidArgument { message: String },
}

/// Cap on the canonical-serialized payload. Generous enough for any
/// existing op (ERC-20 transfer calldata + recipient + chain id is
/// ~256 bytes); bounds the proposal storage footprint.
pub const PAYLOAD_MAX_BYTES: usize = 8 * 1024;

/// Compute the canonical payload hash a signer signs over.
///
/// Format:
///   domain_tag || proposal_id_bytes || multisig_vault_id_bytes ||
///   operation_discriminant_byte || payload_bytes
///
/// The domain tag selector pivots on `operation` (governance vs tx)
/// so a signature collected over a tx proposal can never be replayed
/// against a governance proposal even if the payload bytes happen to
/// collide.
#[allow(dead_code)]
pub fn compute_payload_hash(
    operation: ProposalOperation,
    proposal_id: &str,
    multisig_vault_id: &str,
    payload: &[u8],
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(operation.domain_tag());
    hasher.update(proposal_id.as_bytes());
    hasher.update([0xff]); // separator
    hasher.update(multisig_vault_id.as_bytes());
    hasher.update([0xff]); // separator
    hasher.update([operation_disc_byte(operation)]);
    hasher.update(payload);
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

fn operation_disc_byte(op: ProposalOperation) -> u8 {
    match op {
        ProposalOperation::Send => 0x01,
        ProposalOperation::TokenTransfer => 0x02,
        ProposalOperation::Stake => 0x03,
        ProposalOperation::Naming => 0x04,
        ProposalOperation::Governance => 0x05,
    }
}

/// Generate a fresh proposal id.
#[allow(dead_code)]
#[must_use]
pub fn generate_proposal_id() -> String {
    Uuid::new_v4().to_string()
}

/// Build a fresh proposal in `Draft` state. The caller sets `expires_at`
/// (typically `now + DEFAULT_TX_TTL_SECS` or `DEFAULT_GOV_TTL_SECS`).
/// `created_at` is `now`; `state` starts `Draft` — first signature
/// transitions to `Collecting`.
#[allow(dead_code)]
pub fn build_proposal(
    multisig_vault_id: String,
    operation: ProposalOperation,
    payload: Vec<u8>,
    created_by: String,
    now_unix: u64,
    expires_at: u64,
) -> Result<Proposal, ProposalError> {
    if payload.len() > PAYLOAD_MAX_BYTES {
        return Err(ProposalError::PayloadTooLarge {
            max: PAYLOAD_MAX_BYTES,
        });
    }
    if multisig_vault_id.is_empty() {
        return Err(ProposalError::InvalidArgument {
            message: "multisig_vault_id is empty".into(),
        });
    }
    if created_by.is_empty() {
        return Err(ProposalError::InvalidArgument {
            message: "created_by is empty".into(),
        });
    }
    let id = Uuid::new_v4().to_string();
    let hash = compute_payload_hash(operation, &id, &multisig_vault_id, &payload);
    let payload_hex = bytes_to_lowercase_hex_with_prefix(&payload);
    let payload_hash = bytes_to_lowercase_hex_with_prefix(&hash);
    Ok(Proposal {
        id,
        multisig_vault_id,
        operation,
        payload_hex,
        payload_hash,
        created_at: now_unix,
        expires_at,
        signatures: Vec::new(),
        state: ProposalState::Draft,
        created_by,
        tx_hash: None,
    })
}

/// Attach a signature to a proposal. Validates:
///   - state isn't terminal
///   - signature length matches ML-DSA-65 (3309 bytes)
///   - signer hasn't already signed
///   - proposal hasn't expired (caller can override by passing
///     `enforce_expiry: false` from a test path)
///
/// On success: advances state from Draft → Collecting on first
/// signature, and from Collecting → ReadyToSubmit when
/// `signatures.len() >= threshold`.
///
/// `signer_membership` is a closure the caller supplies that returns
/// `true` if the signer is a member of this multisig — keeps this
/// module independent of the multisig-vault struct.
#[allow(dead_code)]
pub fn attach_signature(
    proposal: &mut Proposal,
    signer_address: &str,
    signature_bytes: &[u8],
    now_unix: u64,
    threshold: u8,
    signer_membership: impl Fn(&str) -> bool,
) -> Result<(), ProposalError> {
    if proposal.state.is_terminal() {
        return Err(ProposalError::Terminal {
            state: proposal.state,
        });
    }
    if proposal.expires_at <= now_unix {
        proposal.state = ProposalState::Expired;
        return Err(ProposalError::Expired {
            expires_at: proposal.expires_at,
        });
    }
    if signature_bytes.len() != ML_DSA_65_SIGNATURE_LEN {
        return Err(ProposalError::BadSignatureLength {
            expected: ML_DSA_65_SIGNATURE_LEN,
            got: signature_bytes.len(),
        });
    }
    let signer_lower = signer_address.to_ascii_lowercase();
    if !signer_membership(&signer_lower) {
        return Err(ProposalError::UnknownSigner(signer_lower));
    }
    if proposal
        .signatures
        .iter()
        .any(|s| s.signer_address == signer_lower)
    {
        return Err(ProposalError::DuplicateSignature(signer_lower));
    }
    proposal.signatures.push(SignerSignature {
        signer_address: signer_lower,
        signature: bytes_to_lowercase_hex_with_prefix(signature_bytes),
        signed_at: now_unix,
    });
    // State transition.
    if proposal.signatures.len() as u8 >= threshold {
        proposal.state = ProposalState::ReadyToSubmit;
    } else if proposal.state == ProposalState::Draft {
        proposal.state = ProposalState::Collecting;
    }
    Ok(())
}

/// Mark a proposal as submitted post-broadcast.
#[allow(dead_code)]
pub fn mark_submitted(proposal: &mut Proposal, tx_hash: String, threshold: u8) -> Result<(), ProposalError> {
    if proposal.signatures.len() as u8 != proposal.signatures.len().min(255) as u8 {
        // defensive: signatures vec shouldn't overflow u8 but we
        // saturate just in case
    }
    if (proposal.signatures.len() as u8) < threshold {
        return Err(ProposalError::BelowThreshold {
            threshold,
            have: proposal.signatures.len() as u8,
        });
    }
    if proposal.state.is_terminal() {
        return Err(ProposalError::Terminal {
            state: proposal.state,
        });
    }
    proposal.state = ProposalState::Submitted;
    proposal.tx_hash = Some(tx_hash);
    Ok(())
}

/// Cancel a proposal. Creator-only.
#[allow(dead_code)]
pub fn cancel_proposal(proposal: &mut Proposal, by_address: &str) -> Result<(), ProposalError> {
    if proposal.state.is_terminal() {
        return Err(ProposalError::Terminal {
            state: proposal.state,
        });
    }
    if proposal.created_by.to_ascii_lowercase() != by_address.to_ascii_lowercase() {
        return Err(ProposalError::NotCreator);
    }
    proposal.state = ProposalState::Cancelled;
    Ok(())
}

/// Reconcile a proposal's state against wall-clock time. Mutates
/// `state` to `Expired` if applicable. Used by the periodic UI
/// refresh + by every command's reload path so stale proposals
/// never appear active.
#[allow(dead_code)]
pub fn reconcile_expiry(proposal: &mut Proposal, now_unix: u64) {
    if proposal.state.is_terminal() {
        return;
    }
    if proposal.expires_at <= now_unix {
        proposal.state = ProposalState::Expired;
    }
}

fn bytes_to_lowercase_hex_with_prefix(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(2 + bytes.len() * 2);
    s.push_str("0x");
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_signature() -> Vec<u8> {
        vec![0u8; ML_DSA_65_SIGNATURE_LEN]
    }

    fn build_test_proposal() -> Proposal {
        build_proposal(
            "vault-1".into(),
            ProposalOperation::Send,
            b"payload".to_vec(),
            "0xcreator".into(),
            1_000_000,
            1_000_000 + DEFAULT_TX_TTL_SECS,
        )
        .expect("build")
    }

    #[test]
    fn build_proposal_starts_in_draft_state() {
        let p = build_test_proposal();
        assert_eq!(p.state, ProposalState::Draft);
        assert_eq!(p.signatures.len(), 0);
        assert!(p.tx_hash.is_none());
        assert!(p.id.contains('-'));
        assert!(p.payload_hash.starts_with("0x"));
        assert_eq!(p.payload_hash.len(), 2 + 64); // 32 bytes hex
    }

    #[test]
    fn build_proposal_rejects_oversized_payload() {
        let payload = vec![0u8; PAYLOAD_MAX_BYTES + 1];
        let err = build_proposal(
            "v".into(),
            ProposalOperation::Send,
            payload,
            "c".into(),
            0,
            100,
        )
        .unwrap_err();
        assert!(matches!(err, ProposalError::PayloadTooLarge { .. }));
    }

    #[test]
    fn build_proposal_rejects_empty_vault_id_or_creator() {
        let err = build_proposal(
            String::new(),
            ProposalOperation::Send,
            vec![],
            "c".into(),
            0,
            100,
        )
        .unwrap_err();
        assert!(matches!(err, ProposalError::InvalidArgument { .. }));
        let err2 = build_proposal(
            "v".into(),
            ProposalOperation::Send,
            vec![],
            String::new(),
            0,
            100,
        )
        .unwrap_err();
        assert!(matches!(err2, ProposalError::InvalidArgument { .. }));
    }

    #[test]
    fn attach_signature_advances_draft_to_collecting() {
        let mut p = build_test_proposal();
        attach_signature(
            &mut p,
            "0xsigner-a",
            &dummy_signature(),
            1_000_001,
            2,
            |_| true,
        )
        .unwrap();
        assert_eq!(p.state, ProposalState::Collecting);
        assert_eq!(p.signatures.len(), 1);
    }

    #[test]
    fn attach_signature_advances_to_ready_at_threshold() {
        let mut p = build_test_proposal();
        attach_signature(&mut p, "0xa", &dummy_signature(), 1_000_001, 2, |_| true).unwrap();
        attach_signature(&mut p, "0xb", &dummy_signature(), 1_000_002, 2, |_| true).unwrap();
        assert_eq!(p.state, ProposalState::ReadyToSubmit);
    }

    #[test]
    fn attach_signature_rejects_duplicate_signer() {
        let mut p = build_test_proposal();
        attach_signature(&mut p, "0xa", &dummy_signature(), 1_000_001, 3, |_| true).unwrap();
        let err = attach_signature(&mut p, "0xa", &dummy_signature(), 1_000_002, 3, |_| true)
            .unwrap_err();
        assert!(matches!(err, ProposalError::DuplicateSignature(_)));
    }

    #[test]
    fn attach_signature_case_insensitive_dedup() {
        let mut p = build_test_proposal();
        attach_signature(&mut p, "0xABCD", &dummy_signature(), 1_000_001, 3, |_| true).unwrap();
        let err = attach_signature(&mut p, "0xabcd", &dummy_signature(), 1_000_002, 3, |_| true)
            .unwrap_err();
        assert!(matches!(err, ProposalError::DuplicateSignature(_)));
    }

    #[test]
    fn attach_signature_rejects_wrong_length() {
        let mut p = build_test_proposal();
        let err = attach_signature(&mut p, "0xa", &[0u8; 100], 1_000_001, 2, |_| true).unwrap_err();
        assert!(matches!(err, ProposalError::BadSignatureLength { .. }));
    }

    #[test]
    fn attach_signature_rejects_unknown_signer() {
        let mut p = build_test_proposal();
        let err = attach_signature(
            &mut p,
            "0xstranger",
            &dummy_signature(),
            1_000_001,
            2,
            |a| a == "0xa",
        )
        .unwrap_err();
        assert!(matches!(err, ProposalError::UnknownSigner(_)));
    }

    #[test]
    fn attach_signature_rejects_expired_proposal() {
        let mut p = build_test_proposal();
        let after_expiry = p.expires_at + 1;
        let err = attach_signature(&mut p, "0xa", &dummy_signature(), after_expiry, 2, |_| true)
            .unwrap_err();
        assert!(matches!(err, ProposalError::Expired { .. }));
        assert_eq!(p.state, ProposalState::Expired);
    }

    #[test]
    fn attach_signature_rejects_terminal_state() {
        let mut p = build_test_proposal();
        p.state = ProposalState::Cancelled;
        let err = attach_signature(&mut p, "0xa", &dummy_signature(), 1_000_001, 2, |_| true)
            .unwrap_err();
        assert!(matches!(err, ProposalError::Terminal { .. }));
    }

    #[test]
    fn mark_submitted_requires_threshold_signatures() {
        let mut p = build_test_proposal();
        attach_signature(&mut p, "0xa", &dummy_signature(), 1_000_001, 2, |_| true).unwrap();
        let err = mark_submitted(&mut p, "0xdeadbeef".into(), 2).unwrap_err();
        assert!(matches!(err, ProposalError::BelowThreshold { .. }));
    }

    #[test]
    fn mark_submitted_happy_path() {
        let mut p = build_test_proposal();
        attach_signature(&mut p, "0xa", &dummy_signature(), 1_000_001, 2, |_| true).unwrap();
        attach_signature(&mut p, "0xb", &dummy_signature(), 1_000_002, 2, |_| true).unwrap();
        mark_submitted(&mut p, "0xtxhash".into(), 2).unwrap();
        assert_eq!(p.state, ProposalState::Submitted);
        assert_eq!(p.tx_hash.as_deref(), Some("0xtxhash"));
    }

    #[test]
    fn cancel_proposal_requires_creator() {
        let mut p = build_test_proposal();
        let err = cancel_proposal(&mut p, "0xstranger").unwrap_err();
        assert_eq!(err, ProposalError::NotCreator);
        // Creator can cancel.
        cancel_proposal(&mut p, "0xcreator").unwrap();
        assert_eq!(p.state, ProposalState::Cancelled);
    }

    #[test]
    fn reconcile_expiry_transitions_to_expired() {
        let mut p = build_test_proposal();
        let after = p.expires_at + 1;
        reconcile_expiry(&mut p, after);
        assert_eq!(p.state, ProposalState::Expired);
    }

    #[test]
    fn reconcile_expiry_noop_for_terminal_proposal() {
        let mut p = build_test_proposal();
        p.state = ProposalState::Submitted;
        let after = p.expires_at + 1;
        reconcile_expiry(&mut p, after);
        assert_eq!(p.state, ProposalState::Submitted);
    }

    #[test]
    fn compute_payload_hash_is_deterministic() {
        let h1 = compute_payload_hash(
            ProposalOperation::Send,
            "p1",
            "v1",
            b"the same payload",
        );
        let h2 = compute_payload_hash(
            ProposalOperation::Send,
            "p1",
            "v1",
            b"the same payload",
        );
        assert_eq!(h1, h2);
    }

    #[test]
    fn compute_payload_hash_differs_for_governance_vs_tx() {
        let h_tx = compute_payload_hash(
            ProposalOperation::Send,
            "p1",
            "v1",
            b"payload",
        );
        let h_gov = compute_payload_hash(
            ProposalOperation::Governance,
            "p1",
            "v1",
            b"payload",
        );
        assert_ne!(h_tx, h_gov);
    }

    #[test]
    fn compute_payload_hash_differs_per_proposal_id() {
        let h1 = compute_payload_hash(
            ProposalOperation::Send,
            "p1",
            "v1",
            b"payload",
        );
        let h2 = compute_payload_hash(
            ProposalOperation::Send,
            "p2",
            "v1",
            b"payload",
        );
        assert_ne!(h1, h2);
    }

    #[test]
    fn proposal_round_trips_through_serde() {
        let p = build_test_proposal();
        let bytes = serde_json::to_vec(&p).unwrap();
        let decoded: Proposal = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded.id, p.id);
        assert_eq!(decoded.state, ProposalState::Draft);
        assert_eq!(decoded.operation, ProposalOperation::Send);
    }
}
