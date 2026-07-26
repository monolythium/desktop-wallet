// fee-model — pure fee math. Table-driven: the pinned live-floor figures, the
// charge<reserve invariant, floor/ceiling clamps, bigint precision, and the
// unit-domain drift guard (constants pinned as exact fractions of the SDK's
// LYTHOSHI_PER_LYTH so a decimals change breaks the build).

import { describe, expect, it } from "vitest";
import { LYTHOSHI_PER_LYTH } from "@monolythium/core-sdk";
import {
  FEE_TIER_BPS,
  MAX_EXECUTION_UNIT_PRICE_LYTHOSHI,
  MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI,
  NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS,
  NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT,
  boundPerUnitPrice,
  clampTipToFloor,
  computeNativeFeeQuote,
  postClampResolvedFee,
  scaleByBps,
  type FeeTier,
} from "../fee-model";

const BASE = 1_000_000_000n; // live floor
const TIP = 1_000_000_000n; // live floor
const NATIVE = NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT;

describe("unit-domain drift guard", () => {
  it("pins every lythoshi constant as an exact fraction of LYTHOSHI_PER_LYTH", () => {
    expect(MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI).toBe(LYTHOSHI_PER_LYTH / 1_000_000_000n); // /10^9
    expect(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI).toBe(LYTHOSHI_PER_LYTH / 1_000n); // /10^3
  });

  it("pins the execution-unit constants to their hex values", () => {
    expect(NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS).toBe(0x5208n); // 21_000
    expect(NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT).toBe(0x7530n); // 30_000
  });

  it("keeps the signed limit above the ML-DSA-65 intrinsic floor (24_309) — the mainnet tripwire", () => {
    expect(NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT > 24_309n).toBe(true);
  });
});

describe("scaleByBps / clampTipToFloor / boundPerUnitPrice", () => {
  it("scaleByBps floor-divides and floors a negative input to 0n", () => {
    expect(scaleByBps(1_000_000_000n, FEE_TIER_BPS.normal)).toBe(1_000_000_000n); // 1×
    expect(scaleByBps(1_000_000_000n, FEE_TIER_BPS.fast)).toBe(2_000_000_000n); // 2×
    expect(scaleByBps(999n, 10_000n)).toBe(999n);
    expect(scaleByBps(-5n, 20_000n)).toBe(0n);
    expect(scaleByBps(7n, 15_000n)).toBe(10n); // 7*15000/10000 = 10 (floor of 10.5)
  });

  it("clampTipToFloor raises anything below 10^9 to 10^9", () => {
    expect(clampTipToFloor(0n)).toBe(MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI);
    expect(clampTipToFloor(500_000_000n)).toBe(MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI);
    expect(clampTipToFloor(2_000_000_000n)).toBe(2_000_000_000n);
  });

  it("boundPerUnitPrice lowers anything above 10^15 to 10^15", () => {
    expect(boundPerUnitPrice(10n)).toBe(10n);
    expect(boundPerUnitPrice(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI + 1n)).toBe(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI);
  });
});

