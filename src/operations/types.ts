// OperationsDrawer types.
//
// Every action that touches the chain (RPC SDK call) or the local
// keychain (Tauri command) routes through this surface. Stage 2 ships
// the four-stage state machine and a `preview → auth → executing → done`
// flow with a typed `OperationDescriptor`. Stages 3+ extend it with real
// Ledger and keystore signing paths.

export type OperationStage = "preview" | "auth" | "executing" | "done" | "error";

/**
 * A single-row diff line shown in the preview pane.
 * `kind` lets the drawer style additions vs. fee lines vs. plain values.
 */
export interface OperationDiffLine {
  k: string;
  v: string;
  kind?: "value" | "fee" | "warn";
}

/**
 * A side effect surfaced to the user before they sign. The drawer shows
 * these as a bulleted list — the contract is "every chain-visible
 * consequence of approving must show up here, in plain English".
 */
export interface OperationEffect {
  text: string;
  level?: "info" | "warn";
}

/**
 * Authentication strategy for the operation. `keychain` is the default
 * (OS keychain via Tauri); `hardware` is Stage 4's Ledger path; `none`
 * is the read-only escape hatch for SDK-only operations that still want
 * to use the drawer chrome (e.g. an `eth_call` dry-run preview).
 */
export type AuthMethod = "keychain" | "hardware" | "passkey" | "none";

/**
 * Optional Ledger context. Only relevant when `auth === "hardware"`.
 * `hdPath` defaults to `m/44'/60'/0'/0/0` if not provided. The drawer uses
 * `expectedAddress` to confirm the user picked the right device — when
 * present, the address read from the device must match (lowercase).
 */
export interface LedgerContext {
  /** BIP-44 derivation path. Defaults to `m/44'/60'/0'/0/0` if absent. */
  hdPath?: string;
  /**
   * Lowercase 0x-prefixed address that the drawer expects to see on the
   * device. If supplied and the device returns something different, the
   * drawer surfaces a hard error (wrong device or wrong path).
   */
  expectedAddress?: string;
}

export interface OperationDescriptor {
  /** Short title shown in the drawer head — e.g. `Send LYTH`. */
  title: string;
  /** One-line subtitle — usually the user-facing summary. */
  subtitle?: string;
  /** Diff lines for the preview pane. */
  diff: OperationDiffLine[];
  /** User-facing side-effects of approval. */
  effects: OperationEffect[];
  /** Auth method required to advance from `preview` to `executing`. */
  auth: AuthMethod;
  /** Hardware-signer context (only used when `auth === "hardware"`). */
  ledger?: LedgerContext;
  /**
   * Optional multisig routing. When the active vault is a multisig AND
   * this field is set, the drawer routes the operation through
   * `proposal_create` + `proposal_attach_signature` (the creator's own
   * share) instead of calling `execute`. The descriptor's `payload` is
   * the operation's binary representation; the Rust side stores it
   * opaquely + keccak256-hashes it (with the operation discriminator
   * and domain tag) to produce the `payload_hash` each member signs.
   */
  proposal?: ProposalRouting;
  /**
   * Phase 8 — two-tier policy gate inputs. When supplied, the drawer
   * evaluates the user's policy after the master-password unlock: if
   * `valueLyth >= triggerThresholdLyth` AND `policy.passkeyRequired`
   * AND ≥1 passkey is enrolled, the drawer requests a passkey
   * assertion before calling `execute`. Below the threshold, or with
   * the policy off, or with no passkey enrolled, the assertion is
   * skipped and the legacy single-factor flow proceeds. Whitepaper
   * §28.5 Q29-31.
   */
  policy?: PolicyGate;
  /**
   * The actual work. Resolves with an arbitrary "result" payload (tx hash,
   * RPC echo, etc.); throws to land the drawer in `error`. Implementations
   * are responsible for the chain side; the drawer owns UI state only.
   */
  execute: (ctx?: OperationExecutionContext) => Promise<OperationResult>;
}

/** Inputs the OperationsDrawer needs to run the two-tier policy gate.
 *  Caller (the form that builds the descriptor) computes both:
 *   - `valueLyth` from the operation-specific interpretation
 *     (Send: amount; Stake: stake amount; Names: register fee;
 *      ERC-20: amount via decimals; NFT: fixed gas threshold or zero)
 *   - `payloadHashB64` from the canonical tx bytes (base64url-no-pad
 *     of a 32-byte hash; the wallet uses Keccak-256 over the same
 *     bytes that go to the ML-DSA signer downstream) */
export interface PolicyGate {
  valueLyth: number;
  payloadHashB64: string;
}

/** Proposal routing carries the operation kind + the raw payload bytes
 *  the wallet would otherwise broadcast directly. The drawer creates the
 *  proposal in Draft state and attaches the creator's signature in one
 *  shot when proposal routing is active. */
export interface ProposalRouting {
  operation:
    | "send"
    | "token_transfer"
    | "stake"
    | "naming"
    | "governance";
  payload: Uint8Array;
}

export interface OperationExecutionContext {
  /** Present only after `auth: "keychain"` succeeds. */
  vaultSeed?: Uint8Array;
}

export interface OperationResult {
  /** Plain-English headline for the `done` pane. */
  headline: string;
  /** Optional long-form detail (tx hash, block number, etc.). */
  detail?: string;
  /** Optional URL the user can copy from the done pane. */
  link?: string;
  /** Set when the drawer routed through proposal creation. Triggers the
   *  "go to proposals" CTA on the Done pane. */
  proposalId?: string;
}
