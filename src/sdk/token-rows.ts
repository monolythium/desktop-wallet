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
import { formatLythDisplay } from "./lyth-display";

/** The magnitude-picked fractional cap for a native LYTH figure: a large
 *  balance needs no fourth decimal, a small one does. Shared so the row and the
 *  detail page pick the same precision for the same balance. */
export function nativeFracDigits(amount: number): number {
  return amount >= 100 ? 2 : amount >= 1 ? 3 : 4;
}

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

  // The native row's DISPLAY comes from the exact lythoshi integer, not from
  // the float above. A float balance rounds — `99999999999999999999` lythoshi
  // formats as `100.00` through a rounding formatter, overstating funds across
  // the boundary. `amount` stays for the numeric consumers (sorting, the
  // magnitude tiers); `displayAmount` is what a user reads.
  const nativeDisplay = live?.nativeBalanceLythoshi.ok
    ? formatLythDisplay(live.nativeBalanceLythoshi.value, nativeFracDigits(nativeAmount))
    : null;

  const rows: Token[] = [
    {
      sym: "LYTH",
      name: "Monolythium",
      amount: nativeAmount,
      // Null when the exact read hasn't landed — the row then shows the honest
      // absence its consumer already renders, never a fabricated figure.
      ...(nativeDisplay === null ? {} : { displayAmount: nativeDisplay }),
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
        // Carry the standard the row already reports so the list can tell a
        // non-fungible row apart from an MRC-20 whose metadata hasn't loaded.
        standard: meta?.standard ?? row.mrc?.standard ?? null,
        priceUsd: null,
        chg24h: null,
      });
    }
  }

  return rows;
}
