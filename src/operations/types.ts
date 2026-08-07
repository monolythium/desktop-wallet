// OperationsDrawer types.
//
// Every action that touches the chain (RPC SDK call) or the local
// keychain (Tauri command) routes through this surface. Stage 2 ships
// the four-stage state machine and a `preview → auth → executing → done`
// flow with a typed `OperationDescriptor`. Stages 3+ extend it with the
// real keystore signing path.

import type { TxOpKind } from "../sdk/notifications";
import type { SendErrorContext } from "../sdk/send-error";

export type OperationStage = "preview" | "auth" | "executing" | "done" | "error";

/**
 * A single-row diff line shown in the preview pane.
 * `kind` lets the drawer style additions vs. fee lines vs. plain values.
 */
export interface OperationDiffLine {
  k: string;
  v: string;
  kind?: "value" | "fee" | "warn";
  /**
   * Optional fiat estimate, rendered as a SEPARATE span after `v` — the
   * additive-sibling law bound at the type level, so `v` stays byte-identical
   * whether or not this is set. Set it only for LYTH-denominated rows: a
   * token-denominated amount gets none, since no token price source exists
   * behind that seam. Omit it when the row's amount is unknown — the absence of
   * a figure and the absence of a rate are different facts.
   */
  fiat?: string;
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
 * (OS keychain via Tauri); `none` is the read-only escape hatch for
 * SDK-only operations that still want to use the drawer chrome (e.g. an
 * `eth_call` dry-run preview).
 */
export type AuthMethod = "keychain" | "passkey" | "none";

/**
 * Who is paid and how much — the two facts that must be on screen at the moment
 * the seed is released.
 *
 * The drawer renders this at the `auth` stage, where until now a user saw a
 * banner and a password field and no transaction fact at all. The diff stays at
 * `preview`: a ten-row wall above a password field is not a summary, and the
 * batch surfaces can produce exactly that.
 *
 * REQUIRED, deliberately. Optional, this would be a guard that reports the
 * omission after someone shipped it; required, a new signing surface cannot be
 * added without answering the question.
 *
 * A surface ANSWERS this — it does not restate its diff. Where nothing leaves
 * the wallet `amount` is null and the drawer says so, because "this moves no
 * funds" is a fact a user acts on.
 *
 * ⚠ The diff's own payee/amount rows must be built FROM this object, never
 * authored beside it. Two copies of one fact on two screens can drift, and a
 * wallet showing a user two answers to "who is being paid" is worse than one
 * showing a single answer in one place.
 */
export interface OperationCommitment {
  /**
   * The counterparty as the user understands it.
   *
   * Where the USER chose the target, this is that address (with its name when
   * one resolved). Where the WALLET chose it — a precompile the user never
   * picked — an address here would be noise at the one moment noise is most
   * expensive, so this states what the operation IS instead. The precompile is
   * still shown, derived, in the preview disclosure.
   */
  subject: string;
  /** The amount leaving this wallet, formatted with its unit, or `null` when
   *  none does (the signed `value` is `0n`). */
  amount: string | null;
}

export interface OperationDescriptor {
  /** Short title shown in the drawer head — e.g. `Send LYTH`. */
  title: string;
  /** One-line subtitle — usually the user-facing summary. */
  subtitle?: string;
  /** Payee + amount, rendered at `auth`. See {@link OperationCommitment}. */
  commitment: OperationCommitment;
  /** Diff lines for the preview pane. */
  diff: OperationDiffLine[];
  /**
   * Secondary rows, rendered inside a CLOSED `<details>` in the preview pane.
   *
   * For signed components that are checkable but carry no decision on their own
   * — the precompile target the wallet chose rather than the user, the key
   * material inside a policy claim. Promoting them would train a user to skip
   * rows; omitting them would leave a signed value with no representation at
   * all. A disclosure is the honest third answer.
   *
   * `<details>` and NOT `CollapsibleSection`: that component hides with the
   * `hidden` attribute, which takes collapsed content out of the accessibility
   * tree. A consent surface must not put a signed fact somewhere a screen
   * reader cannot reach, and `<details>` keeps it reachable either way.
   *
   * ⚠ Every value here must be DERIVED from what is signed. A typed literal
   * that happens to be correct today cannot disagree with the signed value, and
   * therefore cannot detect a change to it — which is the entire reason the row
   * exists.
   */
  details?: OperationDiffLine[];
  /** User-facing side-effects of approval. */
  effects: OperationEffect[];
  /** Auth method required to advance from `preview` to `executing`. */
  auth: AuthMethod;
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
   * Optional figures for the error classifier's insufficient-funds shortfall
   * body (§8.5). Native send descriptors supply LYTH balance/amount/reservation;
   * other operations omit it and get the generic body.
   */
  errorContext?: SendErrorContext;
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
  /** Already-formatted decimal amount string (e.g. "12.50"), or "0". */
  amountDecimal: string;
  /** Amount unit — the token symbol for an MRC-20 send, omitted for native
   *  LYTH (renders as "LYTH"). Keeps a token send from being mislabeled LYTH. */
  unit?: string;
  /** Typed bech32m counterparty (recipient or precompile target). */
  counterparty: string;
  /** For delegation kinds: the target cluster, so the recorded notification can
   *  name the cluster instead of the bare delegation-module address. Optional. */
  clusterId?: number;
  clusterName?: string;
  /** Delegation weight in basis points, so the notification body can state the
   *  percent. For a redelegate the fields above are the SOURCE cluster and the
   *  two below the DESTINATION. Display metadata only — it never reaches the
   *  signed calldata, which is built independently in `execute`. */
  delegationWeightBps?: number;
  toClusterId?: number;
  toClusterName?: string;
}

export interface OperationExecutionContext {
  /** Present only after `auth: "keychain"` succeeds. */
  vaultSeed?: Uint8Array;
  /**
   * Add facts to this operation's notification metadata that only `execute`
   * can know.
   *
   * A descriptor is written before the work runs, so a MULTI-SUBMISSION
   * operation can only describe its plan there — it cannot say which of N
   * allocations will be the one to fail. That fact exists exactly once, inside
   * the catch, and this is how it reaches the record instead of dying with the
   * throw.
   *
   * MERGED OVER the descriptor's own metadata, never replacing it: the
   * plan-level facts stay true and the subject-level ones are added. A patch
   * carries only fields {@link OperationNotifyMeta} already defines, so
   * refining a record changes what it SAYS, never its shape.
   *
   * Single-submission operations — every other caller — leave it untouched and
   * record exactly what their descriptor declared.
   */
  refineNotify?: (patch: Partial<OperationNotifyMeta>) => void;
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
  /** Account nonce the single broadcast tx signed with, when known. Captured
   *  onto the tracked tx so the reconciler can detect a dropped tx. */
  nonce?: number;
}
