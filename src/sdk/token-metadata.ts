// Per-token MRC metadata (decimals / symbol / name) with an in-memory cache.
//
// The balances feed (`lyth_getTokenBalances`) carries no decimals, so an MRC-20
// amount cannot be scaled to a human figure from a balance row alone. This
// module fetches `lyth_mrcMetadata` once per token — decimals / symbol / name
// are fixed at token creation and never change, so a session cache keyed by
// asset id is exact — and exposes the honest amount resolver: a raw base-units
// balance + its metadata becomes the human value at the token's real decimals
// when known, else `null` so the surface renders an em-dash. A raw base-units
// integer is NEVER returned as if it were a human figure (no-mock).

import { getProvider } from "./client";
import { formatTokenAmountDisplay } from "./lyth-display";

/** The subset of `lyth_mrcMetadata` a display needs. `decimals === null` means
 *  the source event carried no decimals — the scale is unknown, so the amount
 *  renders as an honest em-dash rather than a wrongly-scaled figure. */
export interface TokenMeta {
  decimals: number | null;
  symbol: string | null;
  name: string | null;
}

/** All-unknown metadata — the honest default when a token has no metadata row
 *  or the read failed (unknown scale → em-dash downstream). */
export const UNKNOWN_TOKEN_META: TokenMeta = { decimals: null, symbol: null, name: null };

// Session cache keyed by asset id. One successful fetch per token is enough.
const cache = new Map<string, TokenMeta>();

/** Drop the cache — used on a wallet switch and in tests. */
export function clearTokenMetaCache(): void {
  cache.clear();
}

/** Cached per-token metadata; fetches `lyth_mrcMetadata` once per asset id. A
 *  failed read or an absent metadata row yields {@link UNKNOWN_TOKEN_META} and
 *  is NOT cached, so a transient RPC failure (or a token whose metadata folds in
 *  later) is retried on the next load rather than pinned "unknown" for the whole
 *  session. Never throws. */
export async function loadTokenMeta(assetId: string): Promise<TokenMeta> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  try {
    const res = await getProvider().rpcClient.lythMrcMetadata(assetId);
    const m = res.metadata;
    if (!m) return UNKNOWN_TOKEN_META; // no row yet — stay retriable, don't cache
    const meta: TokenMeta = {
      decimals: m.decimals ?? null,
      symbol: m.symbol ?? null,
      name: m.name ?? null,
    };
    cache.set(assetId, meta);
    return meta;
  } catch {
    return UNKNOWN_TOKEN_META; // read failed — retriable, not cached
  }
}

/** Fetch metadata for many tokens at once (deduped + cached), returning a map
 *  keyed by the same id passed in so callers can look it up per token id. */
export async function loadTokenMetaMap(
  assetIds: readonly string[],
): Promise<Map<string, TokenMeta>> {
  const unique = [...new Set(assetIds)];
  const entries = await Promise.all(
    unique.map(async (id) => [id, await loadTokenMeta(id)] as const),
  );
  return new Map(entries);
}

/** Pure: the display amount for a token holding given its metadata. Decimals
 *  known → the human amount at the token's real decimals via the shared
 *  formatter; decimals unknown (or no metadata) → `null` so the surface shows an
 *  honest em-dash. A raw base-units integer is never returned as a human figure. */
export function tokenAmountDisplay(
  rawBaseUnits: string | null | undefined,
  meta: TokenMeta | null | undefined,
  displayCap = 4,
): string | null {
  if (!meta || meta.decimals === null) return null;
  return formatTokenAmountDisplay(rawBaseUnits, meta.decimals, displayCap);
}
