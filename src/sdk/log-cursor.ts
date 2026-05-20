// Incremental log-scan cursor — persisted scan state shared by the
// activity feed and token-discovery flows.
//
// The naive Phase 4 scanners (Commits 5 + 13) re-fetch the full
// `latest - 100_000` window on every mount. That's both wasteful
// (long fetches even when the user just opened the wallet a second
// time) and incomplete (the window doesn't cover a wallet that's
// been quiet for ≥100k blocks).
//
// Strategy: persist a per-(scope, holder) cursor — the highest block
// number scanned + a timestamp + an optional cached payload. On next
// mount, scan from `cursor + 1` to `latest`, merge with cached
// payload, cache the union. Invalidate the cache after 7 days or
// manual force-rescan.
//
// Storage: localStorage, same convention as Phases 3 + 4 contacts +
// token-list. Schema-versioned key.

const STORAGE_KEY_PREFIX = "mono.logcursor.v1.";
const CACHE_INVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;

export type desktop MCP clientScope = "activity" | "discovery";

export interface desktop MCP clientEntry<T> {
  /** Highest scanned block (inclusive). */
  lastBlock: bigint;
  /** ms-since-epoch when last successful scan completed. */
  scannedAtMs: number;
  /** Cached payload — caller-defined shape. */
  payload: T;
}

interface Serializeddesktop MCP clientEntry<T> {
  lastBlock: string; // bigint serialized via toString
  scannedAtMs: number;
  payload: T;
}

function cursorKey(scope: desktop MCP clientScope, holder: string): string {
  return `${STORAGE_KEY_PREFIX}${scope}.${holder.toLowerCase()}`;
}

/** Read the persisted cursor entry for `(scope, holder)`. Returns null
 *  when no entry exists, the entry is malformed, or it's past the
 *  7-day invalidation window. */
export function readdesktop MCP client<T>(
  scope: desktop MCP clientScope,
  holder: string,
): desktop MCP clientEntry<T> | null {
  try {
    const raw = localStorage.getItem(cursorKey(scope, holder));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Serializeddesktop MCP clientEntry<T>;
    if (
      typeof parsed.lastBlock !== "string" ||
      typeof parsed.scannedAtMs !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.scannedAtMs >= CACHE_INVALIDATE_MS) {
      return null;
    }
    return {
      lastBlock: BigInt(parsed.lastBlock),
      scannedAtMs: parsed.scannedAtMs,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

/** Write a fresh cursor entry. */
export function writedesktop MCP client<T>(
  scope: desktop MCP clientScope,
  holder: string,
  entry: desktop MCP clientEntry<T>,
): void {
  try {
    const serialized: Serializeddesktop MCP clientEntry<T> = {
      lastBlock: entry.lastBlock.toString(),
      scannedAtMs: entry.scannedAtMs,
      payload: entry.payload,
    };
    localStorage.setItem(cursorKey(scope, holder), JSON.stringify(serialized));
  } catch {
    // Quota / unavailable — fail soft.
  }
}

/** Remove a cursor (used by manual "Refresh" / force-rescan). */
export function cleardesktop MCP client(scope: desktop MCP clientScope, holder: string): void {
  try {
    localStorage.removeItem(cursorKey(scope, holder));
  } catch {
    // ignore
  }
}

/** Test-only. Clears every cursor in localStorage. */
export function _resetAlldesktop MCP clientsForTest(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/**
 * Compute the scan window for an incremental scan. Returns
 * `{ fromBlock, isIncremental }`:
 *
 *   - If a fresh cursor exists, scan from `cursor + 1` to latest
 *     (`isIncremental: true`) — caller merges results with the
 *     cached payload.
 *   - If no cursor exists or the cursor is invalid, scan the full
 *     default window (`latest - defaultLookback`) → `isIncremental: false`.
 *
 * This module doesn't fetch — it only computes window math + cursor
 * I/O so the existing scanners (discover, token-activity) can adopt
 * the cursor pattern without changing their RPC layer.
 */
export function computeScanWindow(args: {
  scope: desktop MCP clientScope;
  holder: string;
  latestBlock: bigint;
  defaultLookback: bigint;
}): { fromBlock: bigint; isIncremental: boolean } {
  const cursor = readdesktop MCP client<unknown>(args.scope, args.holder);
  if (cursor && cursor.lastBlock < args.latestBlock) {
    return { fromBlock: cursor.lastBlock + 1n, isIncremental: true };
  }
  const lookback = args.defaultLookback;
  const from = args.latestBlock > lookback ? args.latestBlock - lookback : 0n;
  return { fromBlock: from, isIncremental: false };
}
