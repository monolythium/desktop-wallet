// Naming-registry U-shaped pricing calculator — §22.8.
//
// Whitepaper §22.8 prices names as
//
//   price = base_category_multiplier × length_modifier × baseTxFee
//
// where `baseTxFee` is the network's prevailing tx fee. The category
// multiplier is constant per TLD and the length modifier sweeps from
// "very expensive" at 1-char ("vanity penalty") down to 1× at 6-12
// chars ("sweet spot") then climbs back up for over-long labels ("you
// asked for it"). Hence the "U-shape".
//
// The system TLD is foundation-only: the calculator throws rather than
// emit a number, since the on-chain path for `system.mono` registrations
// is not the standard register precompile (only the Foundation's
// privileged path can mint there).
//
// Forbidden length (>=64 chars per label) is a chain-side rejection;
// the calculator throws so the UI surfaces "name is too long" before
// the user spends gas on a guaranteed-revert.

import type { NameCategory } from "./naming";

/** Base category multiplier per §22.8 Table A. */
export const CATEGORY_MULTIPLIER: Record<NameCategory, number> = {
  human: 5,
  agent: 2,
  cluster: 20,
  contract: 10,
  /** Sentinel — system TLD is foundation-only; `calculatePrice` throws. */
  system: Number.NaN,
};

/**
 * Length-based modifier per §22.8 Table B. Bands are inclusive on the
 * lower bound and inclusive on the upper bound. 64+ is forbidden.
 *
 *   1ch    → 100×
 *   2ch    →  50×
 *   3ch    →  10×
 *   4ch    →   5×
 *   5ch    →   3×
 *   6-12ch →   1×   (sweet spot)
 *   13-20ch →  1.5×
 *   21-32ch →  3×
 *   33-50ch →  10×
 *   51-63ch →  50×
 *   64+    →  forbidden
 */
export function lengthModifier(labelLength: number): number {
  if (!Number.isFinite(labelLength) || labelLength <= 0) {
    throw new PricingError("invalid_length", `length must be positive: ${labelLength}`);
  }
  if (labelLength >= 64) {
    throw new PricingError(
      "forbidden_length",
      `label length ${labelLength} exceeds 63-char maximum`,
    );
  }
  if (labelLength === 1) return 100;
  if (labelLength === 2) return 50;
  if (labelLength === 3) return 10;
  if (labelLength === 4) return 5;
  if (labelLength === 5) return 3;
  if (labelLength >= 6 && labelLength <= 12) return 1;
  if (labelLength >= 13 && labelLength <= 20) return 1.5;
  if (labelLength >= 21 && labelLength <= 32) return 3;
  if (labelLength >= 33 && labelLength <= 50) return 10;
  if (labelLength >= 51 && labelLength <= 63) return 50;
  // Unreachable given the bounds above; defensive throw so a future
  // table-edit that drops a band doesn't silently zero the price.
  throw new PricingError(
    "invalid_length",
    `no length band covers ${labelLength}`,
  );
}

/** Typed error for pricing-failure cases the UI needs to distinguish. */
export class PricingError extends Error {
  public readonly code: "system_forbidden" | "forbidden_length" | "invalid_length";
  constructor(code: PricingError["code"], message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

/**
 * Compute the registration price in the smallest unit (wei) for one
 * name. The category multiplier is integer; the length modifier may be
 * fractional (1.5× for 13-20ch). Fractional multipliers are applied
 * exactly via integer math at thousandth-of-a-multiplier precision —
 * good enough for §22.8 (the table never uses sub-thousandth fractions)
 * and avoids any IEEE-754 drift on large baseTxFee values.
 *
 * Returns `bigint` so the result can be passed straight to ethers /
 * tx-value fields without precision loss.
 *
 * Throws `PricingError`:
 *   - `system_forbidden` — category === "system"
 *   - `forbidden_length` — labelLength >= 64
 *   - `invalid_length` — labelLength <= 0 or non-finite
 */
export function calculatePrice(
  label: string,
  category: NameCategory,
  baseTxFee: bigint,
): bigint {
  if (category === "system") {
    throw new PricingError(
      "system_forbidden",
      "system.* TLD is foundation-only and has no standard price",
    );
  }
  const labelLength = label.length;
  const lenMod = lengthModifier(labelLength); // throws on forbidden / invalid
  const catMod = CATEGORY_MULTIPLIER[category];
  // catMod is integer; lenMod may be fractional. Multiply through
  // thousandths to keep precision exact.
  const lenModMilli = BigInt(Math.round(lenMod * 1000));
  const catModBig = BigInt(catMod);
  return (baseTxFee * catModBig * lenModMilli) / 1000n;
}

/**
 * Convenience helper — for the preview pane the wallet renders the
 * price as both an integer LYTH count (for "1.4 LYTH") and a wei value
 * (for the actual transaction). Returns both.
 */
export function calculatePriceBreakdown(args: {
  label: string;
  category: NameCategory;
  baseTxFee: bigint;
}): {
  wei: bigint;
  lyth: number;
  categoryMultiplier: number;
  lengthModifier: number;
} {
  const wei = calculatePrice(args.label, args.category, args.baseTxFee);
  // For display only — never settle accounting against this.
  const lythWhole = wei / 1_000_000_000_000_000_000n;
  const lythFrac = wei % 1_000_000_000_000_000_000n;
  const lyth = Number(lythWhole) + Number(lythFrac) / 1e18;
  return {
    wei,
    lyth,
    categoryMultiplier: CATEGORY_MULTIPLIER[args.category],
    lengthModifier: lengthModifier(args.label.length),
  };
}
