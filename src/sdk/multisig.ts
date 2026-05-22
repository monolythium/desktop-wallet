// TypeScript bindings for the Phase 6 multisig + proposal Tauri
// commands. Layered on top of the Phase 5 `vault-multi.ts` —
// multisig vaults are a sibling of single-signer vaults inside the
// same on-disk container.

import { invoke } from "@tauri-apps/api/core";

// ─── Public types ──────────────────────────────────────────────────

export type SignerKindWire = "local" | "external";

/** Wire-shape signer entry returned by Tauri (snake_case from Rust). */
export interface SignerEntryWire {
  id: string;
  label: string;
  pubkey: string;
  address: string;
  kind: SignerKindWire;
  vault_id?: string;
  created_at: number;
}

/** UI-facing signer entry (camelCase). */
export interface SignerEntry {
  id: string;
  label: string;
  pubkey: string;
  address: string;
  kind: SignerKindWire;
  vaultId?: string;
  createdAt: number;
}

/** Input shape for `multisig_create`. */
export interface SignerInput {
  label: string;
  pubkey: string;
  kind: SignerKindWire;
  vaultId?: string;
}

/** Wire-shape multisig vault summary. */
export interface MultisigVaultSummaryWire {
  id: string;
  label: string;
  address: string;
  created_at: number;
  threshold: number;
  signer_count: number;
  signers: SignerEntryWire[];
  is_active: boolean;
  pending_proposal_count: number;
}

/** UI-facing multisig vault summary. */
export interface MultisigVaultSummary {
  id: string;
  label: string;
  address: string;
  createdAt: number;
  threshold: number;
  signerCount: number;
  signers: SignerEntry[];
  isActive: boolean;
  pendingProposalCount: number;
}

export type ProposalOperationKind =
  | "send"
  | "token_transfer"
  | "stake"
  | "naming"
  | "governance";

export interface ProposalOperationWire {
  kind: ProposalOperationKind;
}

export type ProposalState =
  | "draft"
  | "collecting"
  | "ready_to_submit"
  | "submitted"
  | "failed"
  | "expired"
  | "cancelled";

/** Wire shape — bigints serialized as strings; arrays via snake_case. */
export interface ProposalWire {
  id: string;
  multisig_vault_id: string;
  operation: ProposalOperationWire;
  payload_hex: string;
  payload_hash: string;
  created_at: number;
  expires_at: number;
  signatures: {
    signer_address: string;
    signature: string;
    signed_at: number;
  }[];
  state: ProposalState;
  created_by: string;
  tx_hash: string | null;
}

export interface Proposal {
  id: string;
  multisigVaultId: string;
  operation: ProposalOperationKind;
  payloadHex: string;
  payloadHash: string;
  createdAt: number;
  expiresAt: number;
  signatures: {
    signerAddress: string;
    signature: string;
    signedAt: number;
  }[];
  state: ProposalState;
  createdBy: string;
  txHash: string | null;
}

// ─── Error envelope ───────────────────────────────────────────────

export type MultisigErrorCode =
  | "invalid_label"
  | "invalid_signer_count"
  | "invalid_threshold"
  | "invalid_pubkey"
  | "invalid_signer_address"
  | "invalid_signer_label"
  | "duplicate_signer"
  | "invalid_local_vault_ref"
  | "not_found";

export type ProposalErrorCode =
  | "vault_not_found"
  | "not_found"
  | "payload_too_large"
  | "bad_signature_length"
  | "unknown_signer"
  | "duplicate_signature"
  | "terminal"
  | "expired"
  | "below_threshold"
  | "not_creator"
  | "invalid_argument";

/** Rust returns `{code: "multisig", "0": <MultisigError>}` etc. via
 *  `#[from]`. We normalize to a flat union for TS consumption. */
export interface MultisigCallError {
  layer: "multisig" | "proposal" | "vault" | "backend";
  code: string;
  message: string;
}

