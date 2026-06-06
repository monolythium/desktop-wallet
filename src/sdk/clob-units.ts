// CLOB human-unit ↔ atom conversion seam.
//
// The CLOB precompile takes the order in ATOMS: `price` is quote atoms per
// base atom and `quantity` is base atoms. Users think in whole tokens, so this
// seam converts a human-decimal entry into the on-chain atom integers (mirrors
// how Send converts LYTH → lythoshi), and back for display.
//
// The only live market is the native LYTH spot market, where both legs are
// LYTH-decimals (18). There is no per-asset decimals registry on-chain, so the
// caller passes the decimals it knows (defaulting to NATIVE_LYTH_DECIMALS) and
// the UI states that assumption — we never silently guess a foreign token's
// scale.

import { NATIVE_LYTH_DECIMALS } from "@monolythium/core-sdk";

/** Decimal places for the native LYTH legs of the spot market. */
export const SPOT_DEFAULT_DECIMALS = NATIVE_LYTH_DECIMALS;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** True iff `value` is a non-negative decimal with at most `maxDecimals` places. */
export function isValidDecimal(value: string, maxDecimals: number): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  const re = new RegExp(`^\\d+(\\.\\d{1,${maxDecimals}})?$`);
  return re.test(trimmed);
}

/** Parse a non-negative decimal string into integer atoms at `decimals` scale.
 *  Throws on a malformed value (caller validates first). */
export function decimalToAtoms(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!isValidDecimal(trimmed, decimals)) {
    throw new Error(`amount must be a decimal with at most ${decimals} places`);
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * pow10(decimals) + BigInt(padded || "0");
}

/** Format integer atoms at `decimals` scale back to a trimmed decimal string. */
export function atomsToDecimal(atoms: bigint, decimals: number): string {
  const negative = atoms < 0n;
  const abs = negative ? -atoms : atoms;
  const base = pow10(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return negative ? `-${out}` : out;
}

/**
 * Convert a human limit price (quote tokens per 1 base token) into the chain's
 * `quote atoms per base atom` integer.
 *
 * price_atoms = humanPrice × 10^quoteDecimals / 10^baseDecimals
 *
 * Computed in BigInt fixed-point. Returns null when the conversion does not
 * land on a whole atom (e.g. a price finer than the tick the scaling allows) —
 * the caller surfaces an honest "price too precise for this market" rather than
 * silently truncating.
 */
export function humanPriceToAtoms(
  humanPrice: string,
  baseDecimals: number,
  quoteDecimals: number,
): bigint | null {
  // Use a wide working scale = baseDecimals so the division by 10^baseDecimals
  // is exact when the input has at most baseDecimals places.
  if (!isValidDecimal(humanPrice, baseDecimals)) return null;
  const priceScaled = decimalToAtoms(humanPrice, baseDecimals); // humanPrice × 10^baseDecimals
  const numerator = priceScaled * pow10(quoteDecimals);
  const denominator = pow10(baseDecimals) * pow10(baseDecimals);
  if (numerator % denominator !== 0n) return null;
  return numerator / denominator;
}

/** Convert a human base quantity (whole base tokens) into base atoms. Returns
 *  null on a malformed / over-precise value. */
export function humanQuantityToAtoms(humanQuantity: string, baseDecimals: number): bigint | null {
  if (!isValidDecimal(humanQuantity, baseDecimals)) return null;
  return decimalToAtoms(humanQuantity, baseDecimals);
}

/**
 * Inverse of {@link humanPriceToAtoms}: a `quote atoms per base atom` integer
 * back to a human price (quote tokens per base token), for seeding the entry
 * field from book/last-trade data.
 *
 * humanPrice = priceAtoms × 10^baseDecimals / 10^quoteDecimals
 *
 * Returns null on a malformed input.
 */
export function atomPriceToHuman(
  priceAtoms: string,
  baseDecimals: number,
  quoteDecimals: number,
): string | null {
  let atoms: bigint;
  try {
    atoms = BigInt(priceAtoms);
  } catch {
    return null;
  }
  // priceAtoms is over base atoms; multiply back up by 10^baseDecimals to reach
  // per-base-token, then express at quote-token scale (÷ 10^quoteDecimals).
  const scaled = atoms * pow10(baseDecimals); // now quote atoms per base token
  return atomsToDecimal(scaled, quoteDecimals);
}

/**
 * Notional in quote atoms for an order. The price is quote atoms PER base atom
 * and the quantity is base atoms, so the product is already quote atoms — the
 * same `price × quantity` the on-chain min-notional check uses. Pure.
 */
export function notionalQuoteAtoms(priceAtoms: bigint, quantityAtoms: bigint): bigint {
  return priceAtoms * quantityAtoms;
}
