// Pure tracked-tx model — types, the store key, the dedupe id, the window-
// expiry predicate, and the per-tx terminal-state classifier.
//
// A "tracked tx" is one the wallet broadcast (the node accepted the encrypted
// envelope and returned a canonical inner-tx hash) and now follows to a real
// terminal state. The durable store (`pending-tx-store.ts`) persists the set
// across drawer-close and app restart; the app-level poller (`reconcile.ts`)
// drives this classifier on an interval and records ONE notification per
// terminal transition.
//
// No `@tauri-apps/*`, no DOM, no RPC client, no module-scope state — every
// helper here is deterministic and unit-testable in vitest without shims. The
// only adaptation vs. the browser wallet's tracked-tx core: the chain calls
// live in `reconcile.ts` (which holds the RpcClient), so this module takes the
// two raw chain answers (`lyth_txStatus` + the receipt) as inputs and returns
// a verdict, keeping the decision logic pure.
//
// Invariants this module upholds (mirrored from the browser tracked-tx rules):
//   - Status fidelity: a verdict is `"confirmed" | "failed"` ONLY on an
//     explicit on-chain observation — `lyth_txStatus="found"`, or a receipt
//     carrying `status === 1` (confirmed) / `status === 0` (failed). Every
//     other answer (`not_found`, a null receipt, an unparseable status, a
//     thrown RPC) keeps the tx pending; we NEVER synthesize a terminal verdict.
//   - Dedupe by canonical hash: the notification id stays `${chainIdHex}:${txHash}`
//     (built in `notifications.ts`), so a recorded terminal transition can
//     never re-fire for a tx the user already saw.
//   - Honest absence: a tx that never reaches a terminal state inside its
//     tracking window is dropped silently — no record.

import type { TxOpKind } from "./notifications";

/** One tracked transaction the wallet is following to a terminal state.
 *  Persisted by `pending-tx-store.ts`. No secrets — only the canonical hash,
 *  the chain, the operation classification, the formatted amount, the typed
 *  counterparty, and the enqueue timestamp (the tracking-window anchor). */
export interface PendingTx {
  /** Canonical inner-tx hash. 0x-prefixed. The chain-status key. */
  txHash: string;
  /** Hex chain id — disambiguates the same hash across chains and pairs with
   *  `txHash` to form the notification dedupe id. */
  chainIdHex: string;
  /** Lowercased wallet address the notification scopes to (the sender). */
  addressLower: string;
  /** Operation classification — copied straight onto the notification record
   *  so the friendly title matches the originating action. */
  opKind: TxOpKind;
  /** Already-formatted LYTH decimal string (e.g. "12.50"), or "0". NEVER a
   *  BigInt — the store serializes JSON only. */
  amountDecimal: string;
  /** Typed bech32m counterparty (recipient or precompile target). */
  counterparty: string;
  /** Epoch ms the tx was enqueued. The tracking window is measured from here. */
  submittedAt: number;
}

/** Single on-disk store key. One blob holds every tracked tx (tiny set — at
 *  most a handful of outstanding sends), mirroring the notifications store's
 *  single-file shape. */
export const PENDING_TX_STORE_KEY = "mono.pending-tx.v1";

/** Tracking-window ceiling. A tx that hasn't reached a terminal state within
 *  this many ms of `submittedAt` is dropped silently (honest absence — the
 *  user already saw the broadcast in the Done pane; we never fabricate a
 *  verdict). Five minutes comfortably covers testnet anchoring + indexer lag
 *  without following a wedged tx forever. Matches the browser's PENDING_TTL. */
export const PENDING_TX_WINDOW_MS = 5 * 60 * 1_000;

/** True once a tracked tx has aged past its tracking window. Pure — the caller
 *  passes `now` so this stays deterministic in tests. */
export function isPendingExpired(
  tx: Pick<PendingTx, "submittedAt">,
  now: number,
  windowMs: number = PENDING_TX_WINDOW_MS,
): boolean {
  return now - tx.submittedAt >= windowMs;
}

/** The two raw chain answers the classifier consumes for one tx, already
 *  normalized to the shapes the SDK returns. `txStatus` is the discriminated
 *  `lyth_txStatus` outcome; `receipt` is the (optional) `eth_getTransactionReceipt`
 *  result. A `"throw"` marker on either field models an RPC failure — the
 *  classifier treats it as "no answer this round" (keep pending), never as a
 *  verdict. */
