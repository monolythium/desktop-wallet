// Confirmed-row cache — pure model + helpers.
//
// The Activity feed reads confirmed rows live from the indexer each refresh; this
// cache persists them so the feed paints instantly on open (and survives an
// indexer blip), and — more importantly for later work — gives the feed a stable
// surface to thread wallet-captured display fields through across the
// pending→confirmed flip. The Tauri-store round-trip lives in
// `activity-cache-store.ts`; this module is deterministic + unit-testable.
//
// The cache stores a JSON-safe projection (`CachedConfirmedRow`): the indexer row
// carries `bigint` block height + timestamp, which the JSON store can't
// serialize, so they are held as `number` on disk and converted back on read.
// The rest of the app works with `LiveAddressActivityRow` throughout.

import type { LiveAddressActivityRow } from "./live";
import type { PendingTx } from "./pending-tx";

/** Rolling window of confirmed rows kept per (address, chain). Bounds storage;
 *  covers months of normal use. Older rows drop on merge. */
export const ACTIVITY_ROLLING_WINDOW = 100;

/** Per-(address, chain) cache key inside the store's `confirmed` map. */
export function activityCacheKey(addressLower: string, chainIdHex: string): string {
  return `mono.activity.${addressLower}.${chainIdHex}.v1`;
}

/** JSON-safe projection of one confirmed indexer row. `blockHeight` +
 *  `blockTimestampSeconds` are `number` here (the store is JSON-only and can't
 *  serialize `bigint`); every other field matches `LiveAddressActivityRow`. */
export interface CachedConfirmedRow {
  blockHeight: number;
  txIndex: number;
  logIndex: number;
  kind: string;
  direction: string | null;
  counterparty: string | null;
  tokenId: string | null;
  amount: string | null;
  cluster: number | null;
  weightBps: number | null;
  subKind: string | null;
  blockTimestampSeconds: number | null;
  txHash: string | null;
  clusterName: string | null;
}

/** Per-(address, chain) cache entry. */
export interface ConfirmedCacheEntry {
  schemaVersion: 0;
  confirmed: CachedConfirmedRow[];
  lastFetchedAtMs: number;
  /** Page-1 cursor for the NEXT (older) page. Additive: a legacy entry parses
   *  with it absent, which reads as "no more pages" until the next live read
   *  re-seeds it — degraded, never wrong. */
  nextCursor?: string | null;
}

/** Project a live indexer row onto the JSON-safe cache shape (`bigint`→`number`). */
export function toCachedRow(row: LiveAddressActivityRow): CachedConfirmedRow {
  return {
    blockHeight: Number(row.blockHeight),
    txIndex: row.txIndex,
    logIndex: row.logIndex,
    kind: row.kind,
    direction: row.direction,
    counterparty: row.counterparty,
    tokenId: row.tokenId,
    amount: row.amount,
    cluster: row.cluster,
    weightBps: row.weightBps,
    subKind: row.subKind,
    blockTimestampSeconds:
      row.blockTimestampSeconds === null ? null : Number(row.blockTimestampSeconds),
    txHash: row.txHash,
    clusterName: row.clusterName,
  };
}

/** Rehydrate a cached row back to the in-memory row shape (`number`→`bigint`). */
export function fromCachedRow(c: CachedConfirmedRow): LiveAddressActivityRow {
  return {
    blockHeight: BigInt(c.blockHeight),
    txIndex: c.txIndex,
    logIndex: c.logIndex,
    kind: c.kind,
    direction: c.direction,
    counterparty: c.counterparty,
    tokenId: c.tokenId,
    amount: c.amount,
    cluster: c.cluster,
    weightBps: c.weightBps,
    subKind: c.subKind,
    blockTimestampSeconds:
      c.blockTimestampSeconds === null ? null : BigInt(c.blockTimestampSeconds),
    txHash: c.txHash,
    clusterName: c.clusterName,
  };
}

/** Row identity for cache dedup. Beyond the (block, txIndex, logIndex) anchor it
 *  folds kind + cluster + direction so two genuinely-distinct rows that share an
 *  anchor (the indexer pins some native/delegation coordinates) are not collapsed
 *  into one. Pure. */
export function confirmedRowKey(row: LiveAddressActivityRow): string {
  return `${row.blockHeight}.${row.txIndex}.${row.logIndex}.${row.kind}.${row.cluster ?? ""}.${row.direction ?? ""}`;
}

/** Newest-first comparator: block desc, then txIndex desc, then logIndex desc.
 *  `blockHeight` is `bigint` so compare with `>` (no Number() coercion). */
export function compareConfirmedNewestFirst(
  a: LiveAddressActivityRow,
  b: LiveAddressActivityRow,
): number {
  if (a.blockHeight !== b.blockHeight) return a.blockHeight > b.blockHeight ? -1 : 1;
  if (a.txIndex !== b.txIndex) return b.txIndex - a.txIndex;
  return b.logIndex - a.logIndex;
}

