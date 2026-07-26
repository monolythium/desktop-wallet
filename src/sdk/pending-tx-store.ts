// Tauri-store-backed durable tracked-tx store.
//
// The tracked-tx set is persisted on top of `@tauri-apps/plugin-store` (its own
// `pending-tx.v1.json` file under a versioned key), reusing the
// singleton-store + in-memory-cache pattern from `notifications-store.ts`, so a
// tx that confirms while every surface is closed still notifies.
// The store root is bound to the live block-0 hash. Chain id alone cannot
// distinguish two incarnations of testnet-69420, and an old pending hash must
// never be reconciled against a post-regenesis network.
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
  transitionPending,
  type PendingTx,
  type PendingTxEnvelope,
} from "./pending-tx";
import { requireLiveGenesisIdentity } from "./chain-identity";

export const STORE_FILE = "pending-tx.v1.json";

let storePromise: Promise<Store> | null = null;
interface PendingTxStoreState {
  version: 2;
  genesisIdentity: string;
  envelope: PendingTxEnvelope;
}

let cache: PendingTxStoreState | null = null;
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
  snapshot = cache ? cache.envelope.txs : [];
}

async function loadEnvelope(): Promise<PendingTxEnvelope> {
  const genesisIdentity = await requireLiveGenesisIdentity();
  if (cache?.genesisIdentity === genesisIdentity) return cache.envelope;
  try {
    const store = await getStore();
    const raw = await store.get<unknown>(PENDING_TX_STORE_KEY);
    const root =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : null;
    const envelope =
      root?.version === 2 && root.genesisIdentity === genesisIdentity
        ? parsePendingTxEnvelope(root.envelope)
        : null;
    cache = {
      version: 2,
      genesisIdentity,
      envelope: envelope ?? { schemaVersion: 0, txs: [] },
    };
  } catch {
    cache = {
      version: 2,
      genesisIdentity,
      envelope: { schemaVersion: 0, txs: [] },
    };
  }
  syncSnapshot();
  return cache.envelope;
}

async function saveEnvelope(env: PendingTxEnvelope): Promise<void> {
  const genesisIdentity = await requireLiveGenesisIdentity();
  cache = { version: 2, genesisIdentity, envelope: env };
  syncSnapshot();
  const store = await getStore();
  await store.set(PENDING_TX_STORE_KEY, cache);
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

/** Stamp a tracked tx with the inclusion slot from its confirming receipt and
 *  keep it tracked (rendered confirmed at chain speed) until the indexer
 *  surfaces the canonical row and the feed retires it. Idempotent — re-stamping
 *  the same slot is a no-op. Best-effort. */
export async function bridgePendingTx(
  chainIdHex: string,
  txHash: string,
  confirmedBlockHeight: number,
  confirmedTxIndex: number,
): Promise<{ bridged: boolean }> {
  try {
    const env = await loadEnvelope();
    let changed = false;
    const next = env.txs.map((t) => {
      if (t.chainIdHex !== chainIdHex || t.txHash !== txHash) return t;
      if (
        t.confirmedBlockHeight === confirmedBlockHeight &&
        t.confirmedTxIndex === confirmedTxIndex
      ) {
        return t;
      }
      changed = true;
      return { ...t, confirmedBlockHeight, confirmedTxIndex };
    });
    if (changed) await saveEnvelope({ schemaVersion: 0, txs: next });
    return { bridged: changed };
  } catch {
    return { bridged: false };
  }
}

/** Mark a tracked tx as observed INCLUDED (`lyth_txStatus` `found`) while its
 *  outcome is still unestablished (the receipt was unreadable). Persisted so the
 *  time-ladder never ages a possibly-succeeded, included tx into a false
 *  "didn't confirm" (see `classifyStalePending`). Idempotent — already-flagged
 *  is a no-op. Best-effort. */
export async function markPendingIncluded(
  chainIdHex: string,
  txHash: string,
): Promise<{ marked: boolean }> {
  try {
    const env = await loadEnvelope();
    let changed = false;
    const next = env.txs.map((t) => {
      if (t.chainIdHex !== chainIdHex || t.txHash !== txHash) return t;
      if (t.seenIncluded === true) return t;
      changed = true;
      return { ...t, seenIncluded: true };
    });
    if (changed) await saveEnvelope({ schemaVersion: 0, txs: next });
    return { marked: changed };
  } catch {
    return { marked: false };
  }
}

/** Recompute each tracked tx's lifecycle and drop rows past the terminal-
 *  retention window, persisting ONLY when something changed (so a no-op tick is
 *  free and doesn't churn subscribers). Returns the count silently removed.
 *  Best-effort. */
export async function applyPendingTransition(
  now: number,
  committedNonces: ReadonlyMap<string, number | null> = new Map(),
  scopeChainIdHex?: string,
): Promise<{ removed: number }> {
  try {
    const env = await loadEnvelope();
    const before = env.txs.length;
    const { next, changed } = transitionPending(
      env.txs,
      committedNonces,
      now,
      scopeChainIdHex,
    );
    if (changed) await saveEnvelope({ schemaVersion: 0, txs: next });
    return { removed: before - next.length };
  } catch {
    return { removed: 0 };
  }
}

/** Drop every tracked tx owned by `addressLower`, ACROSS ALL CHAINS — called
 *  from the vault-removal cleanup so a removed vault leaves no in-flight tx
 *  history behind (the same data-hygiene contract the other scoped stores keep).
 *  Address compared case-folded; a no-op when nothing matches. Best-effort. */
export async function purgeScopesForAddress(addressLower: string): Promise<void> {
  const scope = addressLower.toLowerCase();
  if (scope.length === 0) return;
  try {
    const env = await loadEnvelope();
    const next = env.txs.filter((t) => t.addressLower.toLowerCase() !== scope);
    if (next.length === env.txs.length) return;
    await saveEnvelope({ schemaVersion: 0, txs: next });
  } catch {
    // Best-effort — a failed purge never blocks vault removal.
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
  try {
    await loadEnvelope();
  } catch {
    // Live identity is unavailable (or the store failed before it could be
    // normalized). Fail closed: an earlier-genesis snapshot must not remain
    // visible merely because the current chain cannot be identified.
    cache = null;
    snapshot = [];
  }
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
