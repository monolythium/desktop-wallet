// Tauri commands for multisig vault + proposal CRUD.
//
// Surface (every command returns Result<T, MultisigCommandError>):
//
//   multisig_create(label, signers, threshold, password)
//                                              → MultisigVaultSummary
//   multisigs_list()                            → Vec<MultisigVaultSummary>
//   proposal_create(multisig_vault_id, operation, payload)
//                                              → ProposalSummary
//   proposal_attach_signature(proposal_id, signer_address, signature_bytes)
//                                              → ProposalSummary
//   proposal_mark_submitted(proposal_id, tx_hash)
//                                              → ProposalSummary
//   proposal_cancel(proposal_id, by_address)   → ()
//   proposals_list(multisig_vault_id)          → Vec<ProposalSummary>
//
// Signing itself happens TS-side (TS already has unsealed seeds for
// the user's local single-vaults via the Phase 5 `vault_unlock` →
// `keychain::fetchAndUnlockVault` path; it derives an
// MlDsa65Backend and signs the proposal's payload_hash). Rust only
// stores the resulting signature bytes — keeps the ML-DSA crate out
// of the Rust dep graph for now.
//
// `proposal_mark_submitted` is also called TS-side after the wallet's
// existing send / submit path broadcasts the bundled tx; this is
// what gives the off-chain audit trail (chain sees a single-signer
// envelope; this module records the M-of-N audit per browser-wallet
// Phase 8 pattern).

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

use super::commands::{VaultStore, VaultStoreInner};
use super::multisig::{
    assert_signer_set_unique, derive_multisig_address, derive_signer_address,
    generate_multisig_vault_id, generate_signer_id, validate_signer, validate_threshold,
    MultisigError, MultisigVaultRecord, MultisigVaultSummary, SignerEntry, SignerKindInner,
};
use super::proposal::{
    attach_signature, build_proposal, cancel_proposal as cancel_proposal_impl, mark_submitted,
    reconcile_expiry, Proposal, ProposalError, ProposalOperation, DEFAULT_TX_TTL_SECS,
};
use super::mek::VaultError;

// ─── Wire-shape input/error types ──────────────────────────────────

/// One signer input from the TS side. The TS layer already validates
/// pubkey hex; this struct mirrors the network shape. Address is
/// computed Rust-side from pubkey via keccak256 so the wallet never
/// trusts a caller-supplied derivation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInput {
    pub label: String,
    pub pubkey: String,
    /// "local" or "external". When "local", `vault_id` must reference
    /// an existing single-vault in the container.
    pub kind: String,
    #[serde(default)]
    pub vault_id: Option<String>,
}

/// Public-facing error envelope. Combines `MultisigError` (data-
/// layer) + `ProposalError` (lifecycle) + storage-layer codes.
#[derive(Debug, Error, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum MultisigCommandError {
    #[error("vault layer: {0}")]
    Multisig(#[from] MultisigError),
    #[error("proposal layer: {0}")]
    Proposal(#[from] ProposalError),
    #[error("vault layer: {0}")]
    Vault(#[from] VaultError),
    #[error("backend error: {message}")]
    Backend { message: String },
}

// ─── Helpers ───────────────────────────────────────────────────────

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for chunk in bytes.chunks(2) {
        let hi = nibble(chunk[0])?;
        let lo = nibble(chunk[1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + b - b'a'),
        b'A'..=b'F' => Some(10 + b - b'A'),
        _ => None,
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn convert_signer_inputs(
    inputs: &[SignerInput],
    container: &super::container::VaultContainerV1,
    now: u64,
) -> Result<Vec<SignerEntry>, MultisigError> {
    let mut signers = Vec::with_capacity(inputs.len());
    for input in inputs {
        let pubkey = input.pubkey.to_ascii_lowercase();
        let address = derive_signer_address(&pubkey).ok_or(MultisigError::InvalidPubkey)?;
        let kind_inner = match input.kind.as_str() {
            "local" => {
                let vault_id = input
                    .vault_id
                    .as_ref()
                    .ok_or(MultisigError::InvalidLocalVaultRef)?;
                // Must reference an actual local vault.
                if !container.vaults.iter().any(|v| &v.id == vault_id) {
                    return Err(MultisigError::InvalidLocalVaultRef);
                }
                SignerKindInner::Local {
                    vault_id: vault_id.clone(),
                }
            }
            "external" => SignerKindInner::External,
            _ => {
                return Err(MultisigError::InvalidLocalVaultRef);
            }
        };
        let entry = SignerEntry {
            id: generate_signer_id(),
            label: input.label.trim().to_string(),
            pubkey: format!("0x{}", pubkey.strip_prefix("0x").unwrap_or(&pubkey)),
            address,
            kind_inner,
            created_at: now,
        };
        validate_signer(&entry)?;
        signers.push(entry);
    }
    assert_signer_set_unique(&signers)?;
    Ok(signers)
}

fn find_multisig<'a>(
    container: &'a super::container::VaultContainerV1,
    multisig_vault_id: &str,
) -> Result<&'a MultisigVaultRecord, MultisigCommandError> {
    container
        .multisig_vaults
        .iter()
        .find(|m| m.id == multisig_vault_id)
        .ok_or_else(|| MultisigCommandError::from(MultisigError::NotFound(multisig_vault_id.into())))
}

fn find_multisig_mut<'a>(
    container: &'a mut super::container::VaultContainerV1,
    multisig_vault_id: &str,
) -> Result<&'a mut MultisigVaultRecord, MultisigCommandError> {
    container
        .multisig_vaults
        .iter_mut()
        .find(|m| m.id == multisig_vault_id)
        .ok_or_else(|| MultisigCommandError::from(MultisigError::NotFound(multisig_vault_id.into())))
}

fn find_proposal_mut<'a>(
    container: &'a mut super::container::VaultContainerV1,
    proposal_id: &str,
) -> Result<&'a mut Proposal, MultisigCommandError> {
    container
        .proposals
        .iter_mut()
        .find(|p| p.id == proposal_id)
        .ok_or_else(|| MultisigCommandError::from(ProposalError::NotFound(proposal_id.into())))
}