export interface ChainProbe {
  /** `lyth_txStatus` outcome. `"found"` carries the inclusion block number;
   *  `"not_found"` means the indexer hasn't surfaced it yet; `"throw"` means
   *  the call failed this round. */
  txStatus:
    | { kind: "found"; blockNumber: number | null }
    | { kind: "not_found" }
    | { kind: "throw" };
  /** `eth_getTransactionReceipt` outcome. Present only when consulted (we skip
   *  it once `lyth_txStatus` already said `found`). `status` is the chain's
   *  `1`-success / `0`-revert bit; `null` receipt = not yet mined; `"throw"` =
   *  the call failed. */
  receipt:
    | { kind: "receipt"; status: number; blockNumber: number | null }
    | { kind: "null" }
    | { kind: "throw" }
    | { kind: "skipped" };
}

/** The classifier's verdict for one tracked tx. */
export type PendingVerdict =
  | { kind: "confirmed"; blockNumber: number | null }
  | { kind: "failed"; blockNumber: number | null }
  | { kind: "pending" };

/** Deterministic terminal-state classification for one tracked tx.
 *
 *  Mirrors the browser tracked-tx core (`dropConfirmedPendingByHash`):
 *    1. `lyth_txStatus="found"` → confirmed (the indexer only surfaces
 *       included txs). Carries the inclusion block number when present.
 *    2. Otherwise consult the receipt: `status === 1` → confirmed,
 *       `status === 0` → failed (the genuine on-chain revert — THIS is the
 *       path the bounded fire-and-forget poll could never reach, because the
 *       old design only recorded "failed" on a synchronous submit throw, which
 *       produced no hash to key on).
 *    3. Anything else — `not_found`, a null/throwing receipt, an unparseable
 *       status bit — keeps the tx pending. We NEVER synthesize a verdict; the
 *       window-expiry backstop drops a tx that never resolves.
 *
 *  Pure: the RPC calls happen in `reconcile.ts`; this only maps their results. */
export function classifyPending(probe: ChainProbe): PendingVerdict {
  if (probe.txStatus.kind === "found") {
    return { kind: "confirmed", blockNumber: probe.txStatus.blockNumber };
  }
  const r = probe.receipt;
  if (r.kind === "receipt") {
    if (r.status === 1) return { kind: "confirmed", blockNumber: r.blockNumber };
    if (r.status === 0) return { kind: "failed", blockNumber: r.blockNumber };
  }
  return { kind: "pending" };
}

/** True if a tracked tx with this `(chainIdHex, txHash)` is already in `set`.
 *  Used by the enqueue path to stay idempotent — a re-submit of the same hash
 *  (or a drawer re-render) never double-tracks. */
export function pendingTxIndex(
  set: ReadonlyArray<PendingTx>,
  chainIdHex: string,
  txHash: string,
): number {
  return set.findIndex(
    (t) => t.chainIdHex === chainIdHex && t.txHash === txHash,
  );
}

/** Tolerant parse of one persisted tracked-tx row. Malformed → null (caller
 *  drops it and heals on the next write). */
export function asPendingTx(raw: unknown): PendingTx | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.txHash !== "string") return null;
  if (typeof r.chainIdHex !== "string") return null;
  if (typeof r.addressLower !== "string") return null;
  if (typeof r.opKind !== "string") return null;
  if (typeof r.amountDecimal !== "string") return null;
  if (typeof r.counterparty !== "string") return null;
  if (typeof r.submittedAt !== "number" || !Number.isFinite(r.submittedAt)) {
    return null;
  }
  return {
    txHash: r.txHash,
    chainIdHex: r.chainIdHex,
    addressLower: r.addressLower,
    opKind: r.opKind as TxOpKind,
    amountDecimal: r.amountDecimal,
    counterparty: r.counterparty,
    submittedAt: r.submittedAt,
  };
}

/** Per-store envelope — a plain array of tracked txs under one key. */
export interface PendingTxEnvelope {
  schemaVersion: 0;
  txs: PendingTx[];
}

/** Tolerant parse of the store envelope. Malformed → null (caller treats as
 *  empty). */
export function parsePendingTxEnvelope(raw: unknown): PendingTxEnvelope | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 0) return null;
  if (!Array.isArray(r.txs)) return null;
  const txs: PendingTx[] = [];
  for (const t of r.txs) {
    const parsed = asPendingTx(t);
    if (parsed !== null) txs.push(parsed);
  }
  return { schemaVersion: 0, txs };
}
