// Live token-status → asset-row adapter.
//
// Maps the live `loadLiveTokenStatus` result onto the `Token` shape that the
// `TokenRow` component renders. Pure and side-effect-free so it can be unit
// tested directly.
//
// HONEST ABSENCE: the chain has no price oracle and no token-name registry,
// so `priceUsd` and `chg24h` are always `null` here — `TokenRow` renders them
// as an em-dash. The native row is always emitted (even at a zero balance, so
// the wallet's denomination is visible); MRC-20 rows come straight from the
// indexer's token-balance list. Until a token registry exists the MRC-20
// ticker is a short form of the raw token id rather than a fabricated symbol.

import type { Token } from "../data/types";
import type { LiveTokenStatus } from "./live";
import { tokenAmountDisplay, type TokenMeta } from "./token-metadata";

/** Short, human-scannable form of a raw MRC-20 token id (no registry yet). */
export function shortTokenId(tokenId: string, head = 6, tail = 4): string {
  if (tokenId.length <= head + tail + 1) return tokenId;
  return `${tokenId.slice(0, head)}…${tokenId.slice(-tail)}`;
}

/** Parse a decimal LYTH string ("1,234.5" / "12.0" / "") into a number.
 *  Tolerant of thousands separators and stray whitespace; non-numeric input
 *  collapses to 0 (the row still renders rather than throwing). */
export function parseDecimalAmount(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const cleaned = value.replace(/,/g, "").trim();
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the ordered asset list for the Tokens page from a live status.
 *
 * Row 0 is always native LYTH (the wallet's primary denomination). MRC-20
 * rows follow in indexer order when the balance query succeeded. Price/USD
 * and 24h fields are `null` throughout — there is no oracle to source them.
 *
 * `tokenMeta` maps a token's asset id → its cached `lyth_mrcMetadata` (decimals
 * / symbol / name). When present, an MRC-20 row shows the exact human amount at
 * its real decimals and its real symbol; when a token's metadata is absent (not
 * yet loaded, or no row on-chain) the amount falls back to an honest "—" rather
 * than a raw base-units integer masquerading as a human figure.
 */
export function liveTokenStatusToRows(
  live: LiveTokenStatus | null,
  tokenMeta?: Map<string, TokenMeta>,
): Token[] {
  const nativeAmount = live?.nativeBalance.ok ? parseDecimalAmount(live.nativeBalance.value) : 0;

  const rows: Token[] = [
    {
      sym: "LYTH",
      name: "Monolythium",
      amount: nativeAmount,
      priceUsd: null,
      chg24h: null,
      primary: true,
    },
  ];

  if (live?.tokenBalances.ok && live.tokenBalances.value) {
    for (const row of live.tokenBalances.value) {
      const assetId = row.mrc?.assetId ?? row.tokenId;
      const meta = tokenMeta?.get(assetId);
      const symbol = meta?.symbol?.trim() || shortTokenId(row.tokenId);
      rows.push({
        sym: symbol,
        name: meta?.name?.trim() || symbol,
        // MRC-20 display is authoritative via `displayAmount`; the raw `amount`
        // number is never rendered for a token (avoids a base-units float leak).
        amount: 0,
        displayAmount: tokenAmountDisplay(row.balance, meta) ?? "—",
        priceUsd: null,
        chg24h: null,
      });
    }
  }

  return rows;
}