// ─── Pure-Rust testable impls ──────────────────────────────────────

/// Create a multisig vault. The caller must already be unlocked.
/// `password` is verified Rust-side before any mutation lands.
pub fn multisig_create_impl(
    inner: &mut VaultStoreInner,
    label: &str,
    signer_inputs: &[SignerInput],
    threshold: u8,
    password: &str,
) -> Result<MultisigVaultSummary, MultisigCommandError> {
    let trimmed = label.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(MultisigCommandError::from(MultisigError::InvalidLabel));
    }
    if password.is_empty() {
        return Err(MultisigCommandError::from(VaultError::InvalidArgument {
            message: "password is empty".into(),
        }));
    }
    validate_threshold(threshold, signer_inputs.len() as u8)
        .map_err(MultisigCommandError::from)?;

    inner.load_or_init()?;
    let container = inner.container.as_ref().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;

    // Verify master password by probing the first single-vault, if
    // one exists; if the container has only multisig vaults so far
    // (unusual but valid) we accept any non-empty password — Phase 7
    // can tighten via a probe value held in the container itself.
    if !container.vaults.is_empty() {
        super::mek::verify_password(container, password.as_bytes())
            .map_err(MultisigCommandError::from)?;
    }

    let now = now_unix();
    let signers = convert_signer_inputs(signer_inputs, container, now)?;
    let address = derive_multisig_address(&signers, threshold);
    let record = MultisigVaultRecord {
        id: generate_multisig_vault_id(),
        label: trimmed.to_string(),
        address,
        created_at: now,
        signers,
        threshold,
        pending_proposal_ids: Vec::new(),
    };
    let new_id = record.id.clone();
    let summary = record.summary(true);

    let container_mut = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    container_mut.multisig_vaults.push(record);
    container_mut.active_id = Some(new_id);
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })?;
    Ok(summary)
}

/// List all multisig vaults.
pub fn multisigs_list_impl(
    inner: &mut VaultStoreInner,
) -> Result<Vec<MultisigVaultSummary>, MultisigCommandError> {
    inner.load_or_init()?;
    let container = match inner.container.as_ref() {
        Some(c) => c,
        None => return Ok(Vec::new()),
    };
    let active = container.active_id.as_deref();
    Ok(container
        .multisig_vaults
        .iter()
        .map(|m| {
            let is_active = active == Some(m.id.as_str());
            m.summary(is_active)
        })
        .collect())
}

/// Parse one governance payload (discriminator + body) and mutate the
/// target multisig vault accordingly. Returns `(audit_msg, label)` for
/// the audit-trail marker. Pure mutation — caller handles persistence.
///
/// Wire format (discriminator byte + body):
///
///   0x01 | new_threshold:u8
///         SetThreshold(new)
///
///   0x02 | kind:u8 | label_len:u8 | label[label_len] | pubkey[1952]
///         [ | vault_id_len:u8 | vault_id[vault_id_len] ]    // if kind==local
///         AddSigner(...)
///
///   0x03 | address[20]
///         RemoveSigner(address)
///
///   0x04 | old_address[20] | new_label_len:u8 | new_label[L] | new_pubkey[1952]
///         RotateSigner(...)
///
/// All length-prefixed strings are UTF-8. Pubkeys are raw bytes (the
/// multisig data model elsewhere stores them as `0x`-prefixed lowercase
/// hex; the payload format uses raw bytes for compactness inside a
/// proposal). The multisig vault's `address` field is NOT recomputed
/// after governance — it stays bound to the original create-time
/// signer set so the on-chain identity remains stable.
pub(super) fn apply_governance_payload(
    multisig: &mut super::multisig::MultisigVaultRecord,
    payload: &[u8],
) -> Result<(String, String), MultisigCommandError> {
    if payload.is_empty() {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "empty governance payload".into(),
        }));
    }
    match payload[0] {
        0x01 => apply_set_threshold(multisig, payload),
        0x02 => apply_add_signer(multisig, payload),
        0x03 => apply_remove_signer(multisig, payload),
        0x04 => apply_rotate_signer(multisig, payload),
        other => Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: format!(
                "unknown governance discriminator 0x{:02x} (supported: 0x01..=0x04)",
                other
            ),
        })),
    }
}

fn apply_set_threshold(
    multisig: &mut super::multisig::MultisigVaultRecord,
    payload: &[u8],
) -> Result<(String, String), MultisigCommandError> {
    if payload.len() != 2 {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "SetThreshold payload must be 2 bytes (disc + u8)".into(),
        }));
    }
    let new_threshold = payload[1];
    super::multisig::validate_threshold(new_threshold, multisig.signers.len() as u8)
        .map_err(MultisigCommandError::from)?;
    multisig.threshold = new_threshold;
    Ok((
        format!("governance: set_threshold {}", new_threshold),
        multisig.label.clone(),
    ))
}

