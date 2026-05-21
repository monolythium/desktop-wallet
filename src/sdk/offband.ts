// Off-band coordination envelope for multisig proposals.
//
// The chain has no multisig precompile so co-signers don't see each
// other's signatures via on-chain state. The wallet exports a textual
// envelope the user copies to their co-signer via any channel
// (Signal, email, in-person), and the co-signer imports it to
// (a) sign the proposal locally if they're a member, then (b) send
// back a signature envelope the creator imports to attach. Once the
// threshold is reached the creator's wallet broadcasts the bundled
// envelope.
//
// V1 ships text-only envelopes (newline-tolerant base64-padded JSON).
// QR rendering is deferred to a future phase — the textual form is
// portable across every channel + clipboard the user already uses, and
// can be wrapped in QR by any standalone tool.

import type { Proposal } from "./multisig";

export const ENVELOPE_VERSION = "monolythium.multisig.envelope.v1";

/** Proposal share — sent FROM the creator TO a co-signer so they can
 *  sign the same payload. The co-signer reconstructs the proposal
 *  locally; the creator's wallet later imports the resulting signature
 *  via a `signature` envelope. */
export interface ProposalShareEnvelope {
  type: typeof ENVELOPE_VERSION;
  kind: "proposal-share";
  multisigVaultId: string;
  proposalId: string;
  operation:
    | "send"
    | "token_transfer"
    | "stake"
    | "naming"
    | "governance";
  payloadHex: string;
  payloadHash: string;
  expiresAt: number;
  createdBy: string;
}

/** Signature share — sent FROM a co-signer TO the creator carrying the
 *  3309-byte ML-DSA-65 signature the co-signer produced. The creator
 *  imports it via `proposal_import_signature`. */
export interface SignatureShareEnvelope {
  type: typeof ENVELOPE_VERSION;
  kind: "signature";
  proposalId: string;
  signerAddress: string;
  /** Hex string — 0x + 6618 chars (3309 bytes). */
  signatureHex: string;
}

export type OffbandEnvelope = ProposalShareEnvelope | SignatureShareEnvelope;

// ─── Encode ───────────────────────────────────────────────────────

/** Build a "share this proposal with a co-signer" envelope. */
export function encodeProposalShare(proposal: Proposal): string {
  const env: ProposalShareEnvelope = {
    type: ENVELOPE_VERSION,
    kind: "proposal-share",
    multisigVaultId: proposal.multisigVaultId,
    proposalId: proposal.id,
    operation: proposal.operation,
    payloadHex: proposal.payloadHex,
    payloadHash: proposal.payloadHash,
    expiresAt: proposal.expiresAt,
    createdBy: proposal.createdBy,
  };
  return JSON.stringify(env, null, 2);
}

/** Build a "here's my signature" envelope. */
export function encodeSignatureShare(args: {
  proposalId: string;
  signerAddress: string;
  signature: Uint8Array;
}): string {
  const env: SignatureShareEnvelope = {
    type: ENVELOPE_VERSION,
    kind: "signature",
    proposalId: args.proposalId,
    signerAddress: args.signerAddress.toLowerCase(),
    signatureHex: bytesToHex(args.signature),
  };
  return JSON.stringify(env, null, 2);
}

// ─── Decode ───────────────────────────────────────────────────────

/** Parse a textual envelope. Throws with a useful message on any
 *  schema failure — caller surfaces it as a banner. */
export function decodeEnvelope(text: string): OffbandEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch (cause) {
    throw new Error(`Not valid JSON: ${(cause as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Envelope must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== ENVELOPE_VERSION) {
    throw new Error(
      `Wrong envelope type "${String(obj.type)}" — expected "${ENVELOPE_VERSION}"`,
    );
  }
  if (obj.kind === "proposal-share") {
    return decodeProposalShare(obj);
  }
  if (obj.kind === "signature") {
    return decodeSignatureShare(obj);
  }
  throw new Error(`Unknown envelope kind "${String(obj.kind)}"`);
}

function decodeProposalShare(obj: Record<string, unknown>): ProposalShareEnvelope {
  const required = [
    "multisigVaultId",
    "proposalId",
    "operation",
    "payloadHex",
    "payloadHash",
    "expiresAt",
    "createdBy",
  ];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`Missing field: ${k}`);
  }
  const op = String(obj.operation);
  if (!["send", "token_transfer", "stake", "naming", "governance"].includes(op)) {
    throw new Error(`Unknown operation kind: ${op}`);
  }
  return {
    type: ENVELOPE_VERSION,
    kind: "proposal-share",
    multisigVaultId: String(obj.multisigVaultId),
    proposalId: String(obj.proposalId),
    operation: op as ProposalShareEnvelope["operation"],
    payloadHex: String(obj.payloadHex),
    payloadHash: String(obj.payloadHash),
    expiresAt: Number(obj.expiresAt),
    createdBy: String(obj.createdBy),
  };
}

function decodeSignatureShare(obj: Record<string, unknown>): SignatureShareEnvelope {
  const required = ["proposalId", "signerAddress", "signatureHex"];
  for (const k of required) {
    if (!(k in obj)) throw new Error(`Missing field: ${k}`);
  }
  const sigHex = String(obj.signatureHex).toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(sigHex)) {
    throw new Error("signatureHex must be 0x + hex");
  }
  // ML-DSA-65 signature is exactly 3309 bytes → 6618 hex chars.
  if (sigHex.length !== 2 + 3309 * 2) {
    throw new Error(
      `signatureHex must be ${2 + 3309 * 2} chars (3309 bytes), got ${sigHex.length}`,
    );
  }
  return {
    type: ENVELOPE_VERSION,
    kind: "signature",
    proposalId: String(obj.proposalId),
    signerAddress: String(obj.signerAddress).toLowerCase(),
    signatureHex: sigHex,
  };
}

/** Parse the 3309-byte signature from a signature envelope's hex
 *  field. Mirrors the validation in `decodeSignatureShare`. */
export function signatureBytesFromHex(hex: string): Uint8Array {
  const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (stripped.length !== 3309 * 2) {
    throw new Error(`Expected ${3309 * 2} hex chars, got ${stripped.length}`);
  }
  const out = new Uint8Array(3309);
  for (let i = 0; i < 3309; i += 1) {
    out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
