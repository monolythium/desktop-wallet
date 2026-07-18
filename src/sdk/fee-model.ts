// Fee model — the single source of truth for the wallet's fee constants and the
// pure fee math. Both the compose DISPLAY path and the submit CLAMP path import
// the floor + ceiling + limits from here; that shared definition is the whole
// mechanism behind "display == broadcast == signed" (a value can never drift
// between what the user sees and what the wallet signs).
//
// Everything is bigint — no float ever enters fee math (a float above 2^53 loses
// precision, and a fee is money). Chain canon (mono-core v0.4.0-testnet):
//   - two per-unit prices, EIP-1559-shaped: maxFeePerGas (ceiling) + tip.
//   - charged per unit = base + min(tip, maxFeePerGas − base); tip paid as-set,
//     no chain maximum (floors only); the base is burned, the tip goes to the
//     producing cluster.
//   - admission reserves maxFeePerGas × executionUnitLimit against the balance;
//     execution charges (base + effective_tip) × units_USED (21_000 for a bare
//     native transfer). The reservation surplus is refunded at inclusion.

import type { ResolvedExecutionFee } from "@monolythium/core-sdk";

/** Priority-tip floor: 10^9 lythoshi / execution unit (= LYTHOSHI_PER_LYTH / 10^9,
 *  the twin of the chain's PRIORITY_TIP_FLOOR_LYTHOSHI). Any signed tip is clamped
 *  UP to it — the mempool rejects a below-floor tip. */
export const MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI = 1_000_000_000n;

/** Wallet-side per-unit price CEILING: 10^15 lythoshi / execution unit
 *  (= LYTHOSHI_PER_LYTH / 10^3). The chain has NO maximum, so bounding the signed
 *  price is a client duty; the worst-case signed fee is thereby 10^15 × 30_000 =
 *  3×10^19 lythoshi = 30 LYTH per transfer — and because display == signed, even
 *  that would be shown before signing. */
export const MAX_EXECUTION_UNIT_PRICE_LYTHOSHI = 1_000_000_000_000_000n;

/** Units the chain actually CHARGES for a bare native transfer (mono-core
 *  NATIVE_TRANSFER_EXECUTION_UNITS). Drives the DISPLAYED fee. `0x5208`. */
export const NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS = 21_000n;

/** The execution-unit limit the wallet SIGNS for a bare native transfer. Above
 *  the 24_309 ML-DSA-65 intrinsic floor with headroom; drives the RESERVATION.
 *  `0x7530`. */
export const NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT = 30_000n;

/** Basis-point denominator. */
export const FEE_MULTIPLIER_BPS_BASE = 10_000n;

/** Tier multipliers over the suggested tip: Normal 1×, Fast 2×. Deliberately no
 *  Slow (0.5× floor-clamps into a permanent no-op) and no custom tier. */
export const FEE_TIER_BPS = { normal: 10_000n, fast: 20_000n } as const;

export type FeeTier = keyof typeof FEE_TIER_BPS;

/** ms — per-operator timeout of the cross-operator balance fan-out (spend guard). */
export const SPEND_GUARD_TIMEOUT_MS = 2_500;

/** `value × bps / 10_000` (floor division). A negative input → `0n` (defensive —
 *  the floor clamp then raises it to the tip floor). Pure. */
export function scaleByBps(value: bigint, bps: bigint): bigint {
  if (value < 0n) return 0n;
  return (value * bps) / FEE_MULTIPLIER_BPS_BASE;
}

/** Raise a tip UP to the mempool floor (never below 10^9/unit). Pure. */
export function clampTipToFloor(tip: bigint): bigint {
  return tip > MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI ? tip : MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI;
}

/** Lower a per-unit price DOWN to the wallet ceiling (never above 10^15/unit). Pure. */
export function boundPerUnitPrice(price: bigint): bigint {
  return price < MAX_EXECUTION_UNIT_PRICE_LYTHOSHI ? price : MAX_EXECUTION_UNIT_PRICE_LYTHOSHI;
}

export interface NativeFeeQuote {
  /** The tier-scaled, floor-clamped priority tip (lythoshi / unit). */
  tieredTipLythoshi: bigint;
  /** base + tieredTip, bounded by the ceiling (lythoshi / unit) — the signed
   *  maxFeePerGas and the exact maximum per-unit price payable. */
  perUnitPriceLythoshi: bigint;
  /** The DISPLAYED fee: perUnitPrice × 21_000 (the deduction a native transfer
   *  actually takes). */
  chargeLythoshi: bigint;
  /** The RESERVATION: perUnitPrice × the signed limit (the admission worst case
   *  + the Max / insufficient-funds basis). */
  reservationLythoshi: bigint;
  /** The fee the wallet signs — byte-identical to what the preview shows. */
  signedFee: ResolvedExecutionFee;
}

/**
 * The dual-fee model (§3), pure. Given a quote (base, suggested tip), a tier, and
 * the signed execution-unit limit:
 *   tieredTip   = clampTipToFloor(scaleByBps(suggestedTip, tierBps))
 *   perUnit     = boundPerUnitPrice(base + tieredTip)
 *   charge      = perUnit × 21_000        (DISPLAYED — the honest deduction)
 *   reservation = perUnit × signedLimit   (the admission worst case / Max basis)
 *   signedFee   = { maxFeePerGas: perUnit, maxPriorityFeePerGas: min(tieredTip, perUnit), gasLimit: signedLimit }
 * Since maxFeePerGas = base + tieredTip, the tip can never exceed the ceiling
 * (FeeMismatch is structurally unreachable), and `charge < reservation` for every
 * quote and tier (21_000 < the signed limit at the same per-unit price).
 */
export function computeNativeFeeQuote(
  baseLythoshi: bigint,
  suggestedTipLythoshi: bigint,
  tier: FeeTier,
  executionUnitLimit: bigint,
): NativeFeeQuote {
  const tieredTipLythoshi = clampTipToFloor(scaleByBps(suggestedTipLythoshi, FEE_TIER_BPS[tier]));
  const perUnitPriceLythoshi = boundPerUnitPrice(baseLythoshi + tieredTipLythoshi);
  const maxPriorityFeePerGas =
    tieredTipLythoshi < perUnitPriceLythoshi ? tieredTipLythoshi : perUnitPriceLythoshi;
  return {
    tieredTipLythoshi,
    perUnitPriceLythoshi,
    chargeLythoshi: perUnitPriceLythoshi * NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS,
    reservationLythoshi: perUnitPriceLythoshi * executionUnitLimit,
    signedFee: {
      maxFeePerGas: perUnitPriceLythoshi,
      maxPriorityFeePerGas,
      gasLimit: executionUnitLimit,
    },
  };
}