fn apply_add_signer(
    multisig: &mut super::multisig::MultisigVaultRecord,
    payload: &[u8],
) -> Result<(String, String), MultisigCommandError> {
    let body = &payload[1..];
    // [kind:u8][label_len:u8][label][pubkey:1952]
    // [optional vault_id_len:u8][vault_id]
    if body.len() < 1 + 1 {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "AddSigner payload truncated (header)".into(),
        }));
    }
    let kind_byte = body[0];
    let label_len = body[1] as usize;
    if label_len == 0 || label_len > 32 {
        return Err(MultisigCommandError::from(MultisigError::InvalidSignerLabel));
    }
    let mut cursor = 2usize;
    if body.len() < cursor + label_len {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "AddSigner payload truncated (label)".into(),
        }));
    }
    let label_bytes = &body[cursor..cursor + label_len];
    let label = std::str::from_utf8(label_bytes)
        .map_err(|_| MultisigCommandError::from(MultisigError::InvalidSignerLabel))?
        .trim()
        .to_string();
    if label.is_empty() {
        return Err(MultisigCommandError::from(MultisigError::InvalidSignerLabel));
    }
    cursor += label_len;
    if body.len() < cursor + super::multisig::ML_DSA_65_PUBKEY_LEN {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "AddSigner payload truncated (pubkey)".into(),
        }));
    }
    let pubkey_bytes = &body[cursor..cursor + super::multisig::ML_DSA_65_PUBKEY_LEN];
    cursor += super::multisig::ML_DSA_65_PUBKEY_LEN;
    let pubkey_hex = bytes_to_hex(pubkey_bytes);
    let address = super::multisig::derive_signer_address(&pubkey_hex)
        .ok_or(MultisigCommandError::from(MultisigError::InvalidPubkey))?;

    let kind_inner = match kind_byte {
        0 => super::multisig::SignerKindInner::External,
        1 => {
            if body.len() < cursor + 1 {
                return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
                    message: "AddSigner payload truncated (vault_id_len)".into(),
                }));
            }
            let vid_len = body[cursor] as usize;
            cursor += 1;
            if vid_len == 0 || body.len() < cursor + vid_len {
                return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
                    message: "AddSigner payload truncated or empty (vault_id)".into(),
                }));
            }
            let vid = std::str::from_utf8(&body[cursor..cursor + vid_len])
                .map_err(|_| {
                    MultisigCommandError::from(ProposalError::InvalidArgument {
                        message: "vault_id is not UTF-8".into(),
                    })
                })?
                .to_string();
            super::multisig::SignerKindInner::Local { vault_id: vid }
        }
        other => {
            return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
                message: format!("unknown signer kind byte 0x{:02x}", other),
            }));
        }
    };

    if multisig.signers.len() as u8 >= super::multisig::MAX_SIGNERS {
        return Err(MultisigCommandError::from(MultisigError::InvalidSignerCount {
            got: multisig.signers.len() + 1,
        }));
    }
    if multisig
        .signers
        .iter()
        .any(|s| s.pubkey == pubkey_hex || s.address == address)
    {
        return Err(MultisigCommandError::from(MultisigError::DuplicateSigner));
    }

    let new_entry = super::multisig::SignerEntry {
        id: super::multisig::generate_signer_id(),
        label,
        pubkey: pubkey_hex,
        address: address.clone(),
        kind_inner,
        created_at: now_unix(),
    };
    multisig.signers.push(new_entry);
    Ok((
        format!("governance: add_signer {}", address),
        multisig.label.clone(),
    ))
}

fn apply_remove_signer(
    multisig: &mut super::multisig::MultisigVaultRecord,
    payload: &[u8],
) -> Result<(String, String), MultisigCommandError> {
    let body = &payload[1..];
    if body.len() != 20 {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "RemoveSigner payload must be 20 bytes (address)".into(),
        }));
    }
    let address = bytes_to_hex(body);
    // After removal threshold M must still satisfy M <= N-1.
    if multisig.signers.len() <= multisig.threshold as usize {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: format!(
                "removing this signer would make threshold {} unreachable (would have {} signers)",
                multisig.threshold,
                multisig.signers.len().saturating_sub(1),
            ),
        }));
    }
    let idx = multisig
        .signers
        .iter()
        .position(|s| s.address == address)
        .ok_or_else(|| {
            MultisigCommandError::from(ProposalError::InvalidArgument {
                message: format!("signer {} not found in multisig", address),
            })
        })?;
    multisig.signers.remove(idx);
    Ok((
        format!("governance: remove_signer {}", address),
        multisig.label.clone(),
    ))
}

