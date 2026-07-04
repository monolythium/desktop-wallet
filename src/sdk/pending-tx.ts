// Pure tracked-tx model — types, the store key, the dedupe id, the in-flight
// lifecycle classifier, and the per-tx terminal-state classifier.
//
// A "tracked tx" is one the wallet broadcast (the node accepted the tx and
// returned a canonical inner-tx hash) and now follows to a real
// terminal state. The durable store (`pending-tx-store.ts`) persists the set
// across drawer-close and app restart; the app-level poller (`reconcile.ts`)
// drives this classifier on an interval and records ONE notification per
// terminal transition.
//
// No `@tauri-apps/*`, no DOM, no RPC client, no module-scope state — every
// helper here is deterministic and unit-testable in vitest without shims. The
// chain calls live in `reconcile.ts` (which holds the RpcClient), so this
// module takes the two raw chain answers (`lyth_txStatus` + the receipt) as
// inputs and returns a verdict, keeping the decision logic pure.
//
// Invariants this module upholds:
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
  /** For delegation kinds: the target cluster, so a recorded notification can
   *  name the cluster instead of the bare delegation-module address. Optional —
   *  absent on non-delegation txs and on rows written before this field. */
  clusterId?: number;
  clusterName?: string;
  /** In-flight lifecycle, recomputed from `submittedAt` each reconcile tick and
   *  persisted so the feed re-renders the label as it changes. Optional +
   *  backward-compatible: rows written before this field read as `"pending"`. */
  lifecycle?: PendingLifecycle;
  /** Inclusion slot stamped from the confirming receipt BEFORE the indexer
   *  surfaces the canonical row, so the feed renders this row confirmed at chain
   *  speed; the feed retires it once the indexer row at this slot appears. Both
   *  optional/additive — absent on an un-bridged (still-pending) row. */
  confirmedBlockHeight?: number;
  confirmedTxIndex?: number;
  /** Broadcast nonce captured at submit — the account nonce this tx signed with.
   *  Lets the reconciler detect a dropped tx (a later nonce confirmed while this
   *  one is still pending). Optional + additive — rows written before this field,
   *  and ops that don't surface a nonce, read as undefined and fall back to the
   *  time-based lifecycle. */
  nonce?: number;
  /** Epoch ms the committed nonce was first observed to have passed this tx's
   *  nonce — anchors the drop grace window. Stamped by `transitionPending`. */
  noncePassedAtMs?: number;
  /** Epoch ms the tx was enqueued. The lifecycle age is measured from here. */
  submittedAt: number;
}

/** Single on-disk store key. One blob holds every tracked tx (tiny set — at
 *  most a handful of outstanding sends), mirroring the notifications store's
 *  single-file shape. */
export const PENDING_TX_STORE_KEY = "mono.pending-tx.v1";

/** Filter tracked txs to a single wallet scope. The durable store holds every
 *  vault's in-flight txs in one blob; a tracked tx belongs to the wallet that
 *  broadcast it (`addressLower`). The Activity feed must show only the ACTIVE
 *  wallet's pending rows — never another vault's — so it scopes through here
 *  before merging. `addressLower` is compared case-folded; an empty scope (no
 *  wallet ready) matches nothing. Pure. */
export function scopePendingTxs(
  txs: ReadonlyArray<PendingTx>,
  addressLower: string,
): PendingTx[] {
  const scope = addressLower.toLowerCase();
  if (scope.length === 0) return [];
  return txs.filter((t) => t.addressLower.toLowerCase() === scope);
}

/** In-flight lifecycle of a tracked tx that hasn't reached a terminal receipt.
 *  `dropped` is the nonce-aware terminal: a later nonce confirmed while this tx
 *  stayed pending. The others are time-based (`pending`/`slow`/`expired`). */
export type PendingLifecycle = "pending" | "slow" | "dropped" | "expired";

