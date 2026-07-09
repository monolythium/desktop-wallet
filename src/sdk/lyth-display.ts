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

/** Raw base-units integer string (a token's on-chain balance) + the token's
 *  `decimals` → exact display amount, capped at `displayCap` fractional digits.
 *  Bigint-exact — never a float: the same truncate-not-round contract as
 *  {@link formatLythDisplay}, generalised from the native 18 to an arbitrary
 *  token `decimals`. The conversion still runs through the one exact `formatLyth`
 *  converter by first bridging the balance to native 18-decimal atoms
 *  (`raw · 10^(18−decimals)`) — no second converter is hand-rolled. A token with
 *  more than 18 decimals divides down onto the 18-atom grid first (precision
 *  below the display cap, which never exceeds 18, cannot be shown anyway).
 *  Returns null for an absent/blank/undecodable balance or an out-of-range
 *  `decimals`, so the caller renders an honest em-dash — never a fabricated 0 or
 *  a wrong scale. Native LYTH keeps its own {@link formatLythDisplay} path; this
 *  is the MRC-20 (arbitrary-decimals) variant. */
export function formatTokenAmountDisplay(
  rawBaseUnits: string | null | undefined,
  decimals: number,
  displayCap = 4,
): string | null {
  if (rawBaseUnits === null || rawBaseUnits === undefined || rawBaseUnits.trim() === "") {
    return null;
  }
  // `decimals` is the token's u8 metadata field — reject anything outside 0..255
  // (and non-integers) rather than fabricate a scale.
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  let raw: bigint;
  try {
    raw = BigInt(rawBaseUnits.trim());
  } catch {
    return null;
  }
  const atoms18 =
    decimals <= 18
      ? raw * 10n ** BigInt(18 - decimals)
      : raw / 10n ** BigInt(decimals - 18); // truncate below the 18-atom grid
  return formatLythDisplay(atoms18.toString(), displayCap);
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