/** Merge a fresh live read into the prior cached rows: union by
 *  {@link confirmedRowKey} (the live copy wins for an overlapping key), sort
 *  newest-first, and slice to the rolling window. Pure — the caller persists the
 *  result. Keeps rows older than the live window that the cache already holds. */
export function mergeConfirmedRows(
  prev: ReadonlyArray<LiveAddressActivityRow>,
  live: ReadonlyArray<LiveAddressActivityRow>,
  window: number = ACTIVITY_ROLLING_WINDOW,
): LiveAddressActivityRow[] {
  const byKey = new Map<string, LiveAddressActivityRow>();
  for (const r of prev) byKey.set(confirmedRowKey(r), r);
  for (const r of live) byKey.set(confirmedRowKey(r), r);
  const merged = Array.from(byKey.values()).sort(compareConfirmedNewestFirst);
  return merged.length > window ? merged.slice(0, window) : merged;
}

/** Keep a confirmed delegation row's cluster NAME stable across the
 *  pending→confirmed flip and across cache rebuilds. The indexer carries only
 *  the numeric cluster id and resolves the name best-effort (it can lag or
 *  transiently fail), so a row whose name is missing is filled from — in order —
 *  a prior cached row at the same inclusion slot + cluster, then a bridged
 *  pending row at the matching slot + cluster id that captured a name at submit.
 *  NEVER overwrites a name the row already has (no flicker to a stale value).
 *  Pure. */
export function applyCapturedClusterNames(
  confirmed: ReadonlyArray<LiveAddressActivityRow>,
  prevConfirmed: ReadonlyArray<LiveAddressActivityRow>,
  pending: ReadonlyArray<PendingTx>,
): LiveAddressActivityRow[] {
  const slotClusterKey = (block: number, txIndex: number, cluster: number): string =>
    `${block}.${txIndex}.${cluster}`;

  const prevNames = new Map<string, string>();
  for (const r of prevConfirmed) {
    if (r.cluster !== null && r.clusterName) {
      prevNames.set(slotClusterKey(Number(r.blockHeight), r.txIndex, r.cluster), r.clusterName);
    }
  }
  const pendingNames = new Map<string, string>();
  for (const t of pending) {
    if (
      t.clusterName &&
      t.clusterId !== undefined &&
      t.confirmedBlockHeight !== undefined &&
      t.confirmedTxIndex !== undefined
    ) {
      pendingNames.set(
        slotClusterKey(t.confirmedBlockHeight, t.confirmedTxIndex, t.clusterId),
        t.clusterName,
      );
    }
  }

  return confirmed.map((row) => {
    if (row.cluster === null || row.clusterName) return row; // not a cluster row, or already named
    const key = slotClusterKey(Number(row.blockHeight), row.txIndex, row.cluster);
    const name = prevNames.get(key) ?? pendingNames.get(key) ?? null;
    return name !== null ? { ...row, clusterName: name } : row;
  });
}

/** Tolerant parse of one cached row — required anchor fields gate it; every
 *  nullable field defaults to null. Returns null on a malformed row (caller
 *  drops it). */
export function validateCachedRow(raw: unknown): CachedConfirmedRow | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.blockHeight !== "number" || !Number.isFinite(r.blockHeight)) return null;
  if (typeof r.txIndex !== "number" || !Number.isFinite(r.txIndex)) return null;
  if (typeof r.logIndex !== "number" || !Number.isFinite(r.logIndex)) return null;
  if (typeof r.kind !== "string") return null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    blockHeight: r.blockHeight,
    txIndex: r.txIndex,
    logIndex: r.logIndex,
    kind: r.kind,
    direction: str(r.direction),
    counterparty: str(r.counterparty),
    tokenId: str(r.tokenId),
    amount: str(r.amount),
    cluster: num(r.cluster),
    weightBps: num(r.weightBps),
    subKind: str(r.subKind),
    blockTimestampSeconds: num(r.blockTimestampSeconds),
    txHash: str(r.txHash),
    clusterName: str(r.clusterName),
  };
}

/** Tolerant parse of a cache entry. Wrong schema / non-object → null (caller
 *  treats as empty + rebuilds from the live read). Malformed rows are dropped. */
export function parseConfirmedCacheEntry(raw: unknown): ConfirmedCacheEntry | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 0) return null;
  if (!Array.isArray(r.confirmed)) return null;
  const confirmed: CachedConfirmedRow[] = [];
  for (const c of r.confirmed) {
    const row = validateCachedRow(c);
    if (row !== null) confirmed.push(row);
  }
  const lastFetchedAtMs =
    typeof r.lastFetchedAtMs === "number" && Number.isFinite(r.lastFetchedAtMs)
      ? r.lastFetchedAtMs
      : 0;
  // Round-trip the cursor; a malformed value drops to absent rather than being
  // persisted as something the pager would later send to the node.
  const rawCursor = r.nextCursor;
  const nextCursor =
    typeof rawCursor === "string" && rawCursor.trim().startsWith("0x")
      ? rawCursor.trim()
      : rawCursor === null
        ? null
        : undefined;
  return {
    schemaVersion: 0,
    confirmed,
    lastFetchedAtMs,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}
