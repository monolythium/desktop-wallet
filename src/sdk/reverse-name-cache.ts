// Persisted cache for quorum-confirmed reverse names.
//
// Two outcomes are first-class and both cacheable:
//   • a confirmed NAME  — the quorum agreed on one name;
//   • a confirmed MISS  — the quorum agreed there is no reverse name.
// Caching the miss is what stops a bare address from re-probing the fleet on
// every render.
//
// A disagreement, a thin quorum, or a transport failure is NEVER cached. Those
// are transient, and caching one would freeze a wrong absence for the whole TTL
// — the wallet would keep showing a bare address long after the fleet recovered.
//
// CHAIN-SCOPED. A name→address mapping is per-chain registry state, so an entry
// confirmed on the builtin chain must not annotate an address while a custom
// chain is active. The chain component comes from `scopeChainKey()` — the single
// source every per-scope store uses — never a hardcoded chain id.

import { Store } from "@tauri-apps/plugin-store";
import { scopeChainKey } from "./chains";

export const STORE_FILE = "names.v1.json";
const STATE_KEY = "state";
const BROWSER_KEY = "wallet.names.reverse.v1";

/** Both a confirmed hit and a confirmed miss expire after this. */
export const REVERSE_NAME_TTL_MS = 30 * 60 * 1000;

export interface ReverseNameEntry {
  /** The confirmed name, or null for a confirmed MISS. */
  name: string | null;
  /** Client-clock ms when the quorum confirmed it. */
  ts: number;
}

export interface ReverseNameCacheState {
  version: 1;
  reverse: Record<string, ReverseNameEntry>;
}

const EMPTY: ReverseNameCacheState = { version: 1, reverse: {} };

let storePromise: Promise<Store> | null = null;
let cache: ReverseNameCacheState | null = null;
const listeners = new Set<() => void>();

/** Exact per-(address, chain) key. */
export function reverseNameKey(addressLower: string, chainIdHex: string): string {
  return `mono.name.reverse.${addressLower}.${chainIdHex}.v1`;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

/** Parse one stored entry, or null when malformed. */
export function parseReverseNameEntry(raw: unknown): ReverseNameEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nameOk = r.name === null || (typeof r.name === "string" && r.name.trim() !== "");
  if (!nameOk) return null;
  if (typeof r.ts !== "number" || !Number.isFinite(r.ts)) return null;
  return { name: r.name === null ? null : (r.name as string).trim(), ts: r.ts };
}

function normalizeState(raw: unknown): ReverseNameCacheState {
  if (!raw || typeof raw !== "object") return { version: 1, reverse: {} };
  const r = raw as Record<string, unknown>;
  const src = r.reverse && typeof r.reverse === "object" ? (r.reverse as Record<string, unknown>) : {};
  const reverse: Record<string, ReverseNameEntry> = {};
  for (const [k, v] of Object.entries(src)) {
    const entry = parseReverseNameEntry(v);
    if (entry) reverse[k] = entry;
  }
  return { version: 1, reverse };
}

/**
 * Drop expired entries. The TTL boundary is INCLUSIVE — `age >= TTL` is expired.
 *
 * Returns the SAME object instance when nothing expired, so a caller can skip a
 * spurious storage write by identity comparison.
 */
export function evictExpiredReverseNames(
  state: ReverseNameCacheState,
  now: number,
): ReverseNameCacheState {
  const kept: Record<string, ReverseNameEntry> = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(state.reverse)) {
    if (now - v.ts >= REVERSE_NAME_TTL_MS) {
      dropped += 1;
      continue;
    }
    kept[k] = v;
  }
  return dropped === 0 ? state : { version: 1, reverse: kept };
}

async function loadState(): Promise<ReverseNameCacheState> {
  if (cache) return cache;
  if (!isTauri()) {
    cache = loadBrowserState();
    return cache;
  }
  try {
    const store = await getStore();
    cache = normalizeState(await store.get<unknown>(STATE_KEY));
  } catch {
    cache = { version: 1, reverse: {} };
  }
  return cache;
}

