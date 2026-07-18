// Hook tiers over the reverse-name seam.
//
// Three tiers exist for one reason: a long list must never fan a full quorum
// per row. With a 4-endpoint fan-out, an unbounded list would turn one scroll
// into hundreds of POSTs against the fleet.
//
//   useReverseName            — single address; resolves on demand.
//   useReverseNamesCached     — batch, CACHE-ONLY; never triggers a resolve.
//   useReverseNamesEager      — batch; renders warm entries, then fires a
//                               BOUNDED set of resolves.
//
// All three are display-only: they never gate a send, never block a render, and
// never throw. A resolve failure is invisible beyond an un-annotated address.

import { useEffect, useState, useSyncExternalStore } from "react";
import { loadReverseName } from "./reverse-name";
import {
  primeReverseNameCache,
  readCachedReverseName,
  reverseNameCacheSnapshot,
  subscribeReverseNames,
  type ReverseNameCacheState,
} from "./reverse-name-cache";
import { reverseNameKey } from "./reverse-name-cache";
import { scopeChainKey } from "./chains";

/** Cap on eager resolves per address-set change — top rows win. */
export const EAGER_REVERSE_NAME_MAX = 30;

function subscribe(onChange: () => void): () => void {
  return subscribeReverseNames(onChange);
}

function snapshot(): ReverseNameCacheState {
  return reverseNameCacheSnapshot();
}

/**
 * Which addresses an eager batch should actually resolve.
 *
 * De-duplicates by lowercased address preserving input order (so the top rows
 * win the cap), skips anything with a fresh hit OR a fresh cached miss (a stale
 * or absent entry is eligible), and caps the result. Pure.
 */
export function selectReverseNamesToResolve(
  addresses: readonly string[],
  cacheState: ReverseNameCacheState,
  now: number,
  max: number = EAGER_REVERSE_NAME_MAX,
  chainIdHex: string = scopeChainKey(),
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of addresses) {
    if (out.length >= max) break;
    const key = raw.trim().toLowerCase();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const entry = cacheState.reverse[reverseNameKey(key, chainIdHex)];
    // A cached MISS counts as resolved — that is the point of caching it.
    if (entry && now - entry.ts < 30 * 60 * 1000) continue;
    out.push(key);
  }
  return out;
}

/** Single address, cache-first, resolving on demand. Returns null while
 *  unresolved or absent — the caller renders the bare address. */
export function useReverseName(address: string): string | null {
  const cacheState = useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = address.trim().toLowerCase();

  useEffect(() => {
    if (key === "") return;
    let cancelled = false;
    void primeReverseNameCache().then(() => {
      if (cancelled) return;
      if (readCachedReverseName(key, Date.now())) return; // already warm
      void loadReverseName(address.trim());
    });
    return () => {
      cancelled = true;
    };
  }, [key, address]);

  if (key === "") return null;
  const entry = cacheState.reverse[reverseNameKey(key, scopeChainKey())];
  if (!entry) return null;
  return Date.now() - entry.ts >= 30 * 60 * 1000 ? null : entry.name;
}

/** Batch, CACHE-ONLY. Never triggers resolution — for bulk rows where firing
 *  resolves would be unbounded. Absent key = never resolved. */
export function useReverseNamesCached(addresses: readonly string[]): Map<string, string | null> {
  const cacheState = useSyncExternalStore(subscribe, snapshot, snapshot);
  const chain = scopeChainKey();
  const now = Date.now();
  const out = new Map<string, string | null>();
  for (const raw of addresses) {
    const key = raw.trim().toLowerCase();
    if (key === "") continue;
    const entry = cacheState.reverse[reverseNameKey(key, chain)];
    if (entry && now - entry.ts < 30 * 60 * 1000) out.set(key, entry.name);
  }
  return out;
}

/**
 * Batch: warm entries render immediately, then a BOUNDED set of resolves fires.
 *
 * Resolution fires once per distinct address-set change. The cache-write
 * subscription only RE-READS — a subscriber that re-triggered resolution would
 * build an infinite, silent loop (it would look like network churn, not a
 * crash), so the resolve effect deliberately does not depend on the cache.
 */
export function useReverseNamesEager(
  addresses: readonly string[],
  max: number = EAGER_REVERSE_NAME_MAX,
): Map<string, string | null> {
  const cached = useReverseNamesCached(addresses);
  // A stable key for "the set changed", so the effect is not re-run per render.
  const setKey = addresses.map((a) => a.trim().toLowerCase()).join("|");
  const [, force] = useState(0);

  useEffect(() => {
    if (setKey === "") return;
    let cancelled = false;
    void primeReverseNameCache().then(() => {
      if (cancelled) return;
      const targets = selectReverseNamesToResolve(setKey.split("|"), snapshot(), Date.now(), max);
      if (targets.length === 0) return;
      void Promise.all(targets.map((a) => loadReverseName(a))).then(() => {
        if (!cancelled) force((n) => n + 1);
      });
    });
    return () => {
      cancelled = true;
    };
    // NOTE: intentionally NOT depending on the cache state — see the doc above.
  }, [setKey, max]);

  return cached;
}
