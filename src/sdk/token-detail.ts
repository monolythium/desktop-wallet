// Token-detail fact selection — pure adapter from a live token status + a
// selected-token reference onto the small fact bag the TokenDetail page
// renders. Side-effect-free so it can be unit tested directly.
//
// HONEST ABSENCE: there is no price oracle and no token-name registry on the
// chain. The native row is "Monolythium"/"LYTH"; an MRC-20 row's name + ticker
// are short forms of the raw token id. Price / 24h / market-cap / volume have
// no source, so they are never part of these facts — the page renders an
// em-dash for each.

import type { LiveTokenStatus } from "./live";
import { parseDecimalAmount, shortTokenId } from "./token-rows";
import { isNativeRef, NATIVE_TOKEN_REF, type TokenRef } from "./selected-token";

export interface TokenDetailFacts {
  /** Reference this fact bag was built for (native sentinel or raw id). */
  ref: TokenRef;
  /** True for the native LYTH row. */
  isNative: boolean;
  /** Display name (native = "Monolythium"; MRC-20 = short id). */
  name: string;
  /** Display ticker (native = "LYTH"; MRC-20 = short id). */
  ticker: string;
  /** Live balance as a decimal string, or null when the read failed. */
  balanceDisplay: string | null;
  /** Numeric balance for fraction-digit selection; 0 on a failed read. */
  balanceAmount: number;
  /** Raw 32-byte token id for an MRC-20 row; null for native. */
  tokenId: string | null;
  /** Block height the MRC-20 balance was last observed at; null otherwise. */
  updatedAtBlock: bigint | null;
  /** The asset policy record for native LYTH, when the read succeeded. */
  assetPolicy: Record<string, unknown> | null;
  /** True when the selected MRC-20 ref was not found in the balance list. */
  notFound: boolean;
}

/**
 * Build the detail fact bag for the selected token. Native always resolves
 * (the row is synthetic — balance from `nativeBalance`). An MRC-20 ref is
 * matched against the indexer's token-balance list; an unmatched id surfaces
 * `notFound: true` so the page can show an honest "not in this wallet" state
 * rather than fabricating a row.
 */
export function selectTokenDetailFacts(
  live: LiveTokenStatus | null,
  ref: TokenRef,
): TokenDetailFacts {
  if (isNativeRef(ref)) {
    const ok = live?.nativeBalance.ok === true;
    return {
      ref: NATIVE_TOKEN_REF,
      isNative: true,
      name: "Monolythium",
      ticker: "LYTH",
      balanceDisplay: ok ? live!.nativeBalance.value ?? null : null,
      balanceAmount: ok ? parseDecimalAmount(live!.nativeBalance.value) : 0,
      tokenId: null,
      updatedAtBlock: null,
      assetPolicy: live?.assetPolicy.ok ? live.assetPolicy.value ?? null : null,
      notFound: false,
    };
  }

  const row =
    live?.tokenBalances.ok && live.tokenBalances.value
      ? live.tokenBalances.value.find((r) => r.tokenId === ref)
      : undefined;

  const label = shortTokenId(ref);
  return {
    ref,
    isNative: false,
    name: label,
    ticker: label,
    balanceDisplay: row ? row.balance : null,
    balanceAmount: row ? parseDecimalAmount(row.balance) : 0,
    tokenId: ref,
    updatedAtBlock: row ? row.updatedAtBlock : null,
    // No per-MRC asset-policy read is wired (loadLiveTokenStatus queries the
    // native LYTH policy only), so MRC rows carry none — the page shows "—".
    assetPolicy: null,
    notFound: live?.tokenBalances.ok === true && row === undefined,
  };
}
