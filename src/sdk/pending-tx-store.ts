// Tauri-store-backed durable tracked-tx store.
//
// The tracked-tx set is persisted on top of `@tauri-apps/plugin-store` (its own
// `pending-tx.v1.json` file under `mono.activity.pending.*` keys), reusing the
// singleton-store + in-memory-cache pattern from `notifications-store.ts`, so a
// tx that confirms while every surface is closed still notifies.
//
// Why durable: the old desktop design polled `lyth_txStatus` inside the
// OperationsDrawer with a ~15s budget that died the moment the drawer closed,
// and only recorded "failed" on a synchronous submit throw (which carries no
// hash). Persisting the tracked set lets the app-level reconcile poller follow
// each tx to a REAL terminal state (confirmed OR failed) across drawer-close
// and app restart.
//
// Public surface:
//   - `enqueuePendingTx(tx)` — idempotent add (dedupe on `(chainIdHex,txHash)`).
//   - `listPendingTxs()` — the live tracked set.
//   - `removePendingTx(chainIdHex, txHash)` — drop one (terminal or expired).
//   - `hasPendingTxs()` — cheap "is the poller needed?" probe.
//   - `subscribePendingTxs(fn)` — fires on every successful mutation so the
//     poller can flip its enabled state without polling the store.
//   - `pendingTxsSnapshot()` + `hydratePendingTxs()` — the synchronous,
//     render-safe read + the on-mount disk hydration that back the Activity
//     "Pending" section's `useSyncExternalStore` binding (`use-pending-tx.ts`).
//
// Best-effort: every store failure is swallowed so a tracking-store hiccup can
// never throw back into the submit flow or the poller. The set is small (one
// row per outstanding broadcast), so reads/writes are cheap.

import { Store } from "@tauri-apps/plugin-store";
import {
  PENDING_TX_STORE_KEY,
  parsePendingTxEnvelope,
  pendingTxIndex,
  type PendingTx,
  type PendingTxEnvelope,
} from "./pending-tx";

const STORE_FILE = "pending-tx.v1.json";

let storePromise: Promise<Store> | null = null;
let cache: PendingTxEnvelope | null = null;
const subscribers = new Set<() => void>();

// Referentially-stable snapshot of the tracked set for `useSyncExternalStore`.
// React compares snapshots by identity, so this array reference must change
// ONLY when the contents change — every mutation path points it at the new
// `env.txs` array, and `pendingTxsSnapshot()` hands React the same reference
// between renders when nothing moved. Starts empty so the first paint matches
// a build with no in-flight txs (until `hydratePendingTxs()` warms it).
let snapshot: ReadonlyArray<PendingTx> = [];

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

/** Point the shared snapshot at the cache's current rows. The cache is the
 *  source of truth; the snapshot is the render-safe view of it. */
function syncSnapshot(): void {
  snapshot = cache ? cache.txs : [];
}

async function loadEnvelope(): Promise<PendingTxEnvelope> {
  if (cache) return cache;
  try {
    const store = await getStore();
    const raw = await store.get<PendingTxEnvelope>(PENDING_TX_STORE_KEY);
    cache = parsePendingTxEnvelope(raw) ?? { schemaVersion: 0, txs: [] };
  } catch {
    cache = { schemaVersion: 0, txs: [] };
  }
  syncSnapshot();
  return cache;
}

async function saveEnvelope(env: PendingTxEnvelope): Promise<void> {
  cache = env;
  syncSnapshot();
  const store = await getStore();
  await store.set(PENDING_TX_STORE_KEY, env);
  await store.save();
  notifySubscribers();
}

function notifySubscribers(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // A misbehaving subscriber must not break the write path.
    }
  }
}

/** Subscribe to tracked-set mutations. Returns an unsubscribe fn. */
export function subscribePendingTxs(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** Add a tracked tx. Idempotent on `(chainIdHex, txHash)`: a second enqueue of
 *  the same hash returns `{ added: false }` without re-writing (so a drawer
 *  re-render or a re-submit can't double-track). Best-effort. */
export async function enqueuePendingTx(
  tx: PendingTx,
): Promise<{ added: boolean }> {
  try {
    const env = await loadEnvelope();
    if (pendingTxIndex(env.txs, tx.chainIdHex, tx.txHash) !== -1) {
      return { added: false };
    }
    await saveEnvelope({ schemaVersion: 0, txs: [...env.txs, tx] });
    return { added: true };
  } catch {
    return { added: false };
  }
}

/** The live tracked set. Empty on any failure. */
export async function listPendingTxs(): Promise<PendingTx[]> {
  try {
    const env = await loadEnvelope();
    return env.txs;
  } catch {
    return [];
  }
}

/** Drop one tracked tx by its canonical key. Returns `{ removed }`. A no-op if
 *  the tx isn't tracked (already removed by a prior tick). Best-effort. */
export async function removePendingTx(
  chainIdHex: string,
  txHash: string,
): Promise<{ removed: boolean }> {
  try {
    const env = await loadEnvelope();
    const next = env.txs.filter(
      (t) => !(t.chainIdHex === chainIdHex && t.txHash === txHash),
    );
    if (next.length === env.txs.length) return { removed: false };
    await saveEnvelope({ schemaVersion: 0, txs: next });
    return { removed: true };
  } catch {
    return { removed: false };
  }
}

/** Cheap "is the poller needed?" probe — true iff ≥1 tracked tx. */
export async function hasPendingTxs(): Promise<boolean> {
  try {
    const env = await loadEnvelope();
    return env.txs.length > 0;
  } catch {
    return false;
  }
}

/** Synchronous, render-safe read of the cached tracked set (the order it was
 *  enqueued — oldest-first). Empty until {@link hydratePendingTxs} warms the
 *  cache and whenever nothing is in flight. The reference is stable between
 *  renders when the set is unchanged, so it is safe as a `useSyncExternalStore`
 *  getSnapshot. */
export function pendingTxsSnapshot(): ReadonlyArray<PendingTx> {
  return snapshot;
}

/** Load the persisted tracked set into the cache (call once on mount; every
 *  later mutation keeps the cache + snapshot in sync). Notifies subscribers
 *  only when hydration actually changed the set, so a warm cache re-mount is a
 *  no-op. Best-effort — an unreadable store degrades to an empty set. */
export async function hydratePendingTxs(): Promise<void> {
  const before = snapshot;
  await loadEnvelope();
  if (snapshot !== before) notifySubscribers();
}

/** Test-only — reset the singleton store + cache so each test starts clean.
 *  Not used by the app. */
export function __resetPendingTxStoreForTests(): void {
  storePromise = null;
  cache = null;
  snapshot = [];
  subscribers.clear();
}