fn apply_rotate_signer(
    multisig: &mut super::multisig::MultisigVaultRecord,
    payload: &[u8],
) -> Result<(String, String), MultisigCommandError> {
    let body = &payload[1..];
    // [old_address:20][new_label_len:u8][new_label][new_pubkey:1952]
    if body.len() < 20 + 1 + super::multisig::ML_DSA_65_PUBKEY_LEN {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "RotateSigner payload truncated".into(),
        }));
    }
    let old_address = bytes_to_hex(&body[0..20]);
    let label_len = body[20] as usize;
    if label_len == 0 || label_len > 32 {
        return Err(MultisigCommandError::from(MultisigError::InvalidSignerLabel));
    }
    if body.len() < 20 + 1 + label_len + super::multisig::ML_DSA_65_PUBKEY_LEN {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "RotateSigner payload truncated (label)".into(),
        }));
    }
    let label = std::str::from_utf8(&body[21..21 + label_len])
        .map_err(|_| MultisigCommandError::from(MultisigError::InvalidSignerLabel))?
        .trim()
        .to_string();
    if label.is_empty() {
        return Err(MultisigCommandError::from(MultisigError::InvalidSignerLabel));
    }
    let pk_start = 21 + label_len;
    let pubkey_bytes = &body[pk_start..pk_start + super::multisig::ML_DSA_65_PUBKEY_LEN];
    let new_pubkey_hex = bytes_to_hex(pubkey_bytes);
    let new_address = super::multisig::derive_signer_address(&new_pubkey_hex)
        .ok_or(MultisigCommandError::from(MultisigError::InvalidPubkey))?;

    let idx = multisig
        .signers
        .iter()
        .position(|s| s.address == old_address)
        .ok_or_else(|| {
            MultisigCommandError::from(ProposalError::InvalidArgument {
                message: format!("signer {} not found in multisig", old_address),
            })
        })?;
    // Reject if the new pubkey/address already exists on a different
    // signer (would create a duplicate).
    if multisig
        .signers
        .iter()
        .enumerate()
        .any(|(i, s)| i != idx && (s.pubkey == new_pubkey_hex || s.address == new_address))
    {
        return Err(MultisigCommandError::from(MultisigError::DuplicateSigner));
    }
    // Preserve id + kind_inner so the rotation is local-data minimal.
    let existing = multisig.signers[idx].clone();
    multisig.signers[idx] = super::multisig::SignerEntry {
        id: existing.id,
        label,
        pubkey: new_pubkey_hex,
        address: new_address.clone(),
        kind_inner: existing.kind_inner,
        created_at: existing.created_at,
    };
    Ok((
        format!("governance: rotate_signer {} -> {}", old_address, new_address),
        multisig.label.clone(),
    ))
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(2 + bytes.len() * 2);
    s.push_str("0x");
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Apply a governance change carried by a fully-signed proposal.
///
/// Wire format documented on `apply_governance_payload`. Supported
/// discriminators: 0x01 SetThreshold, 0x02 AddSigner, 0x03 RemoveSigner,
/// 0x04 RotateSigner.
///
/// Preconditions:
///   - proposal exists, has operation == Governance
///   - state == ReadyToSubmit (threshold reached)
///   - payload decodes cleanly
///
/// On success the multisig vault record is updated AND the proposal is
/// marked Submitted with `tx_hash` set to a marker so the audit trail
/// surfaces the governance event ("governance: set_threshold N", etc.).
pub fn multisig_apply_governance_impl(
    inner: &mut VaultStoreInner,
    proposal_id: &str,
) -> Result<MultisigVaultSummary, MultisigCommandError> {
    if inner.mek.is_none() {
        return Err(MultisigCommandError::from(VaultError::Backend {
            message: "vault is locked".into(),
        }));
    }
    inner.load()?;
    let container = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::from(VaultError::NoContainer)
    })?;
    let proposal = container
        .proposals
        .iter()
        .find(|p| p.id == proposal_id)
        .ok_or_else(|| {
            MultisigCommandError::from(ProposalError::NotFound(proposal_id.into()))
        })?
        .clone();
    if !matches!(proposal.operation, ProposalOperation::Governance) {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "proposal is not a governance proposal".into(),
        }));
    }
    if !matches!(proposal.state, super::proposal::ProposalState::ReadyToSubmit) {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: format!(
                "proposal must be ready_to_submit (currently {:?})",
                proposal.state
            ),
        }));
    }
    let payload_hex = proposal.payload_hex.trim_start_matches("0x");
    let payload = decode_hex(payload_hex).ok_or_else(|| {
        MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "payload hex decode failed".into(),
        })
    })?;
    if payload.is_empty() {
        return Err(MultisigCommandError::from(ProposalError::InvalidArgument {
            message: "empty governance payload".into(),
        }));
    }
    let multisig_idx = container
        .multisig_vaults
        .iter()
        .position(|m| m.id == proposal.multisig_vault_id)
        .ok_or_else(|| {
            MultisigCommandError::from(MultisigError::NotFound(
                proposal.multisig_vault_id.clone(),
            ))
        })?;
    let (audit_msg, target_label) =
        apply_governance_payload(&mut container.multisig_vaults[multisig_idx], &payload)?;
    // Mark the proposal Submitted with an audit-trail marker as tx_hash.
    // Use the proposal's own collected signature count as the threshold
    // check — the state was already verified as ReadyToSubmit against the
    // OLD threshold above, and the new threshold may not match (the
    // SetThreshold case mutates it).
    let multisig_id = proposal.multisig_vault_id.clone();
    let proposal_mut = container
        .proposals
        .iter_mut()
        .find(|p| p.id == proposal_id)
        .expect("found earlier");
    let sig_count = proposal_mut.signatures.len() as u8;
    mark_submitted(proposal_mut, audit_msg, sig_count)
        .map_err(MultisigCommandError::from)?;
    let summary = container
        .multisig_vaults
        .iter()
        .find(|m| m.id == multisig_id)
        .expect("just applied")
        .summary(container.active_id.as_deref() == Some(multisig_id.as_str()));
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })?;
    let _ = target_label;
    Ok(summary)
}

/// Switch the active vault to a multisig. Mirrors `vault_select_impl`:
/// requires the wallet to be unlocked (MEK loaded), so an attacker who
/// hijacks the IPC channel can't flip the active vault out from under
/// a locked wallet.
pub fn multisig_select_impl(
    inner: &mut VaultStoreInner,
    multisig_vault_id: &str,
) -> Result<MultisigVaultSummary, MultisigCommandError> {
    if inner.mek.is_none() {
        return Err(MultisigCommandError::from(VaultError::Backend {
            message: "vault is locked".into(),
        }));
    }
    inner.load()?;
    let container = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::from(VaultError::NoContainer)
    })?;
    if !container
        .multisig_vaults
        .iter()
        .any(|m| m.id == multisig_vault_id)
    {
        return Err(MultisigCommandError::from(MultisigError::NotFound(
            multisig_vault_id.into(),
        )));
    }
    container.active_id = Some(multisig_vault_id.to_string());
    let summary = container
        .multisig_vaults
        .iter()
        .find(|m| m.id == multisig_vault_id)
        .expect("just checked")
        .summary(true);
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })?;
    Ok(summary)
}

/// Create a fresh proposal in Draft state. The caller is the signer
/// identified by `created_by_address`. The proposal is persisted; the
/// caller separately signs the proposal_hash and calls
/// proposal_attach_signature with the resulting bytes.
pub fn proposal_create_impl(
    inner: &mut VaultStoreInner,
    multisig_vault_id: &str,
    operation: ProposalOperation,
    payload: Vec<u8>,
    created_by_address: &str,
    ttl_secs_override: Option<u64>,
) -> Result<Proposal, MultisigCommandError> {
    inner.load_or_init()?;
    let container = inner.container.as_ref().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    // Verify multisig exists + creator is a signer.
    let multisig = find_multisig(container, multisig_vault_id)?;
    let creator_lower = created_by_address.to_ascii_lowercase();
    if !multisig
        .signers
        .iter()
        .any(|s| s.address.to_ascii_lowercase() == creator_lower)
    {
        return Err(MultisigCommandError::from(ProposalError::UnknownSigner(
            creator_lower,
        )));
    }
    let now = now_unix();
    let ttl = ttl_secs_override.unwrap_or(DEFAULT_TX_TTL_SECS);
    let proposal = build_proposal(
        multisig_vault_id.to_string(),
        operation,
        payload,
        creator_lower,
        now,
        now + ttl,
    )
    .map_err(MultisigCommandError::from)?;

    let container_mut = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    let multisig_mut = find_multisig_mut(container_mut, multisig_vault_id)?;
    multisig_mut.pending_proposal_ids.push(proposal.id.clone());
    container_mut.proposals.push(proposal.clone());
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })?;
    Ok(proposal)
}