/** Runtime guard for a persisted lifecycle literal. */
export function isPendingLifecycle(v: unknown): v is PendingLifecycle {
  return v === "pending" || v === "slow" || v === "dropped" || v === "expired";
}

/** Age past which a still-unconfirmed tx reads as "taking longer than usual". */
export const PENDING_SLOW_MS = 3 * 60 * 1_000;
/** Age past which a still-unconfirmed tx reads as a VISIBLE "status unknown"
 *  terminal — never a silent drop. */
export const PENDING_ABSOLUTE_CAP_MS = 45 * 60 * 1_000;
/** Age past which a long-visible terminal (expired/dropped) row is finally
 *  removed. A tx is followed — and stays visible — for up to this long rather
 *  than vanishing after a few minutes. */
export const PENDING_TERMINAL_RETAIN_MS = 60 * 60 * 1_000;

/** Grace after the committed nonce first passes a tx's nonce before the tx is
 *  marked `dropped` — a momentary read race reads `slow`, not a false `dropped`. */
export const PENDING_DROP_GRACE_MS = 30 * 1_000;

/** In-flight lifecycle for a tracked tx. Pure — the caller passes the account's
 *  committed nonce (`null` when unread) and `now`.
 *
 *  Nonce-drop path (a real committed-nonce read only): when the account's
 *  committed nonce has passed this tx's nonce, the slot was filled by another tx
 *  and this one can never confirm — within the grace window it reads `slow`, past
 *  it `dropped`. A `null` read is inert: it never advances to `dropped` and never
 *  un-drops an already-`dropped` row; only a real read that does NOT show the
 *  nonce passed un-drops (falling through to the time-based path).
 *
 *  Time-based path (nonce unknown or not yet passed): `expired` only after the
 *  absolute cap, `slow` after the slow threshold, else `pending`. */
export function classifyStalePending(
  tx: Pick<PendingTx, "submittedAt" | "nonce" | "noncePassedAtMs" | "lifecycle">,
  committedNonce: number | null,
  now: number,
): PendingLifecycle {
  if (
    committedNonce !== null &&
    tx.nonce !== undefined &&
    committedNonce > tx.nonce
  ) {
    const passedAt = tx.noncePassedAtMs ?? now;
    return now - passedAt < PENDING_DROP_GRACE_MS ? "slow" : "dropped";
  }
  // A null read never un-drops a dropped row.
  if (committedNonce === null && tx.lifecycle === "dropped") return "dropped";
  const age = now - tx.submittedAt;
  if (age >= PENDING_ABSOLUTE_CAP_MS) return "expired";
  if (age >= PENDING_SLOW_MS) return "slow";
  return "pending";
}

/** Recompute every tracked tx's lifecycle and drop the rows that have been
 *  visible in a terminal state past the retention window. NEVER removes a
 *  `pending`/`slow` row, so a possibly-live tx never vanishes. Pure; returns the
 *  next array plus a `changed` flag so the caller persists only on a real diff. */
export function transitionPending(
  txs: ReadonlyArray<PendingTx>,
  committedNonces: ReadonlyMap<string, number | null>,
  now: number,
): { next: PendingTx[]; changed: boolean } {
  let changed = false;
  const next: PendingTx[] = [];
  for (const tx of txs) {
    // A bridged row (confirmed via receipt ahead of the indexer) renders
    // confirmed and is retired by the feed once the canonical row surfaces —
    // never relabel it or age it out here.
    if (tx.confirmedBlockHeight !== undefined) {
      next.push(tx);
      continue;
    }
    const committedNonce = committedNonces.get(tx.addressLower) ?? null;
    // Stamp the moment the committed nonce is first seen to have passed this tx's
    // nonce — anchors the drop grace so the transition isn't a momentary race.
    let cur = tx;
    if (
      committedNonce !== null &&
      tx.nonce !== undefined &&
      committedNonce > tx.nonce &&
      tx.noncePassedAtMs === undefined
    ) {
      cur = { ...tx, noncePassedAtMs: now };
      changed = true;
    }
    const lifecycle = classifyStalePending(cur, committedNonce, now);
    const isTerminalVisible = lifecycle === "expired" || lifecycle === "dropped";
    if (isTerminalVisible && now - cur.submittedAt >= PENDING_TERMINAL_RETAIN_MS) {
      changed = true; // bounded removal of a long-visible terminal row
      continue;
    }
    if (cur.lifecycle !== lifecycle) {
      changed = true;
      next.push({ ...cur, lifecycle });
    } else {
      next.push(cur);
    }
  }
  return { next, changed };
}