export class MultisigInvokeError extends Error {
  override readonly cause: MultisigCallError;
  constructor(cause: MultisigCallError) {
    super(`[${cause.layer}/${cause.code}] ${cause.message}`);
    this.name = "MultisigInvokeError";
    this.cause = cause;
  }
}

function normalizeError(raw: unknown): MultisigInvokeError {
  if (raw && typeof raw === "object" && "code" in raw) {
    const r = raw as { code: string; [k: string]: unknown };
    // Wrapper case: { code: "multisig" | "proposal" | "vault", "0": inner }
    if (r.code === "multisig" || r.code === "proposal" || r.code === "vault") {
      const inner = r["0"] as { code?: string; message?: string } | undefined;
      const innerCode = (inner?.code as string | undefined) ?? "unknown";
      const innerMsg = (inner?.message as string | undefined) ?? JSON.stringify(inner);
      return new MultisigInvokeError({
        layer: r.code as "multisig" | "proposal" | "vault",
        code: innerCode,
        message: innerMsg,
      });
    }
    if (r.code === "backend") {
      return new MultisigInvokeError({
        layer: "backend",
        code: "backend",
        message: (r.message as string | undefined) ?? "backend error",
      });
    }
    // Direct error shape (no wrapper) — treat as multisig layer.
    return new MultisigInvokeError({
      layer: "multisig",
      code: r.code,
      message: (r.message as string | undefined) ?? JSON.stringify(r),
    });
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new MultisigInvokeError({
    layer: "backend",
    code: "backend",
    message,
  });
}

// ─── Wire ↔ camelCase mappers ─────────────────────────────────────

function signerFromWire(w: SignerEntryWire): SignerEntry {
  return {
    id: w.id,
    label: w.label,
    pubkey: w.pubkey,
    address: w.address,
    kind: w.kind,
    vaultId: w.vault_id,
    createdAt: w.created_at,
  };
}

function multisigSummaryFromWire(w: MultisigVaultSummaryWire): MultisigVaultSummary {
  return {
    id: w.id,
    label: w.label,
    address: w.address,
    createdAt: w.created_at,
    threshold: w.threshold,
    signerCount: w.signer_count,
    signers: w.signers.map(signerFromWire),
    isActive: w.is_active,
    pendingProposalCount: w.pending_proposal_count,
  };
}

function proposalFromWire(w: ProposalWire): Proposal {
  return {
    id: w.id,
    multisigVaultId: w.multisig_vault_id,
    operation: w.operation.kind,
    payloadHex: w.payload_hex,
    payloadHash: w.payload_hash,
    createdAt: w.created_at,
    expiresAt: w.expires_at,
    signatures: w.signatures.map((s) => ({
      signerAddress: s.signer_address,
      signature: s.signature,
      signedAt: s.signed_at,
    })),
    state: w.state,
    createdBy: w.created_by,
    txHash: w.tx_hash,
  };
}

// ─── Public command wrappers ──────────────────────────────────────

/** Create a multisig vault. Master password verified Rust-side. */
export async function multisigCreate(args: {
  label: string;
  signers: SignerInput[];
  threshold: number;
  password: string;
}): Promise<MultisigVaultSummary> {
  if (!args.label.trim()) {
    throw new MultisigInvokeError({
      layer: "multisig",
      code: "invalid_label",
      message: "label is empty",
    });
  }
  if (!args.password) {
    throw new MultisigInvokeError({
      layer: "vault",
      code: "invalid_argument",
      message: "password is empty",
    });
  }
  if (args.signers.length === 0 || args.signers.length > 15) {
    throw new MultisigInvokeError({
      layer: "multisig",
      code: "invalid_signer_count",
      message: `signers must be 1..=15 (got ${args.signers.length})`,
    });
  }
  if (args.threshold < 1 || args.threshold > args.signers.length) {
    throw new MultisigInvokeError({
      layer: "multisig",
      code: "invalid_threshold",
      message: `threshold ${args.threshold} not in 1..=${args.signers.length}`,
    });
  }
  try {
    const wire = await invoke<MultisigVaultSummaryWire>("multisig_create", {
      label: args.label,
      signers: args.signers.map((s) => ({
        label: s.label,
        pubkey: s.pubkey,
        kind: s.kind,
        vault_id: s.vaultId,
      })),
      threshold: args.threshold,
      password: args.password,
    });
    return multisigSummaryFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** List all multisig vaults. */
export async function multisigsList(): Promise<MultisigVaultSummary[]> {
  try {
    const wire = await invoke<MultisigVaultSummaryWire[]>("multisigs_list");
    return wire.map(multisigSummaryFromWire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Switch the active vault to a multisig. Wallet must be unlocked. */
export async function multisigSelect(
  multisigVaultId: string,
): Promise<MultisigVaultSummary> {
  try {
    const wire = await invoke<MultisigVaultSummaryWire>("multisig_select", {
      multisigVaultId,
    });
    return multisigSummaryFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Apply a governance change carried by a fully-signed proposal. */
export async function multisigApplyGovernance(
  proposalId: string,
): Promise<MultisigVaultSummary> {
  try {
    const wire = await invoke<MultisigVaultSummaryWire>(
      "multisig_apply_governance",
      { proposalId },
    );
    return multisigSummaryFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Encode a governance "SetThreshold(N)" payload as 2 bytes (disc + N). */
export function encodeGovernanceSetThreshold(newThreshold: number): Uint8Array {
  if (newThreshold < 1 || newThreshold > 255) {
    throw new Error("threshold out of range [1, 255]");
  }
  return new Uint8Array([0x01, newThreshold]);
}

/** Encode a governance "AddSigner" payload. `vaultId` is only used when
 *  `kind === "local"`. Pubkey is the standard 0x + 3904-hex form. */
export function encodeGovernanceAddSigner(args: {
  kind: SignerKindWire;
  label: string;
  pubkey: string;
  vaultId?: string;
}): Uint8Array {
  const labelBytes = new TextEncoder().encode(args.label.trim());
  if (labelBytes.length === 0 || labelBytes.length > 32) {
    throw new Error("label must be 1..=32 bytes after trim");
  }
  const pubBytes = hexToBytes(args.pubkey);
  if (pubBytes.length !== 1952) {
    throw new Error(`pubkey must be 1952 bytes, got ${pubBytes.length}`);
  }
  const kindByte = args.kind === "local" ? 1 : 0;
  let extra: Uint8Array | null = null;
  if (args.kind === "local") {
    if (!args.vaultId) throw new Error("local signer requires vaultId");
    const vidBytes = new TextEncoder().encode(args.vaultId);
    if (vidBytes.length === 0 || vidBytes.length > 255) {
      throw new Error("vaultId length must be 1..=255 bytes");
    }
    extra = new Uint8Array(1 + vidBytes.length);
    extra[0] = vidBytes.length;
    extra.set(vidBytes, 1);
  }
  const extraLen = extra?.length ?? 0;
  const out = new Uint8Array(1 + 1 + 1 + labelBytes.length + pubBytes.length + extraLen);
  let i = 0;
  out[i++] = 0x02;
  out[i++] = kindByte;
  out[i++] = labelBytes.length;
  out.set(labelBytes, i);
  i += labelBytes.length;
  out.set(pubBytes, i);
  i += pubBytes.length;
  if (extra) out.set(extra, i);
  return out;
}

/** Encode a governance "RemoveSigner(address)" payload — 21 bytes. */
export function encodeGovernanceRemoveSigner(addressHex: string): Uint8Array {
  const addrBytes = hexToBytes(addressHex);
  if (addrBytes.length !== 20) {
    throw new Error(`address must be 20 bytes, got ${addrBytes.length}`);
  }
  const out = new Uint8Array(1 + 20);
  out[0] = 0x03;
  out.set(addrBytes, 1);
  return out;
}

/** Encode a governance "RotateSigner" payload. Replaces an existing
 *  signer's pubkey + label in place; the signer's id is preserved. */
export function encodeGovernanceRotateSigner(args: {
  oldAddress: string;
  newLabel: string;
  newPubkey: string;
}): Uint8Array {
  const oldBytes = hexToBytes(args.oldAddress);
  if (oldBytes.length !== 20) {
    throw new Error("oldAddress must be 20 bytes");
  }
  const labelBytes = new TextEncoder().encode(args.newLabel.trim());
  if (labelBytes.length === 0 || labelBytes.length > 32) {
    throw new Error("newLabel must be 1..=32 bytes");
  }
  const pubBytes = hexToBytes(args.newPubkey);
  if (pubBytes.length !== 1952) {
    throw new Error(`newPubkey must be 1952 bytes, got ${pubBytes.length}`);
  }
  const out = new Uint8Array(1 + 20 + 1 + labelBytes.length + pubBytes.length);
  let i = 0;
  out[i++] = 0x04;
  out.set(oldBytes, i);
  i += 20;
  out[i++] = labelBytes.length;
  out.set(labelBytes, i);
  i += labelBytes.length;
  out.set(pubBytes, i);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length % 2 !== 0) {
    throw new Error("hex must have even length");
  }
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Create a Draft proposal. The caller subsequently signs the
 *  proposal's `payloadHash` (TS-side via MlDsa65Backend) and calls
 *  `proposalAttachSignature` with the result. */
export async function proposalCreate(args: {
  multisigVaultId: string;
  operation: ProposalOperationKind;
  payload: Uint8Array;
  createdByAddress: string;
  ttlSecs?: number;
}): Promise<Proposal> {
  try {
    const wire = await invoke<ProposalWire>("proposal_create", {
      multisigVaultId: args.multisigVaultId,
      operation: { kind: args.operation },
      payload: Array.from(args.payload),
      createdByAddress: args.createdByAddress,
      ttlSecs: args.ttlSecs ?? null,
    });
    return proposalFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Attach a signature to an existing proposal. */
export async function proposalAttachSignature(args: {
  proposalId: string;
  signerAddress: string;
  signature: Uint8Array;
}): Promise<Proposal> {
  try {
    const wire = await invoke<ProposalWire>("proposal_attach_signature", {
      proposalId: args.proposalId,
      signerAddress: args.signerAddress,
      signature: Array.from(args.signature),
    });
    return proposalFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Mark a proposal as submitted after the wallet broadcasts the
 *  bundled tx. Records the off-chain audit trail. */
export async function proposalMarkSubmitted(args: {
  proposalId: string;
  txHash: string;
}): Promise<Proposal> {
  try {
    const wire = await invoke<ProposalWire>("proposal_mark_submitted", {
      proposalId: args.proposalId,
      txHash: args.txHash,
    });
    return proposalFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Cancel a proposal (creator-only). */
export async function proposalCancel(args: {
  proposalId: string;
  byAddress: string;
}): Promise<void> {
  try {
    await invoke<void>("proposal_cancel", {
      proposalId: args.proposalId,
      byAddress: args.byAddress,
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** List proposals for one multisig vault. Reconciles expiry server-
 *  side so callers see a fresh view. */
export async function proposalsList(
  multisigVaultId: string,
): Promise<Proposal[]> {
  try {
    const wire = await invoke<ProposalWire[]>("proposals_list", {
      multisigVaultId,
    });
    return wire.map(proposalFromWire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Import a signature from off-band exchange (Commit 9 envelope). */
export async function proposalImportSignature(args: {
  proposalId: string;
  signerAddress: string;
  signature: Uint8Array;
}): Promise<Proposal> {
  try {
    const wire = await invoke<ProposalWire>("proposal_import_signature", {
      proposalId: args.proposalId,
      signerAddress: args.signerAddress,
      signature: Array.from(args.signature),
    });
    return proposalFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

// ─── Test-only helpers ────────────────────────────────────────────

export const _multisigSummaryFromWireForTest = multisigSummaryFromWire;
export const _proposalFromWireForTest = proposalFromWire;
export const _normalizeErrorForTest = normalizeError;
