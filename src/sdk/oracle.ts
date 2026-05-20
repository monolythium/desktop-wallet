// USD price oracle stub — closes Phase 4 #D13 with a clean chain-gap
// posture.
//
// The intended chain RPC is `lyth_getTokenPrice(contract)` returning
// `{ priceUsd: number }`. The chain doesn't yet ship this surface (no
// on-chain oracle precompile in v2). This module:
//
//   1. Attempts the call.
//   2. On method-not-found (JSON-RPC -32601) returns `null` with
//      `source: "[chain-gap]"`.
//   3. On any other failure (transport, malformed response) returns
//      `null` with `source: "[chain-gap]"` too — the UI treats both
//      the same: render an em-dash and show the chain-gap tooltip.
//
// The seam is wired NOW so the moment the chain ships the RPC, the
// [chain-gap] tag drops everywhere.
//
// In-memory LRU cache to avoid hammering the RPC for the same token
// on every render. 5-minute TTL — long enough for the UI, short
// enough to refresh on a manual reload.

import { SdkError } from "@monolythium/core-sdk";
import { getProvider } from "./client";

const JSONRPC_METHOD_NOT_FOUND = -32601;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_CAPACITY = 100;

export interface TokenPriceResult {
  /** USD price as a JS number, or null when unavailable. */
  priceUsd: number | null;
  /** "chain" when the RPC returned a real value; "[chain-gap]"
   *  otherwise. UI uses this to render the explanatory tooltip. */
  source: "chain" | "[chain-gap]";
}

interface CacheEntry {
  result: TokenPriceResult;
  cachedAtMs: number;
}

const cache = new Map<string, CacheEntry>();

/** Test-only — clear the in-memory cache. */
export function _resetOraclePriceCacheForTest(): void {
  cache.clear();
}

function cacheGet(key: string): TokenPriceResult | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.cachedAtMs >= CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU bump.
  cache.delete(key);
  cache.set(key, e);
  return e.result;
}

function cacheSet(key: string, result: TokenPriceResult): void {
  cache.set(key, { result, cachedAtMs: Date.now() });
  while (cache.size > CACHE_CAPACITY) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

/**
 * Fetch the USD price for `contract`. Returns
 *   { priceUsd: number, source: "chain" }            on a real hit
 *   { priceUsd: null, source: "[chain-gap]" }        on miss / no oracle yet
 */
export async function getTokenUsdPrice(contract: string): Promise<TokenPriceResult> {
  const key = contract.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;
  const provider = getProvider();
  try {
    const raw = await provider.rpcClient.call<unknown>("lyth_getTokenPrice", [key]);
    if (raw && typeof raw === "object" && "priceUsd" in raw) {
      const v = (raw as { priceUsd: unknown }).priceUsd;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        const result: TokenPriceResult = { priceUsd: v, source: "chain" };
        cacheSet(key, result);
        return result;
      }
    }
  } catch (cause) {
    // Method-not-found = chain hasn't shipped the oracle yet.
    // Other failures = transport hiccup, treat the same so the UI
    // doesn't render a confusing error state next to every token row.
    if (
      cause instanceof SdkError &&
      cause.kind === "rpc" &&
      cause.code === JSONRPC_METHOD_NOT_FOUND
    ) {
      // expected on v2 testnet
    } else {
      // fall through to chain-gap; non-method-not-found errors are
      // also surfaced as chain-gap to avoid noisy UI errors on
      // intermittent transport failures
    }
  }
  const result: TokenPriceResult = { priceUsd: null, source: "[chain-gap]" };
  cacheSet(key, result);
  return result;
}

/**
 * Batch helper — fetches USD prices for many contracts in parallel.
 * Returns a `Map<contractLower, TokenPriceResult>`. Cache hits
 * short-circuit per contract.
 */
export async function getTokenUsdPrices(
  contracts: string[],
): Promise<Map<string, TokenPriceResult>> {
  const results = await Promise.all(
    contracts.map(async (c) => [c.toLowerCase(), await getTokenUsdPrice(c)] as const),
  );
  return new Map(results);
}
