// Shared LYTH display helpers.
//
// The indexer reports native amounts as raw lythoshi (10^18 per LYTH); the SDK
// `formatLyth` is the single, exact lythoshi→LYTH converter used wallet-wide.
// This module wraps it with a display-precision cap + the native-token check so
// every amount surface formats identically. No second converter is hand-rolled
// — the conversion is always `formatLyth`; `truncateDecimals` only caps what's
// shown on screen.

import { formatLyth } from "@monolythium/core-sdk";

/** Cap a decimal string to at most `decimals` fractional digits for DISPLAY —
 *  truncation (never rounding) + trailing-zero trim, point dropped when whole.
 *  A whole or malformed string passes through unchanged. Pure. */
export function truncateDecimals(s: string, decimals = 4): string {
  // Tolerate thousands-grouping in the integer part (formatLyth may group) — we
  // only cap the fractional part; the integer part passes through verbatim.
  if (!/^-?[0-9][0-9,]*(\.[0-9]+)?$/.test(s)) return s;
  const dot = s.indexOf(".");
  if (dot < 0) return s;
  const intPart = s.slice(0, dot);
  const frac = s.slice(dot + 1, dot + 1 + decimals).replace(/0+$/, "");
  return frac.length === 0 ? intPart : `${intPart}.${frac}`;
}

/** Raw lythoshi (the indexer's integer string, a bigint, or a decimal LYTH
 *  string) → display LYTH: exact `formatLyth` conversion capped at `decimals`
 *  fractional digits. Returns null for an absent/blank/undecodable amount, so
 *  the caller renders an honest em-dash rather than a fabricated 0. */
export function formatLythDisplay(
  lythoshi: string | null | undefined,
  decimals = 4,
): string | null {
  if (lythoshi === null || lythoshi === undefined || lythoshi.trim() === "") {
    return null;
  }
  try {
    return truncateDecimals(formatLyth(lythoshi, { includeUnit: false }), decimals);
  } catch {
    return null;
  }
}

/** Format a raw 1e18-scaled "atom" integer string for display: the conversion
 *  goes through the same exact `formatLyth` path (bigint, truncate-not-round)
 *  as every other amount, capped at `decimals`, with the scale hint appended.
 *  Sub-unit values (< 1e18) show the exact raw integer; 0 → "0";
 *  undefined/null/undecodable → em-dash. The bridge disclosure surfaces report
 *  insurance and drain caps in 1e18 atoms of a bridged asset (NOT LYTH), so
 *  there is no "LYTH" unit here. This replaces a hand-rolled `Number(n) / 1e18`
 *  that both rounded and lost integer precision above 2^53 — a fund figure could
 *  render overstated. Pure. */
export function formatAtomic1e18(
  value: string | null | undefined,
  decimals = 2,
): string {
  if (value === undefined || value === null) return "—";
  let n: bigint;
  try {
    n = BigInt(value);
  } catch {
    return "—";
  }
  if (n === 0n) return "0";
  if (n >= 10n ** 18n) {
    const display = formatLythDisplay(value, decimals);
    return display === null ? "—" : `${display} (1e18 atoms)`;
  }
  return n.toString();
}

/** True when a token id denotes native LYTH — `null`, or an all-zero
 *  (zero-address) id the indexer uses as the native sentinel. Real MRC-20 token
 *  ids (any non-zero hex) return false. Pure. */
export function isNativeLythTokenId(tokenId: string | null): boolean {
  if (tokenId === null) return true;
  const body = tokenId.toLowerCase().replace(/^0x/, "");
  return body.length === 0 || /^0+$/.test(body);
}

/** The display unit for an activity row's token: "LYTH" for native (null /
 *  zero-address), else the token id (no symbol registry exists on-chain). */
export function tokenUnitLabel(tokenId: string | null): string {
  return isNativeLythTokenId(tokenId) ? "LYTH" : tokenId!;
}
