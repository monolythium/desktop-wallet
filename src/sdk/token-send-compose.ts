// MRC-20 send — pure amount-compose logic (the fund-safety heart).
//
// The user enters a human amount in TOKEN units; this module parses it to base
// units at the token's REAL decimals (from the F1 metadata cache) and back,
// bigint-exact, reusing the shared clob-units seam (decimalToAtoms/atomsToDecimal
// /isValidDecimal) — never a second converter and never the native 18-decimal
// helpers. Every unknown is an honest block:
//   - decimals unavailable  → BLOCK (never encode at a guessed/default scale);
//   - amount malformed/zero  → BLOCK;
//   - amount > held balance  → BLOCK (pre-submit, not a chain revert);
//   - unparseable balance    → BLOCK (fail-closed).
// The verdict's `displayAmount` is the EXACT inverse of the encoded base units
// (atomsToDecimal), so the review can show precisely what will be signed
// (shown == encoded == sent), and a round-trip re-parse guards against any
// scaling drift.

import { atomsToDecimal, decimalToAtoms, isValidDecimal } from "./clob-units";

/** True iff `value` is a non-negative decimal with at most `decimals` places.
 *  Handles `decimals === 0` (integer-only), which `isValidDecimal` cannot — its
 *  `\d{1,0}` quantifier is an invalid regex — so a 0-decimal token never throws
 *  and correctly rejects a fractional amount. */
export function isTokenAmountValid(value: string, decimals: number): boolean {
  const t = value.trim();
  if (t === "") return false;
  if (decimals === 0) return /^\d+$/.test(t);
  return isValidDecimal(t, decimals);
}

/** Parse a human token amount into base units at `decimals` scale. Throws on a
 *  malformed value (callers validate first). `decimals === 0` is handled without
 *  touching the throwing `isValidDecimal(_, 0)` path. */
export function tokenAmountToBase(value: string, decimals: number): bigint {
  if (!isTokenAmountValid(value, decimals)) {
    throw new Error(`amount must be a decimal with at most ${decimals} places`);
  }
  if (decimals === 0) return BigInt(value.trim());
  return decimalToAtoms(value, decimals);
}

/** Exact inverse of {@link tokenAmountToBase}: base units → the canonical
 *  trimmed decimal string. This is what the send review shows — a faithful,
 *  round-trippable rendering of exactly what is encoded (no display cap, no
 *  thousands grouping that the parser would reject). */
export function tokenAmountBaseToDisplay(base: bigint | string, decimals: number): string {
  const b = typeof base === "bigint" ? base : BigInt(base);
  return atomsToDecimal(b, decimals);
}

/** The full holding as a decimal amount for the Max button — the exact inverse
 *  of the raw base-units balance. Null when decimals are unknown (no fabricated
 *  max) or the balance is unparseable. */
export function maxTokenAmount(
  balanceBaseUnits: string,
  decimals: number | null | undefined,
): string | null {
  if (decimals === null || decimals === undefined) return null;
  let balance: bigint;
  try {
    balance = BigInt(balanceBaseUnits.trim());
  } catch {
    return null;
  }
  return tokenAmountBaseToDisplay(balance, decimals);
}

/** Why a token amount cannot be sent (for an honest inline message). */
export type TokenSendBlockReason =
  | "unknown-decimals"
  | "empty"
  | "invalid"
  | "zero"
  | "insufficient";

export type TokenSendAmountVerdict =
  | { ok: true; amountBase: bigint; displayAmount: string }
  | { ok: false; reason: TokenSendBlockReason };

/**
 * Evaluate a typed token amount against the token's decimals and held balance.
 * Pure — the single gate the Send UI consults before allowing Review/submit.
 *
 * Fund-safety: decimals unknown → block (never guess a scale); amount encoded at
 * the REAL decimals; balance checked in base units so it can't be defeated by a
 * display rounding; and the returned `displayAmount` round-trips back to exactly
 * `amountBase` (a scaling drift is caught here, not on-chain).
 */
export function evaluateTokenSendAmount(
  value: string,
  decimals: number | null | undefined,
  balanceBaseUnits: string,
): TokenSendAmountVerdict {
  if (decimals === null || decimals === undefined) {
    return { ok: false, reason: "unknown-decimals" };
  }
  const t = (value ?? "").trim();
  if (t === "") return { ok: false, reason: "empty" };
  if (!isTokenAmountValid(t, decimals)) return { ok: false, reason: "invalid" };

  const amountBase = tokenAmountToBase(t, decimals);
  if (amountBase <= 0n) return { ok: false, reason: "zero" };

  let balance: bigint;
  try {
    balance = BigInt(balanceBaseUnits.trim());
  } catch {
    // An unparseable balance can't be checked against — fail closed rather than
    // treat it as zero (block) or infinite (over-send).
    return { ok: false, reason: "insufficient" };
  }
  if (amountBase > balance) return { ok: false, reason: "insufficient" };

  const displayAmount = tokenAmountBaseToDisplay(amountBase, decimals);
  // Defense-in-depth: the shown amount must re-parse to exactly the encoded base
  // units. If the format/parse pair ever disagrees, block rather than sign a
  // mis-scaled transfer.
  if (tokenAmountToBase(displayAmount, decimals) !== amountBase) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, amountBase, displayAmount };
}
