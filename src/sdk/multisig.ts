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