function loadBrowserState(): ReverseNameCacheState {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null"));
  } catch {
    return { ...EMPTY, reverse: {} };
  }
}

async function saveState(state: ReverseNameCacheState): Promise<void> {
  cache = state;
  try {
    if (!isTauri()) {
      localStorage.setItem(BROWSER_KEY, JSON.stringify(state));
    } else {
      const store = await getStore();
      await store.set(STATE_KEY, state);
      await store.save();
    }
  } catch {
    // Best-effort — the cache degrades to in-memory for the session; display
    // still works, it just re-probes more often.
  }
  notify();
}

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // A listener must never break a cache write.
    }
  }
}

/** Fires on every cache write; subscribers RE-READ only. A subscriber that
 *  re-triggered resolution would build an infinite, silent loop. */
export function subscribeReverseNames(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The in-memory snapshot, for cache-only reads. Never triggers a network. */
export function reverseNameCacheSnapshot(): ReverseNameCacheState {
  return cache ?? EMPTY;
}

/** Warm the in-memory snapshot from disk (once per session is enough). */
export async function primeReverseNameCache(): Promise<ReverseNameCacheState> {
  return loadState();
}

/** A fresh cached entry for this address on the ACTIVE chain, or null. */
export function readCachedReverseName(
  addressLower: string,
  now: number,
): ReverseNameEntry | null {
  const entry = reverseNameCacheSnapshot().reverse[reverseNameKey(addressLower, scopeChainKey())];
  if (!entry) return null;
  return now - entry.ts >= REVERSE_NAME_TTL_MS ? null : entry;
}

/** Persist a DEFINITIVE outcome (a name, or null for a confirmed miss). */
export async function writeReverseName(
  addressLower: string,
  name: string | null,
  now: number,
): Promise<void> {
  const state = await loadState();
  const evicted = evictExpiredReverseNames(state, now);
  await saveState({
    version: 1,
    reverse: {
      ...evicted.reverse,
      [reverseNameKey(addressLower, scopeChainKey())]: { name, ts: now },
    },
  });
}

/** Drop exactly this address's entry on the active chain — used after this
 *  wallet registers or accepts a name, so the new reverse-latest shows without
 *  waiting out the TTL. */
export async function invalidateReverseName(addressLower: string): Promise<void> {
  const state = await loadState();
  const key = reverseNameKey(addressLower, scopeChainKey());
  if (!state.reverse[key]) return;
  const next = { ...state.reverse };
  delete next[key];
  await saveState({ version: 1, reverse: next });
}

/** Drop every reverse-name entry owned by `addressLower`, ACROSS ALL CHAINS —
 *  called from the vault-removal cleanup so a removed vault leaves no resolved
 *  counterparty names behind. Exact-prefix with a TRAILING DOT, so one address
 *  never purges another that is a prefix of it (`mono1a` vs `mono1aa`).
 *  Best-effort. */
export async function purgeScopesForAddress(addressLower: string): Promise<void> {
  const scope = addressLower.toLowerCase();
  if (scope.length === 0) return;
  const prefix = `mono.name.reverse.${scope}.`;
  const state = await loadState();
  const next: Record<string, ReverseNameEntry> = {};
  let removed = 0;
  for (const [k, v] of Object.entries(state.reverse)) {
    if (k.startsWith(prefix)) {
      removed += 1;
      continue;
    }
    next[k] = v;
  }
  if (removed === 0) return;
  await saveState({ version: 1, reverse: next });
}

/** Clear everything (tests / dev). */
export async function clearReverseNameCacheStore(): Promise<void> {
  await saveState({ version: 1, reverse: {} });
}

/** Test seam — drops the in-memory snapshot so a suite can observe a cold read. */
export function __resetReverseNameCacheForTest(): void {
  cache = null;
  storePromise = null;
  listeners.clear();
}
