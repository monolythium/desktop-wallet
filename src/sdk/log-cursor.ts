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
// Phase 5 #D17 closure — IndexedDB is now the persistence backend
// instead of localStorage. IDB supports native bigint via the
// structured-clone algorithm, so the previous "serialize bigints as
// decimal strings" workaround drops.
//
// The public API stays SYNC (readdesktop MCP client / writedesktop MCP client / cleardesktop MCP client).
// IDB itself is async, so we maintain an in-memory cache that:
//   - hydrates on module load (one-shot async read of every cursor
//     key)
//   - serves sync reads from the in-memory mirror
//   - writes fire-and-forget into IDB (and update the mirror sync)
//
// Migration: on hydrate we also read every legacy `mono.logcursor.v1.*`
// localStorage key. If found we transfer the deserialized data into
// the in-memory mirror + IDB and remove the localStorage entry.

const STORAGE_KEY_PREFIX = "mono.logcursor.v1.";
const CACHE_INVALIDATE_MS = 7 * 24 * 60 * 60 * 1000;
const IDB_DB_NAME = "mono-wallet.v1";
const IDB_STORE_NAME = "logcursor";
const IDB_VERSION = 1;

export type desktop MCP clientScope = "activity" | "discovery";

export interface desktop MCP clientEntry<T> {
  /** Highest scanned block (inclusive). */
  lastBlock: bigint;
  /** ms-since-epoch when last successful scan completed. */
  scannedAtMs: number;
  /** Cached payload — caller-defined shape. */
  payload: T;
}

function cursorKey(scope: desktop MCP clientScope, holder: string): string {
  return `${STORAGE_KEY_PREFIX}${scope}.${holder.toLowerCase()}`;
}

// ─── In-memory mirror ──────────────────────────────────────────────

const memMirror = new Map<string, desktop MCP clientEntry<unknown>>();

/** Test-only — clear the in-memory mirror. */
function clearMirror(): void {
  memMirror.clear();
}

// ─── IndexedDB layer ───────────────────────────────────────────────

/** Open / upgrade the IDB. Returns the database connection. Throws
 *  if IDB isn't available (the public API catches + falls back to the
 *  in-memory-only mode). */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("idb open failed"));
  });
}

async function idbReadAll(): Promise<Map<string, desktop MCP clientEntry<unknown>>> {
  const out = new Map<string, desktop MCP clientEntry<unknown>>();
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return out;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE_NAME, "readonly");
    const store = tx.objectStore(IDB_STORE_NAME);
    const req = store.opendesktop MCP client();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const key = String(cursor.key);
        const value = cursor.value as desktop MCP clientEntry<unknown>;
        out.set(key, value);
        cursor.continue();
      } else {
        db.close();
        resolve(out);
      }
    };
    req.onerror = () => {
      db.close();
      resolve(out);
    };
  });
}

function idbWrite(key: string, entry: desktop MCP clientEntry<unknown>): void {
  // Fire-and-forget. The in-memory mirror is the authoritative read
  // source; IDB is the durable backing store.
  void (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).put(entry, key);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      // ignore
    }
  })();
}

function idbDelete(key: string): void {
  void (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).delete(key);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      // ignore
    }
  })();
}

function idbClearAll(): void {
  void (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).clear();
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      // ignore
    }
  })();
}

// ─── Hydration + legacy localStorage migration ─────────────────────

let hydratePromise: Promise<void> | null = null;

/** Idempotent hydrate. Reads IDB into the in-memory mirror, then
 *  migrates any legacy `mono.logcursor.v1.*` localStorage entries into
 *  IDB + the mirror, removing the legacy keys on success. */
export function hydrateLogdesktop MCP clientStore(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    // 1. Read everything currently in IDB.
    const fromIdb = await idbReadAll();
    for (const [k, v] of fromIdb.entries()) {
      memMirror.set(k, v);
    }
    // 2. Migrate legacy localStorage entries.
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
      }
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as {
            lastBlock?: unknown;
            scannedAtMs?: unknown;
            payload?: unknown;
          };
          if (
            typeof parsed.lastBlock !== "string" ||
            typeof parsed.scannedAtMs !== "number"
          ) {
            localStorage.removeItem(k);
            continue;
          }
          const entry: desktop MCP clientEntry<unknown> = {
            lastBlock: BigInt(parsed.lastBlock),
            scannedAtMs: parsed.scannedAtMs,
            payload: parsed.payload,
          };
          memMirror.set(k, entry);
          idbWrite(k, entry);
        } catch {
          // unparseable legacy entry — drop
        }
        localStorage.removeItem(k);
      }
    } catch {
      // localStorage unavailable — skip migration
    }
  })();
  return hydratePromise;
}

// Kick off hydration eagerly on module load.
void hydrateLogdesktop MCP clientStore();

// ─── Public API (sync) ─────────────────────────────────────────────

/** Read the persisted cursor entry for `(scope, holder)`. Returns null
 *  when no entry exists OR it's past the 7-day invalidation window. */
export function readdesktop MCP client<T>(
  scope: desktop MCP clientScope,
  holder: string,
): desktop MCP clientEntry<T> | null {
  const key = cursorKey(scope, holder);
  const entry = memMirror.get(key);
  if (!entry) return null;
  if (Date.now() - entry.scannedAtMs >= CACHE_INVALIDATE_MS) {
    memMirror.delete(key);
    idbDelete(key);
    return null;
  }
  return entry as desktop MCP clientEntry<T>;
}

/** Write a fresh cursor entry. Sync write to the in-memory mirror;
 *  async fire-and-forget into IDB. */
export function writedesktop MCP client<T>(
  scope: desktop MCP clientScope,
  holder: string,
  entry: desktop MCP clientEntry<T>,
): void {
  const key = cursorKey(scope, holder);
  memMirror.set(key, entry as desktop MCP clientEntry<unknown>);
  idbWrite(key, entry as desktop MCP clientEntry<unknown>);
}

/** Remove a cursor (used by manual "Refresh" / force-rescan). */
export function cleardesktop MCP client(scope: desktop MCP clientScope, holder: string): void {
  const key = cursorKey(scope, holder);
  memMirror.delete(key);
  idbDelete(key);
}

/** Test-only. Clears every cursor across all storage layers + the
 *  in-memory mirror. Also pre-arms hydratePromise so the next
 *  hydrate() call short-circuits. */
export function _resetAlldesktop MCP clientsForTest(): void {
  clearMirror();
  idbClearAll();
  // Mark hydrate as done so subsequent test setups don't re-import
  // legacy entries from a previous test's localStorage.
  hydratePromise = Promise.resolve();
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
