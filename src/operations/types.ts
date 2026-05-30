// OperationsDrawer types.
//
// Every action that touches the chain (RPC SDK call) or the local
// keychain (Tauri command) routes through this surface. Stage 2 ships
// the four-stage state machine and a `preview → auth → executing → done`
// flow with a typed `OperationDescriptor`. Stages 3+ extend it with real
// Ledger and keystore signing paths.

import type { TxOpKind } from "../sdk/notifications";

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
   * Optional in-app notification metadata. When present (and the wallet's
   * experimental flag is on), the drawer records a notification on the
   * operation's terminal transition: `"failed"` immediately when `execute`
   * throws, `"confirmed"` only after a bounded `lyth_txStatus` poll observes
   * the broadcast tx on-chain. Submission-only operations that never resolve
   * a canonical tx hash leave this unset and record nothing.
   */
  notify?: OperationNotifyMeta;
  /**
   * The actual work. Resolves with an arbitrary "result" payload (tx hash,
   * RPC echo, etc.); throws to land the drawer in `error`. Implementations
   * are responsible for the chain side; the drawer owns UI state only.
   */
  execute: (ctx?: OperationExecutionContext) => Promise<OperationResult>;
}

/**
 * Structured notification metadata for an operation. No secrets: only the
 * operation kind, the formatted LYTH amount (or "0"), and the typed bech32m
 * counterparty — never a contact name.
 */
export interface OperationNotifyMeta {
  kind: TxOpKind;
  /** Already-formatted LYTH decimal string (e.g. "12.50"), or "0". */
  amountDecimal: string;
  /** Typed bech32m counterparty (recipient or precompile target). */
  counterparty: string;
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
  /**
   * Canonical inner-tx hash, when this operation produced exactly one. The
   * notification hook reads this (paired with `descriptor.notify`) to key the
   * `lyth_txStatus` confirm-poll and the dedupe id. Operations that submit
   * zero or many txs (or none that resolve a hash) leave it unset.
   */
  txHash?: string;
}
