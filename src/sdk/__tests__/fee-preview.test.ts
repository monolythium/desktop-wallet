import { describe, expect, it } from "vitest";
import { formatLyth } from "@monolythium/core-sdk";
import { maxFeeLythoshiFrom, totalReservedLyth } from "../fee-preview";

describe("maxFeeLythoshiFrom", () => {
  it("multiplies the per-unit cap by the execution-unit limit", () => {
    const fee = { maxFeePerGas: 2000n, maxPriorityFeePerGas: 2000n, gasLimit: 100_000n };
    expect(maxFeeLythoshiFrom(fee)).toBe(200_000_000n);
  });
});

describe("totalReservedLyth", () => {
  it("sums amount + max fee and formats as LYTH", () => {
    const amount = 150_000_000n; // 1.5 LYTH (8 decimals)
    const maxFee = 200_000_000n; // 2 LYTH
    const total = totalReservedLyth(amount, maxFee);
    expect(total).toBe(formatLyth((amount + maxFee).toString(), { includeUnit: false }));
    // 1.5 + 2 = 3.5 LYTH
    expect(Number(total.replace(/,/g, ""))).toBeCloseTo(3.5, 6);
  });

  it("handles a zero amount (fee-only reservation)", () => {
    const total = totalReservedLyth(0n, 200_000_000n);
    expect(Number(total.replace(/,/g, ""))).toBeCloseTo(2, 6);
  });
});
