// Durable last-known native balance, so a relaunch shows the previously
// confirmed figure immediately instead of a skeleton for the whole read
// round-trip.
//
// This is the wallet's most honesty-sensitive cache: it displays a NUMBER the
// user will read as their balance. The rules that make it defensible:
//
//   • Written from exactly ONE place — the confirmed-live success branch of the
//     Home refresh. Never synthesised, never written from a seed (no seed→seed
//     propagation), never zeroed on failure. A failed refresh leaves the prior
//     record untouched.
//   • Always LABELLED when shown (the ladder marks it stale), and never shown at
//     all while the chain isn't live — the display ladder's hidden branch wins.
//   • A malformed or scope-mismatched record yields null → a skeleton, never a
//     fabricated figure.
//
// Scoped per (address, chain) via `scopeChainKey()` — the single source for the
// chain component of every per-(address, chain) store. Using a fixed builtin
// chain-id constant here would be a FUND-VISIBLE bug rather than a cosmetic one:
// with a custom chain active, both the write and the read would use the same
// wrong constant, so the record's own `chainIdHex` check would pass against
// itself and the wallet would seed the hero with the BUILTIN chain's balance —
// presenting one network's figure as the user's balance on another.

import { Store } from "@tauri-apps/plugin-store";
import { scopeChainKey } from "./chains";

const STORE_FILE = "balance.v1.json";
const STATE_KEY = "state";

/** The persisted last-known balance for one (address, chain) scope. */
export interface LastKnownBalance {
  /** Exact decimal lythoshi integer string — the wallet's native balance shape
   *  end to end, so no conversion layer sits between store and display. */
  balanceLythoshi: string;
  /** The scope owner (lowercased). Defence in depth against a key collision. */
  address: string;
  /** The scope's chain key, from `scopeChainKey()` at write time. */
  chainIdHex: string;
  /** Informational. No TTL today — the record is always labelled when shown. */
  savedAtMs: number;
}

interface BalanceStoreState {
  version: 1;
  balances: Record<string, unknown>;
}

let storePromise: Promise<Store> | null = null;
let cache: BalanceStoreState | null = null;

export function balanceScopeKey(addressLower: string, chainIdHex: string): string {
  return `mono.balance.${addressLower}.${chainIdHex}.v1`;
}

async function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

function normalizeState(raw: unknown): BalanceStoreState {
  if (!raw || typeof raw !== "object") return { version: 1, balances: {} };
  const r = raw as Record<string, unknown>;
  const balances =
    r.balances && typeof r.balances === "object" ? (r.balances as Record<string, unknown>) : {};
  return { version: 1, balances };
}

async function loadState(): Promise<BalanceStoreState> {
  if (cache) return cache;
  try {
    const store = await getStore();
    cache = normalizeState(await store.get<BalanceStoreState>(STATE_KEY));
  } catch {
    cache = { version: 1, balances: {} };
  }
  return cache;
}

async function saveState(state: BalanceStoreState): Promise<void> {
  const store = await getStore();
  await store.set(STATE_KEY, state);
  await store.save();
  // Cache only after a successful write, so a failed save cannot leave the
  // in-memory view claiming something the disk does not hold.
  cache = state;
}

/**
 * Pure, tolerant parse of a stored record into a usable seed.
 *
 * Rejects — yielding null, so the caller renders a skeleton rather than a
 * number — anything malformed (a non-integer-string balance, wrong field types,
 * a non-finite timestamp) and any record whose own scope fields disagree with
 * the scope being read. The scope check is only meaningful because reads and
 * writes both derive their chain component from `scopeChainKey()`.
 */
export function selectSeedBalance(
  raw: unknown,
  addressLower: string,
  chainIdHex: string,
): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.balanceLythoshi !== "string" || !/^[0-9]+$/.test(r.balanceLythoshi)) return null;
  if (typeof r.address !== "string" || r.address !== addressLower) return null;
  if (typeof r.chainIdHex !== "string" || r.chainIdHex !== chainIdHex) return null;
  if (typeof r.savedAtMs !== "number" || !Number.isFinite(r.savedAtMs)) return null;
  return r.balanceLythoshi;
}

/** Read the last-known balance for this address on the ACTIVE chain, or null.
 *  Exact-key lookup — never returns another scope's figure. Best-effort. */
export async function loadLastKnownBalance(addressLower: string): Promise<string | null> {
  try {
    const chainIdHex = scopeChainKey();
    const state = await loadState();
    return selectSeedBalance(
      state.balances[balanceScopeKey(addressLower, chainIdHex)],
      addressLower,
      chainIdHex,
    );
  } catch {
    return null;
  }
}

/**
 * Persist a CONFIRMED-LIVE balance. The single write path.
 *
 * Rejects anything that is not an exact decimal integer string, so a hex
 * quantity or a formatted decimal can never enter the store and later be read
 * back as a figure. Best-effort: a write failure leaves the prior record, which
 * the next confirmed read corrects.
 */
export async function saveLastKnownBalance(
  addressLower: string,
  balanceLythoshi: string,
  nowMs: number,
): Promise<void> {
  if (!/^[0-9]+$/.test(balanceLythoshi)) return;
  try {
    const chainIdHex = scopeChainKey();
    const state = await loadState();
    const record: LastKnownBalance = {
      balanceLythoshi,
      address: addressLower,
      chainIdHex,
      savedAtMs: nowMs,
    };
    await saveState({
      version: 1,
      balances: {
        ...state.balances,
        [balanceScopeKey(addressLower, chainIdHex)]: record,
      },
    });
  } catch {
    // Best-effort — never throw back into a refresh cycle.
  }
}

/** Delete every last-known balance this address owns, across all chains, so
 *  removing a vault leaves no orphaned scoped record. The trailing dot in the
 *  prefix prevents one address from matching another that shares its prefix
 *  (`mono1a` must never purge `mono1aa`). Best-effort. */
export async function purgeScopesForAddress(addressLower: string): Promise<void> {
  try {
    const state = await loadState();
    const prefix = `mono.balance.${addressLower}.`;
    const balances: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.balances)) {
      if (k.startsWith(prefix)) continue;
      balances[k] = v;
    }
    await saveState({ version: 1, balances });
  } catch {
    // Best-effort.
  }
}

/** Test seam — drops the in-memory cache so a suite can observe a cold read. */
export function __resetLastKnownBalanceCacheForTest(): void {
  cache = null;
  storePromise = null;
}
