// Durable warm-start cache for the chain-health machine.
//
// A `@tauri-apps/plugin-store`-backed store (its own `chain-health.v1.json`
// file) holding a per-(address, chain) map of the last-seen head, reusing the
// singleton-store + in-memory-cache pattern of `activity-cache-store.ts`. On
// reopen the machine restores the cached head to show RECONNECTING (never LIVE —
// a cached head proves we once saw the chain, not that we are connected now) and
// to feed the stall math (the status specification §I), so an already-stalled
// chain verdicts STALLED immediately instead of restarting its window.
//
// Scoped per (address, chain): each head lives under an exact
// `mono.chain-health.head.<addressLower>.<chainIdHex>.v1` key and is read by
// exact key, so one vault/chain's cached head can never surface under another.
//
// Additive + best-effort: an absent/malformed file simply yields `null` (→ a
// cold CONNECTING), and every store failure is swallowed so a cache hiccup can
// never break the heartbeat.

import { Store } from "@tauri-apps/plugin-store";

export const STORE_FILE = "chain-health.v1.json";
const STATE_KEY = "state";

/** The persisted last-seen head for one (address, chain) scope. */
export interface WarmStartHead {
  /** Last-seen head height. */
  height: number;
  /** Last-seen head identity (block hash, or the height as a string). */
  headId: string;
  /** Client-clock time (ms) when the head last advanced — feeds the stall math
   *  so a persisted stall is surfaced immediately on reopen (§I). */
  advancedAtMs: number;
}

/** On-disk root. `heads` maps each scope key to its last-seen head. `version`
 *  gates the whole file. */
interface ChainHealthStoreState {
  version: 1;
  heads: Record<string, unknown>;
}

let storePromise: Promise<Store> | null = null;
let cache: ChainHealthStoreState | null = null;

function headKey(addressLower: string, chainIdHex: string): string {
  return `mono.chain-health.head.${addressLower}.${chainIdHex}.v1`;
}

async function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

function normalizeState(raw: unknown): ChainHealthStoreState {
  if (!raw || typeof raw !== "object") return { version: 1, heads: {} };
  const r = raw as Record<string, unknown>;
  const heads = r.heads && typeof r.heads === "object" ? (r.heads as Record<string, unknown>) : {};
  return { version: 1, heads };
}

/** Parse a stored head, rejecting anything malformed (→ `null`, a cold start). */
export function parseWarmStartHead(raw: unknown): WarmStartHead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.height !== "number" ||
    !Number.isFinite(r.height) ||
    typeof r.headId !== "string" ||
    r.headId.length === 0 ||
    typeof r.advancedAtMs !== "number" ||
    !Number.isFinite(r.advancedAtMs)
  ) {
    return null;
  }
  return { height: r.height, headId: r.headId, advancedAtMs: r.advancedAtMs };
}

async function loadState(): Promise<ChainHealthStoreState> {
  if (cache) return cache;
  try {
    const store = await getStore();
    cache = normalizeState(await store.get<ChainHealthStoreState>(STATE_KEY));
  } catch {
    cache = { version: 1, heads: {} };
  }
  return cache;
}

/** Read the cached last-seen head for a scope, or `null` (cold start). Exact-key
 *  lookup — never returns another scope's head. Best-effort. */
export async function loadWarmStartHead(
  addressLower: string,
  chainIdHex: string,
): Promise<WarmStartHead | null> {
  try {
    const state = await loadState();
    return parseWarmStartHead(state.heads[headKey(addressLower, chainIdHex)]);
  } catch {
    return null;
  }
}

/** Persist the last-seen head for a scope. Best-effort — a write failure leaves
 *  the prior cache, which the next advance corrects. */
export async function saveWarmStartHead(
  addressLower: string,
  chainIdHex: string,
  head: WarmStartHead,
): Promise<void> {
  try {
    const state = await loadState();
    await saveState({
      version: 1,
      heads: { ...state.heads, [headKey(addressLower, chainIdHex)]: head },
    });
  } catch {
    // Best-effort — never throw back into the heartbeat.
  }
}

async function saveState(state: ChainHealthStoreState): Promise<void> {
  cache = state;
  const store = await getStore();
  await store.set(STATE_KEY, state);
  await store.save();
}

/** Delete every warm-start head this address owns, so removing a vault leaves no
 *  orphaned scoped head to accumulate. Matches by the exact prefix
 *  `mono.chain-health.head.<addressLower>.` (the trailing dot prevents one
 *  address from matching another that shares its prefix), so pruning one vault
 *  never touches another's data. Best-effort. */
export async function purgeScopesForAddress(addressLower: string): Promise<void> {
  try {
    const state = await loadState();
    const prefix = `mono.chain-health.head.${addressLower}.`;
    const heads: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.heads)) {
      if (k.startsWith(prefix)) continue;
      heads[k] = v;
    }
    await saveState({ version: 1, heads });
  } catch {
    // Best-effort — a purge failure just leaves the (now-unreferenced) heads.
  }
}

/** Test-only — reset the singleton store + cache so each test starts clean. */
export function __resetChainHealthStoreForTests(): void {
  storePromise = null;
  cache = null;
}