/// Attach a signature to an existing proposal.
pub fn proposal_attach_signature_impl(
    inner: &mut VaultStoreInner,
    proposal_id: &str,
    signer_address: &str,
    signature_bytes: &[u8],
) -> Result<Proposal, MultisigCommandError> {
    inner.load_or_init()?;
    let now = now_unix();
    let container_mut = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    // First resolve threshold + members from the multisig vault.
    let proposal_vault_id = container_mut
        .proposals
        .iter()
        .find(|p| p.id == proposal_id)
        .map(|p| p.multisig_vault_id.clone())
        .ok_or_else(|| MultisigCommandError::from(ProposalError::NotFound(proposal_id.into())))?;
    let multisig = container_mut
        .multisig_vaults
        .iter()
        .find(|m| m.id == proposal_vault_id)
        .ok_or_else(|| {
            MultisigCommandError::from(ProposalError::VaultNotFound(proposal_vault_id.clone()))
        })?;
    let threshold = multisig.threshold;
    let member_set: std::collections::HashSet<String> = multisig
        .signers
        .iter()
        .map(|s| s.address.to_ascii_lowercase())
        .collect();
    // Now mutate the proposal.
    let proposal = find_proposal_mut(container_mut, proposal_id)?;
    attach_signature(
        proposal,
        signer_address,
        signature_bytes,
        now,
        threshold,
        |addr| member_set.contains(addr),
    )
    .map_err(MultisigCommandError::from)?;
    let updated = proposal.clone();
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })?;
    Ok(updated)
}

/// Mark a proposal as submitted post-broadcast.
pub fn proposal_mark_submitted_impl(
    inner: &mut VaultStoreInner,
    proposal_id: &str,
    tx_hash: String,
) -> Result<Proposal, MultisigCommandError> {
    inner.load_or_init()?;
    let container_mut = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    let proposal_vault_id = container_mut
        .proposals
        .iter()
        .find(|p| p.id == proposal_id)
        .map(|p| p.multisig_vault_id.clone())
        .ok_or_else(|| MultisigCommandError::from(ProposalError::NotFound(proposal_id.into())))?;
    let threshold = container_mut
        .multisig_vaults
        .iter()
        .find(|m| m.id == proposal_vault_id)
        .map(|m| m.threshold)
        .ok_or_else(|| MultisigCommandError::from(ProposalError::VaultNotFound(proposal_vault_id)))?;
    let proposal = find_proposal_mut(container_mut, proposal_id)?;
    mark_submitted(proposal, tx_hash, threshold).map_err(MultisigCommandError::from)?;
    let updated = proposal.clone();
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })?;
    Ok(updated)
}

/// Cancel a proposal — creator-only.
pub fn proposal_cancel_impl(
    inner: &mut VaultStoreInner,
    proposal_id: &str,
    by_address: &str,
) -> Result<(), MultisigCommandError> {
    inner.load_or_init()?;
    let container_mut = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    let proposal = find_proposal_mut(container_mut, proposal_id)?;
    cancel_proposal_impl(proposal, by_address).map_err(MultisigCommandError::from)?;
    inner.save().map_err(|e| MultisigCommandError::Backend {
        message: format!("save failed: {e}"),
    })
}

/// List proposals for one multisig vault. Reconciles expiry on each
/// row so the caller sees a fresh view.
pub fn proposals_list_impl(
    inner: &mut VaultStoreInner,
    multisig_vault_id: &str,
) -> Result<Vec<Proposal>, MultisigCommandError> {
    inner.load_or_init()?;
    let now = now_unix();
    let container_mut = inner.container.as_mut().ok_or_else(|| {
        MultisigCommandError::Backend {
            message: "container not initialized".into(),
        }
    })?;
    let mut changed = false;
    let mut out = Vec::new();
    for p in container_mut.proposals.iter_mut() {
        if p.multisig_vault_id != multisig_vault_id {
            continue;
        }
        let prev = p.state;
        reconcile_expiry(p, now);
        if prev != p.state {
            changed = true;
        }
        out.push(p.clone());
    }
    if changed {
        inner.save().map_err(|e| MultisigCommandError::Backend {
            message: format!("save failed: {e}"),
        })?;
    }
    Ok(out)
}

/// Import a signature payload from off-band exchange — Commit 9
/// validates the wrapper shape before reaching this impl; we just
/// attach the signature to the proposal.
#[allow(dead_code)]
pub fn proposal_import_signature_impl(
    inner: &mut VaultStoreInner,
    proposal_id: &str,
    signer_address: &str,
    signature_bytes: &[u8],
) -> Result<Proposal, MultisigCommandError> {
    proposal_attach_signature_impl(inner, proposal_id, signer_address, signature_bytes)
}

// ─── Tauri command wrappers ────────────────────────────────────────

#[tauri::command]
pub async fn multisig_create(
    label: String,
    signers: Vec<SignerInput>,
    threshold: u8,
    password: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<MultisigVaultSummary, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    multisig_create_impl(&mut inner, &label, &signers, threshold, &password)
}

#[tauri::command]
pub async fn multisigs_list(
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<MultisigVaultSummary>, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    multisigs_list_impl(&mut inner)
}

#[tauri::command]
pub async fn multisig_apply_governance(
    proposal_id: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<MultisigVaultSummary, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    multisig_apply_governance_impl(&mut inner, &proposal_id)
}

#[tauri::command]
pub async fn multisig_select(
    multisig_vault_id: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<MultisigVaultSummary, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    multisig_select_impl(&mut inner, &multisig_vault_id)
}

#[tauri::command]
pub async fn proposal_create(
    multisig_vault_id: String,
    operation: ProposalOperation,
    payload: Vec<u8>,
    created_by_address: String,
    ttl_secs: Option<u64>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Proposal, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    proposal_create_impl(
        &mut inner,
        &multisig_vault_id,
        operation,
        payload,
        &created_by_address,
        ttl_secs,
    )
}