/** Secondary "eyebrow" note shown beside a pending row's action label. */
export function pendingLifecycleNote(lifecycle: PendingLifecycle): string {
  switch (lifecycle) {
    case "slow":
      return "taking longer than usual";
    case "dropped":
      return "didn't confirm";
    case "expired":
      return "status unknown";
    case "pending":
    default:
      return "in flight";
  }
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
    | { kind: "found"; blockNumber: number | null; txIndex: number | null }
    | { kind: "not_found" }
    | { kind: "throw" };
  /** `eth_getTransactionReceipt` outcome. Present only when consulted (we skip
   *  it once `lyth_txStatus` already said `found`). `status` is the chain's
   *  `1`-success / `0`-revert bit; `null` receipt = not yet mined; `"throw"` =
   *  the call failed. */
  receipt:
    | { kind: "receipt"; status: number; blockNumber: number | null; txIndex: number | null }
    | { kind: "null" }
    | { kind: "throw" }
    | { kind: "skipped" };
}

/** The classifier's verdict for one tracked tx. A `confirmed` verdict carries
 *  the inclusion slot (`blockNumber`, `txIndex`) used to bridge the row to a
 *  confirmed render; `failed` is not bridged so it needs no slot. */
export type PendingVerdict =
  | { kind: "confirmed"; blockNumber: number | null; txIndex: number | null }
  | { kind: "failed"; blockNumber: number | null }
  | { kind: "pending" };

/** Deterministic terminal-state classification for one tracked tx.
 *
 *  The terminal-state classification rules:
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
    return {
      kind: "confirmed",
      blockNumber: probe.txStatus.blockNumber,
      txIndex: probe.txStatus.txIndex,
    };
  }
  const r = probe.receipt;
  if (r.kind === "receipt") {
    if (r.status === 1) {
      return { kind: "confirmed", blockNumber: r.blockNumber, txIndex: r.txIndex };
    }
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
  const clusterId =
    typeof r.clusterId === "number" && Number.isFinite(r.clusterId)
      ? r.clusterId
      : undefined;
  const clusterName = typeof r.clusterName === "string" ? r.clusterName : undefined;
  const lifecycle = isPendingLifecycle(r.lifecycle) ? r.lifecycle : undefined;
  const confirmedBlockHeight =
    typeof r.confirmedBlockHeight === "number" && Number.isFinite(r.confirmedBlockHeight)
      ? r.confirmedBlockHeight
      : undefined;
  const confirmedTxIndex =
    typeof r.confirmedTxIndex === "number" && Number.isFinite(r.confirmedTxIndex)
      ? r.confirmedTxIndex
      : undefined;
  const nonce =
    typeof r.nonce === "number" && Number.isFinite(r.nonce) ? r.nonce : undefined;
  const noncePassedAtMs =
    typeof r.noncePassedAtMs === "number" && Number.isFinite(r.noncePassedAtMs)
      ? r.noncePassedAtMs
      : undefined;
  return {
    txHash: r.txHash,
    chainIdHex: r.chainIdHex,
    addressLower: r.addressLower,
    opKind: r.opKind as TxOpKind,
    amountDecimal: r.amountDecimal,
    counterparty: r.counterparty,
    clusterId,
    clusterName,
    lifecycle,
    confirmedBlockHeight,
    confirmedTxIndex,
    nonce,
    noncePassedAtMs,
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
