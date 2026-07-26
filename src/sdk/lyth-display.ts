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

/** Raw lythoshi → a FIXED-decimal display string: exact `formatLyth` conversion,
 *  fractional part truncated toward zero to at most `dp` digits and then
 *  zero-PADDED to exactly `dp` (unlike {@link truncateDecimals}, which trims
 *  trailing zeros). The integer part passes through verbatim, including
 *  `formatLyth`'s en-US comma grouping. `dp = 0` yields the integer part with no
 *  decimal point.
 *
 *  Truncation, never rounding: a rounded-up display can OVERSTATE funds across a
 *  boundary — `99999999999999999999` lythoshi (99.999…) at 2 dp must render
 *  `99.99`, never `100.00`.
 *
 *  The padded form keeps the hero's fraction column stable, so the `.frac`
 *  styling hook and the chip values do not jitter between `12.5` and `12.51`
 *  shapes as the balance moves.
 *
 *  Absent / blank / undecodable input → null, so the caller renders an honest
 *  absence rather than a fabricated `0.00`. Pure. */
export function formatLythFixed(
  lythoshi: string | bigint | null | undefined,
  dp: number,
): string | null {
  if (lythoshi === null || lythoshi === undefined) return null;
  if (!Number.isInteger(dp) || dp < 0) return null;
  const raw = typeof lythoshi === "bigint" ? lythoshi.toString() : lythoshi;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let exact: string;
  try {
    exact = formatLyth(raw.trim(), { includeUnit: false });
  } catch {
    return null;
  }
  const dot = exact.indexOf(".");
  const intPart = dot < 0 ? exact : exact.slice(0, dot);
  if (dp === 0) return intPart;
  const fracRaw = dot < 0 ? "" : exact.slice(dot + 1);
  return `${intPart}.${fracRaw.slice(0, dp).padEnd(dp, "0")}`;
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

/**
 * A FEE's display string — its own precision rule, deliberately not the
 * balance convention.
 *
 * THE PROBLEM THIS SOLVES. Balances are shown at 4 dp, which is right for a
 * balance: nobody needs the tenth decimal of their holdings. A fee at today's
 * floor pricing is on the order of `0.000042 LYTH`, and at 4 dp truncation that
 * renders as the string `"0"` — a wallet telling the user it charged them
 * nothing for a charge it decoded and knows is positive. (Rounding instead
 * would be worse: `0.0001` overstates that fee by roughly 2.4×.) A balance's
 * precision inherited by a fee is a specific false statement about money that
 * left the user's account.
 *
 * THE RULE: a fee is shown EXACTLY, with trailing zeros trimmed.
 *
 * Not capped at all. Capping at the balance's 4 dp fails in both directions —
 * it prints `0` for a 0.000042 fee, and prints `0.0001` for a 0.000147 one,
 * understating an actual charge by a third. Rounding instead of truncating
 * would overstate the first by ~2.4×. There is no cap that is honest for a
 * quantity whose magnitude spans this range, and a fee is short enough that
 * exactness costs no readability: `0.000042`, `0.0025`, `1.5`.
 *
 * A genuinely zero or undecodable fee returns null — the caller omits the row.
 * Absence is honest; a zero is a claim.
 *
 * This is the one fee-precision rule. The compose surface's figure comes from
 * the SDK's own full-precision `formatLyth` through the ADR-0039 seam, so the
 * two agree rather than disagreeing by a factor of anything.
 */
export function formatFeeLythDisplay(
  lythoshi: string | null | undefined,
): string | null {
  if (lythoshi === null || lythoshi === undefined || lythoshi.trim() === "") {
    return null;
  }
  let exact: string;
  try {
    exact = formatLyth(lythoshi, { includeUnit: false });
  } catch {
    return null;
  }
  // A real zero — nothing was charged, or nothing is known. Omit the row.
  if (/^0(\.0+)?$/.test(exact)) return null;
  // 18 keeps every significant digit a lythoshi value can carry; the helper's
  // trailing-zero trim is what makes the exact form readable.
  return truncateDecimals(exact, 18);
}

/** The native LYTH token id — the all-zero 32-byte hash the chain uses as the
 *  native sentinel (`mono-core` `NATIVE_LYTH_TOKEN_ID: Hash = Hash::ZERO`,
 *  schema.rs:62). Chain reads keyed by token id (e.g. `lyth_getAssetPolicy`)
 *  require this 32-byte hex form, never the "LYTH" ticker. */
export const NATIVE_LYTH_TOKEN_ID = "0x" + "00".repeat(32);

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