describe("computeNativeFeeQuote — the dual-fee model", () => {
  it("pins the live-floor reference figures (Normal + Fast)", () => {
    const normal = computeNativeFeeQuote({ baseLythoshi: BASE, suggestedTipLythoshi: TIP, tier: "normal", executionUnitLimit: NATIVE });
    expect(normal.perUnitPriceLythoshi).toBe(2_000_000_000n);
    expect(normal.chargeLythoshi).toBe(42_000_000_000_000n);
    expect(normal.reservationLythoshi).toBe(60_000_000_000_000n);
    expect(normal.signedFee).toEqual({ maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 30_000n });

    const fast = computeNativeFeeQuote({ baseLythoshi: BASE, suggestedTipLythoshi: TIP, tier: "fast", executionUnitLimit: NATIVE });
    expect(fast.perUnitPriceLythoshi).toBe(3_000_000_000n);
    expect(fast.chargeLythoshi).toBe(63_000_000_000_000n);
    expect(fast.reservationLythoshi).toBe(90_000_000_000_000n);
    expect(fast.signedFee).toEqual({ maxFeePerGas: 3_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, gasLimit: 30_000n });
  });

  it("charge < reserve for every (base, tip, tier) in a matrix", () => {
    const bases = [0n, BASE, 999_999_999_999_999n, 5_000_000_000_000_000n];
    const tips = [0n, TIP, 400_000_000n, 900_000_000_000_000n];
    const tiers: FeeTier[] = ["normal", "fast"];
    for (const b of bases)
      for (const t of tips)
        for (const tier of tiers) {
          const q = computeNativeFeeQuote({ baseLythoshi: b, suggestedTipLythoshi: t, tier, executionUnitLimit: NATIVE });
          expect(q.chargeLythoshi < q.reservationLythoshi).toBe(true);
        }
  });

  it("base = 0 → per-unit is the clamped tip (never below the floor)", () => {
    const q = computeNativeFeeQuote({ baseLythoshi: 0n, suggestedTipLythoshi: 0n, tier: "normal", executionUnitLimit: NATIVE });
    expect(q.perUnitPriceLythoshi).toBe(MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI);
    expect(q.signedFee.maxPriorityFeePerGas).toBe(MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI);
  });

  it("ceiling engagement: per-unit clamps to 10^15 and the tip never exceeds maxFeePerGas", () => {
    const q = computeNativeFeeQuote({ baseLythoshi: 2_000_000_000_000_000n, suggestedTipLythoshi: 900_000_000_000_000n, tier: "fast", executionUnitLimit: NATIVE });
    expect(q.perUnitPriceLythoshi).toBe(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI);
    expect(q.signedFee.maxPriorityFeePerGas <= q.signedFee.maxFeePerGas).toBe(true);
    // charge + reserve derive from the clamped price
    expect(q.chargeLythoshi).toBe(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * NATIVE_TRANSFER_CHARGE_EXECUTION_UNITS);
    expect(q.reservationLythoshi).toBe(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI * NATIVE);
  });

  it("bigint precision above 2^53 flows through with no float loss", () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1 — a float would round this
    // Exact 2× with no rounding: the intermediate arithmetic is pure bigint.
    expect(scaleByBps(huge, FEE_TIER_BPS.fast)).toBe(18_014_398_509_481_986n);
    // In a full quote the ceiling caps the per-unit price (huge itself already
    // exceeds 10^15), which is the honest bound — not a rounding artifact.
    const q = computeNativeFeeQuote({ baseLythoshi: huge, suggestedTipLythoshi: huge, tier: "fast", executionUnitLimit: NATIVE });
    expect(q.perUnitPriceLythoshi).toBe(MAX_EXECUTION_UNIT_PRICE_LYTHOSHI);
  });
});

describe("postClampResolvedFee — binds every resolver path", () => {
  it("lowers an absurd price to the ceiling and raises a sub-floor tip", () => {
    expect(postClampResolvedFee({ maxFeePerGas: 10n ** 18n, maxPriorityFeePerGas: 1n, gasLimit: 30_000n })).toEqual({
      maxFeePerGas: MAX_EXECUTION_UNIT_PRICE_LYTHOSHI,
      maxPriorityFeePerGas: MEMPOOL_PRIORITY_TIP_FLOOR_LYTHOSHI,
      gasLimit: 30_000n,
    });
  });

  it("never lets the tip exceed maxFeePerGas and never touches gasLimit", () => {
    const r = postClampResolvedFee({ maxFeePerGas: 500_000_000n, maxPriorityFeePerGas: 9_000_000_000n, gasLimit: 12_345n });
    expect(r.maxPriorityFeePerGas).toBeLessThanOrEqual(r.maxFeePerGas);
    expect(r.gasLimit).toBe(12_345n);
  });

  it("leaves an already-in-bounds fee unchanged (the common case)", () => {
    const fee = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 30_000n };
    expect(postClampResolvedFee(fee)).toEqual(fee);
  });
});
