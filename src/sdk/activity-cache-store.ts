// Tauri-store-backed confirmed-row cache.
//
// A `@tauri-apps/plugin-store`-backed store (its own `activity.v1.json` file)
// holding a per-(address, chain) map of confirmed-row cache entries, reusing the
// singleton-store + in-memory-cache pattern of `notifications-store.ts`. It lets
// the Activity feed paint instantly on open from the last-known confirmed rows
// and survive an indexer blip, and gives later work a durable surface to thread
// wallet-captured display fields through.
//
// Brand-new store, additive: an absent/empty file simply falls through to the
// live fetch. Best-effort — every store failure is swallowed so a cache hiccup
// can never break the feed.

import { Store } from "@tauri-apps/plugin-store";
import type { LiveAddressActivityRow } from "./live";
import {
  ACTIVITY_ROLLING_WINDOW,
  fromCachedRow,
  parseConfirmedCacheEntry,
  toCachedRow,
  type ConfirmedCacheEntry,
} from "./activity-cache";

const STORE_FILE = "activity.v1.json";
const STATE_KEY = "state";

/** On-disk root. `confirmed` maps each `activityCacheKey` to its cache entry.
 *  (Later work adds sibling maps here; `version` gates the whole file.) */
interface ActivityCacheState {
  version: 1;
  confirmed: Record<string, unknown>;
}

let storePromise: Promise<Store> | null = null;
let cache: ActivityCacheState | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

function normalizeState(raw: unknown): ActivityCacheState {
  if (!raw || typeof raw !== "object") return { version: 1, confirmed: {} };
  const r = raw as Record<string, unknown>;
  const confirmed =
    r.confirmed && typeof r.confirmed === "object"
      ? (r.confirmed as Record<string, unknown>)
      : {};
  return { version: 1, confirmed };
}

async function loadState(): Promise<ActivityCacheState> {
  if (cache) return cache;
  try {
    const store = await getStore();
    const raw = await store.get<ActivityCacheState>(STATE_KEY);
    cache = normalizeState(raw);
  } catch {
    cache = { version: 1, confirmed: {} };
  }
  return cache;
}

async function saveState(state: ActivityCacheState): Promise<void> {
  cache = state;
  const store = await getStore();
  await store.set(STATE_KEY, state);
  await store.save();
}

/** Read the cached confirmed rows for a scope, rehydrated to the in-memory row
 *  shape. `null` when nothing is cached yet (caller falls through to the live
 *  fetch). Best-effort. */
export async function readConfirmedCache(
  scopeKey: string,
): Promise<{ rows: LiveAddressActivityRow[]; lastFetchedAtMs: number; nextCursor: string | null } | null> {
  try {
    const state = await loadState();
    const entry = parseConfirmedCacheEntry(state.confirmed[scopeKey]);
    if (entry === null) return null;
    return {
      rows: entry.confirmed.map(fromCachedRow),
      lastFetchedAtMs: entry.lastFetchedAtMs,
      // Absent on a legacy entry — reads as "no more pages" until a live read
      // re-seeds it.
      nextCursor: entry.nextCursor ?? null,
    };
  } catch {
    return null;
  }
}

/** Persist the merged confirmed rows for a scope (projected JSON-safe + capped
 *  to the rolling window). Best-effort — a write failure leaves the prior cache,
 *  which the next refresh corrects. */
export async function writeConfirmedCache(
  scopeKey: string,
  rows: ReadonlyArray<LiveAddressActivityRow>,
  nowMs: number,
  nextCursor: string | null = null,
): Promise<void> {
  try {
    const state = await loadState();
    const entry: ConfirmedCacheEntry = {
      schemaVersion: 0,
      confirmed: rows.slice(0, ACTIVITY_ROLLING_WINDOW).map(toCachedRow),
      lastFetchedAtMs: nowMs,
      nextCursor,
    };
    await saveState({
      version: 1,
      confirmed: { ...state.confirmed, [scopeKey]: entry },
    });
  } catch {
    // Best-effort — never throw back into the feed refresh.
  }
}

/** Delete every confirmed-row cache entry this address owns, so removing a vault
 *  leaves no orphaned scoped cache to accumulate. Matches by the exact prefix
 *  `mono.activity.<addressLower>.` (the trailing dot prevents one address from
 *  matching another that shares its prefix), so pruning one vault never touches
 *  another's data. Best-effort. */
export async function purgeScopesForAddress(addressLower: string): Promise<void> {
  try {
    const state = await loadState();
    const prefix = `mono.activity.${addressLower}.`;
    const confirmed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.confirmed)) {
      if (k.startsWith(prefix)) continue;
      confirmed[k] = v;
    }
    await saveState({ version: 1, confirmed });
  } catch {
    // Best-effort — a purge failure just leaves the (now-unreferenced) entries.
  }
}

/** Test-only — reset the singleton store + cache so each test starts clean. */
export function __resetActivityCacheStoreForTests(): void {
  storePromise = null;
  cache = null;
}