#[tauri::command]
pub async fn proposal_attach_signature(
    proposal_id: String,
    signer_address: String,
    signature: Vec<u8>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Proposal, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    proposal_attach_signature_impl(&mut inner, &proposal_id, &signer_address, &signature)
}

#[tauri::command]
pub async fn proposal_mark_submitted(
    proposal_id: String,
    tx_hash: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<Proposal, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    proposal_mark_submitted_impl(&mut inner, &proposal_id, tx_hash)
}

#[tauri::command]
pub async fn proposal_cancel(
    proposal_id: String,
    by_address: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<(), MultisigCommandError> {
    let mut inner = store.0.lock().await;
    proposal_cancel_impl(&mut inner, &proposal_id, &by_address)
}

#[tauri::command]
pub async fn proposals_list(
    multisig_vault_id: String,
    store: tauri::State<'_, VaultStore>,
) -> Result<Vec<Proposal>, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    proposals_list_impl(&mut inner, &multisig_vault_id)
}

#[tauri::command]
pub async fn proposal_import_signature(
    proposal_id: String,
    signer_address: String,
    signature: Vec<u8>,
    store: tauri::State<'_, VaultStore>,
) -> Result<Proposal, MultisigCommandError> {
    let mut inner = store.0.lock().await;
    proposal_attach_signature_impl(&mut inner, &proposal_id, &signer_address, &signature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::proposal::{ProposalState, ML_DSA_65_SIGNATURE_LEN};
    use rand::{rngs::OsRng, RngCore};
    use std::path::PathBuf;

    fn tmp_path(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let mut nonce = [0u8; 8];
        OsRng.fill_bytes(&mut nonce);
        let suffix: String = nonce.iter().map(|b| format!("{:02x}", b)).collect();
        p.push(format!("mono-multisig-test-{}-{}.json", name, suffix));
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

    fn dummy_pubkey(seed: u8) -> String {
        let mut hex = String::with_capacity(2 + 1952 * 2);
        hex.push_str("0x");
        for i in 0..1952 {
            let b = seed.wrapping_add(i as u8);
            hex.push_str(&format!("{b:02x}"));
        }
        hex
    }

    fn external_signer_input(seed: u8, label: &str) -> SignerInput {
        SignerInput {
            label: label.into(),
            pubkey: dummy_pubkey(seed),
            kind: "external".into(),
            vault_id: None,
        }
    }

    fn dummy_signature() -> Vec<u8> {
        vec![0u8; ML_DSA_65_SIGNATURE_LEN]
    }

    fn setup_with_one_local_vault() -> VaultStoreInner {
        let mut inner = fresh_store("multisig");
        // Create a regular single-vault to host the master password.
        let seed = [9u8; 32];
        super::super::commands::vault_create_impl(
            &mut inner,
            "Personal",
            "hunter2",
            &seed,
            "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
            1_000_000,
        )
        .unwrap();
        inner
    }

    #[test]
    fn create_multisig_rejects_bad_threshold() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let err = multisig_create_impl(&mut inner, "T", &signers, 3, "hunter2").unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Multisig(MultisigError::InvalidThreshold { .. })
        ));
        cleanup(&inner);
    }

    #[test]
    fn create_multisig_rejects_bad_password() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let err = multisig_create_impl(&mut inner, "T", &signers, 2, "wrong").unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Vault(VaultError::WrongPassword)
        ));
        cleanup(&inner);
    }

    #[test]
    fn create_multisig_happy_path_persists_and_returns_summary() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![
            external_signer_input(1, "A"),
            external_signer_input(2, "B"),
            external_signer_input(3, "C"),
        ];
        let sum = multisig_create_impl(&mut inner, "Treasury", &signers, 2, "hunter2").unwrap();
        assert_eq!(sum.signer_count, 3);
        assert_eq!(sum.threshold, 2);
        assert!(sum.is_active);
        assert!(sum.address.starts_with("0x"));
        assert_eq!(sum.address.len(), 42);
        // Container has one multisig vault.
        let list = multisigs_list_impl(&mut inner).unwrap();
        assert_eq!(list.len(), 1);
        cleanup(&inner);
    }

    #[test]
    fn multisig_select_switches_active_id() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let created = multisig_create_impl(&mut inner, "Treasury", &signers, 2, "hunter2").unwrap();
        // create made it active; flip back to single vault via vault_select
        // then back to multisig via multisig_select.
        let single_id = inner
            .container
            .as_ref()
            .unwrap()
            .vaults[0]
            .id
            .clone();
        super::super::commands::vault_select_impl(&mut inner, &single_id).unwrap();
        let sum = multisig_select_impl(&mut inner, &created.id).unwrap();
        assert!(sum.is_active);
        assert_eq!(
            inner.container.as_ref().unwrap().active_id.as_deref(),
            Some(created.id.as_str()),
        );
        cleanup(&inner);
    }

    #[test]
    fn multisig_select_rejects_unknown_id() {
        let mut inner = setup_with_one_local_vault();
        let err = multisig_select_impl(&mut inner, "no-such-id").unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Multisig(MultisigError::NotFound(_))
        ));
        cleanup(&inner);
    }

    #[test]
    fn multisig_select_rejects_when_locked() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let created =
            multisig_create_impl(&mut inner, "Treasury", &signers, 2, "hunter2").unwrap();
        // Drop the MEK to simulate a locked wallet.
        inner.mek = None;
        let err = multisig_select_impl(&mut inner, &created.id).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Vault(VaultError::Backend { .. })
        ));
        cleanup(&inner);
    }

    #[test]
    fn create_multisig_rejects_duplicate_signers() {
        let mut inner = setup_with_one_local_vault();
        let dup = external_signer_input(1, "A");
        let signers = vec![dup.clone(), dup];
        let err = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Multisig(MultisigError::DuplicateSigner)
        ));
        cleanup(&inner);
    }

    #[test]
    fn proposal_create_rejects_unknown_signer() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let err = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"payload".to_vec(),
            "0xstranger00000000000000000000000000000000",
            None,
        )
        .unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Proposal(ProposalError::UnknownSigner(_))
        ));
        cleanup(&inner);
    }

    #[test]
    fn proposal_create_happy_path_links_into_multisig() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let creator_addr = sum.signers[0].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"payload".to_vec(),
            &creator_addr,
            None,
        )
        .unwrap();
        assert_eq!(p.state, ProposalState::Draft);
        assert_eq!(p.multisig_vault_id, sum.id);
        // Multisig has the proposal id in its pending list.
        let list = multisigs_list_impl(&mut inner).unwrap();
        assert_eq!(list[0].pending_proposal_count, 1);
        cleanup(&inner);
    }

    #[test]
    fn proposal_attach_signature_flow() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let addr_b = sum.signers[1].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"payload".to_vec(),
            &addr_a,
            None,
        )
        .unwrap();
        // First signature → Collecting.
        let p_after_a = proposal_attach_signature_impl(&mut inner, &p.id, &addr_a, &dummy_signature())
            .unwrap();
        assert_eq!(p_after_a.state, ProposalState::Collecting);
        // Second signature → ReadyToSubmit.
        let p_after_b = proposal_attach_signature_impl(&mut inner, &p.id, &addr_b, &dummy_signature())
            .unwrap();
        assert_eq!(p_after_b.state, ProposalState::ReadyToSubmit);
        cleanup(&inner);
    }

    #[test]
    fn proposal_attach_signature_rejects_non_member() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"payload".to_vec(),
            &addr_a,
            None,
        )
        .unwrap();
        let err = proposal_attach_signature_impl(
            &mut inner,
            &p.id,
            "0xstranger00000000000000000000000000000000",
            &dummy_signature(),
        )
        .unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Proposal(ProposalError::UnknownSigner(_))
        ));
        cleanup(&inner);
    }

    #[test]
    fn governance_set_threshold_applies_to_multisig() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![
            external_signer_input(1, "A"),
            external_signer_input(2, "B"),
            external_signer_input(3, "C"),
        ];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let addr_b = sum.signers[1].address.clone();
        // Create a governance proposal: SetThreshold(3).
        let payload = vec![0x01u8, 0x03];
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Governance,
            payload,
            &addr_a,
            None,
        )
        .unwrap();
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_a, &dummy_signature()).unwrap();
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_b, &dummy_signature()).unwrap();
        // Apply.
        let after = multisig_apply_governance_impl(&mut inner, &p.id).unwrap();
        assert_eq!(after.threshold, 3);
        // Proposal state is now Submitted with the audit marker.
        let list = inner.container.as_ref().unwrap().proposals.clone();
        let final_p = list.iter().find(|x| x.id == p.id).unwrap();
        assert_eq!(final_p.state, ProposalState::Submitted);
        assert!(final_p
            .tx_hash
            .as_ref()
            .unwrap()
            .contains("set_threshold 3"));
        cleanup(&inner);
    }

    // Helpers for governance payload construction in tests.
    fn dummy_pubkey_bytes(seed: u8) -> Vec<u8> {
        (0..1952).map(|i| seed.wrapping_add(i as u8)).collect()
    }

    fn build_add_signer_external_payload(seed: u8, label: &str) -> Vec<u8> {
        let mut out = vec![0x02u8, 0x00, label.len() as u8];
        out.extend_from_slice(label.as_bytes());
        out.extend(dummy_pubkey_bytes(seed));
        out
    }

    fn build_remove_signer_payload(address_hex: &str) -> Vec<u8> {
        let stripped = address_hex.trim_start_matches("0x");
        let mut out = vec![0x03u8];
        for i in (0..stripped.len()).step_by(2) {
            out.push(u8::from_str_radix(&stripped[i..i + 2], 16).unwrap());
        }
        out
    }

    fn build_rotate_signer_payload(
        old_address_hex: &str,
        new_seed: u8,
        new_label: &str,
    ) -> Vec<u8> {
        let stripped = old_address_hex.trim_start_matches("0x");
        let mut out = vec![0x04u8];
        for i in (0..stripped.len()).step_by(2) {
            out.push(u8::from_str_radix(&stripped[i..i + 2], 16).unwrap());
        }
        out.push(new_label.len() as u8);
        out.extend_from_slice(new_label.as_bytes());
        out.extend(dummy_pubkey_bytes(new_seed));
        out
    }

    fn drive_governance(
        inner: &mut VaultStoreInner,
        sum: &MultisigVaultSummary,
        payload: Vec<u8>,
    ) -> Result<MultisigVaultSummary, MultisigCommandError> {
        let addr_a = sum.signers[0].address.clone();
        let addr_b = sum.signers[1].address.clone();
        let p = proposal_create_impl(
            inner,
            &sum.id,
            ProposalOperation::Governance,
            payload,
            &addr_a,
            None,
        )?;
        proposal_attach_signature_impl(inner, &p.id, &addr_a, &dummy_signature())?;
        proposal_attach_signature_impl(inner, &p.id, &addr_b, &dummy_signature())?;
        multisig_apply_governance_impl(inner, &p.id)
    }

    #[test]
    fn governance_add_signer_external_appends_to_roster() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let payload = build_add_signer_external_payload(3, "Cofounder C");
        let after = drive_governance(&mut inner, &sum, payload).unwrap();
        assert_eq!(after.signer_count, 3);
        assert_eq!(after.signers[2].label, "Cofounder C");
        // Address derived from pubkey by Rust — we don't trust caller-supplied derivation.
        assert_eq!(after.signers[2].address.len(), 42);
        assert!(after.signers[2].address.starts_with("0x"));
        // Threshold is unchanged.
        assert_eq!(after.threshold, 2);
        cleanup(&inner);
    }

    #[test]
    fn governance_add_signer_rejects_duplicate_pubkey() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        // Re-add signer 1's pubkey via governance — must fail with DuplicateSigner.
        let payload = build_add_signer_external_payload(1, "Duplicate");
        let err = drive_governance(&mut inner, &sum, payload).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Multisig(MultisigError::DuplicateSigner)
        ));
        cleanup(&inner);
    }

    #[test]
    fn governance_remove_signer_drops_from_roster() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![
            external_signer_input(1, "A"),
            external_signer_input(2, "B"),
            external_signer_input(3, "C"),
        ];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_c = sum.signers[2].address.clone();
        let payload = build_remove_signer_payload(&addr_c);
        let after = drive_governance(&mut inner, &sum, payload).unwrap();
        assert_eq!(after.signer_count, 2);
        assert!(after.signers.iter().all(|s| s.address != addr_c));
        cleanup(&inner);
    }

    #[test]
    fn governance_remove_signer_respects_threshold_invariant() {
        let mut inner = setup_with_one_local_vault();
        // 2-of-2 multisig — removing any signer would leave threshold unreachable.
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let payload = build_remove_signer_payload(&addr_a);
        let err = drive_governance(&mut inner, &sum, payload).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Proposal(ProposalError::InvalidArgument { .. })
        ));
        cleanup(&inner);
    }

    #[test]
    fn governance_rotate_signer_replaces_pubkey_in_place() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![
            external_signer_input(1, "A"),
            external_signer_input(2, "B"),
            external_signer_input(3, "C"),
        ];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_c = sum.signers[2].address.clone();
        let pre_id = sum.signers[2].id.clone();
        let payload = build_rotate_signer_payload(&addr_c, 4, "C rekeyed");
        let after = drive_governance(&mut inner, &sum, payload).unwrap();
        assert_eq!(after.signer_count, 3);
        // The signer record at index 2 is replaced but keeps its id.
        assert_eq!(after.signers[2].id, pre_id);
        assert_eq!(after.signers[2].label, "C rekeyed");
        assert_ne!(after.signers[2].address, addr_c);
        cleanup(&inner);
    }

    #[test]
    fn governance_rotate_signer_rejects_duplicate_with_other_member() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![
            external_signer_input(1, "A"),
            external_signer_input(2, "B"),
            external_signer_input(3, "C"),
        ];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_c = sum.signers[2].address.clone();
        // Try to rotate C to match A's pubkey — must reject.
        let payload = build_rotate_signer_payload(&addr_c, 1, "Imposter");
        let err = drive_governance(&mut inner, &sum, payload).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Multisig(MultisigError::DuplicateSigner)
        ));
        cleanup(&inner);
    }

    #[test]
    fn governance_add_signer_then_set_threshold_works() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let after_add =
            drive_governance(&mut inner, &sum, build_add_signer_external_payload(3, "C"))
                .unwrap();
        assert_eq!(after_add.signer_count, 3);
        // Bump threshold to 3 — the previous proposal's signature count
        // already cleared so this is a fresh governance round.
        let after_thresh = drive_governance(&mut inner, &after_add, vec![0x01, 0x03]).unwrap();
        assert_eq!(after_thresh.threshold, 3);
        cleanup(&inner);
    }

    #[test]
    fn governance_rejects_unknown_discriminator() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let addr_b = sum.signers[1].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Governance,
            vec![0xff, 0xff],
            &addr_a,
            None,
        )
        .unwrap();
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_a, &dummy_signature()).unwrap();
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_b, &dummy_signature()).unwrap();
        let err = multisig_apply_governance_impl(&mut inner, &p.id).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Proposal(ProposalError::InvalidArgument { .. })
        ));
        cleanup(&inner);
    }

    #[test]
    fn governance_rejects_below_threshold() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Governance,
            vec![0x01, 0x02],
            &addr_a,
            None,
        )
        .unwrap();
        // Only one signature so far → not ReadyToSubmit.
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_a, &dummy_signature()).unwrap();
        let err = multisig_apply_governance_impl(&mut inner, &p.id).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Proposal(ProposalError::InvalidArgument { .. })
        ));
        cleanup(&inner);
    }

    #[test]
    fn proposal_mark_submitted_after_threshold() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let addr_b = sum.signers[1].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"x".to_vec(),
            &addr_a,
            None,
        )
        .unwrap();
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_a, &dummy_signature()).unwrap();
        proposal_attach_signature_impl(&mut inner, &p.id, &addr_b, &dummy_signature()).unwrap();
        let submitted =
            proposal_mark_submitted_impl(&mut inner, &p.id, "0xdeadbeef".into()).unwrap();
        assert_eq!(submitted.state, ProposalState::Submitted);
        assert_eq!(submitted.tx_hash.as_deref(), Some("0xdeadbeef"));
        cleanup(&inner);
    }

    #[test]
    fn proposal_cancel_creator_only() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let addr_b = sum.signers[1].address.clone();
        let p = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"x".to_vec(),
            &addr_a,
            None,
        )
        .unwrap();
        let err = proposal_cancel_impl(&mut inner, &p.id, &addr_b).unwrap_err();
        assert!(matches!(
            err,
            MultisigCommandError::Proposal(ProposalError::NotCreator)
        ));
        proposal_cancel_impl(&mut inner, &p.id, &addr_a).unwrap();
        cleanup(&inner);
    }

    #[test]
    fn proposals_list_filters_by_multisig() {
        let mut inner = setup_with_one_local_vault();
        let signers = vec![external_signer_input(1, "A"), external_signer_input(2, "B")];
        let sum = multisig_create_impl(&mut inner, "T", &signers, 2, "hunter2").unwrap();
        let addr_a = sum.signers[0].address.clone();
        let p1 = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::Send,
            b"a".to_vec(),
            &addr_a,
            None,
        )
        .unwrap();
        let p2 = proposal_create_impl(
            &mut inner,
            &sum.id,
            ProposalOperation::TokenTransfer,
            b"b".to_vec(),
            &addr_a,
            None,
        )
        .unwrap();
        let list = proposals_list_impl(&mut inner, &sum.id).unwrap();
        let ids: Vec<&str> = list.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&p1.id.as_str()));
        assert!(ids.contains(&p2.id.as_str()));
        cleanup(&inner);
    }
}
