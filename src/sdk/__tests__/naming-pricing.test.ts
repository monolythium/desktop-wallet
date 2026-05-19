// U-shaped pricing table tests — every cell of §22.8 Table A × Table B.
//
// `baseTxFee` is pinned at 1e15 wei (= 0.001 LYTH) for these tests; with
// human (5×) at 6-12ch (1×) the result is exactly 5e15 wei = 0.005 LYTH,
// which is the sweet-spot baseline.

import { describe, expect, it } from "vitest";
import {
  CATEGORY_MULTIPLIER,
  PricingError,
  calculatePrice,
  calculatePriceBreakdown,
  lengthModifier,
} from "../naming-pricing";

const BASE_FEE = 1_000_000_000_000_000n; // 1e15 wei = 0.001 LYTH

describe("naming-pricing · lengthModifier", () => {
  it.each([
    [1, 100],
    [2, 50],
    [3, 10],
    [4, 5],
    [5, 3],
    [6, 1],
    [12, 1],
    [13, 1.5],
    [20, 1.5],
    [21, 3],
    [32, 3],
    [33, 10],
    [50, 10],
    [51, 50],
    [63, 50],
  ] as Array<[number, number]>)("length %i → %fx", (len, expected) => {
    expect(lengthModifier(len)).toBe(expected);
  });

  it("throws PricingError on 64+ char", () => {
    expect(() => lengthModifier(64)).toThrow(PricingError);
    expect(() => lengthModifier(100)).toThrow(PricingError);
  });

  it("throws PricingError on zero / negative / non-finite", () => {
    expect(() => lengthModifier(0)).toThrow(PricingError);
    expect(() => lengthModifier(-5)).toThrow(PricingError);
    expect(() => lengthModifier(Number.NaN)).toThrow(PricingError);
  });
});

describe("naming-pricing · CATEGORY_MULTIPLIER", () => {
  it("matches §22.8 Table A", () => {
    expect(CATEGORY_MULTIPLIER.human).toBe(5);
    expect(CATEGORY_MULTIPLIER.agent).toBe(2);
    expect(CATEGORY_MULTIPLIER.cluster).toBe(20);
    expect(CATEGORY_MULTIPLIER.contract).toBe(10);
    // System is intentionally NaN — the calculator throws before
    // reaching this slot for the system TLD.
    expect(Number.isNaN(CATEGORY_MULTIPLIER.system)).toBe(true);
  });
});

describe("naming-pricing · calculatePrice", () => {
  it("computes the sweet-spot price (human · 7ch)", () => {
    // 5 × 1 × 1e15 = 5e15 wei
    const wei = calculatePrice("genuine", "human", BASE_FEE);
    expect(wei).toBe(5_000_000_000_000_000n);
  });

  it("applies the 1-char vanity penalty (human)", () => {
    // 5 × 100 × 1e15 = 500e15 = 5e17
    const wei = calculatePrice("a", "human", BASE_FEE);
    expect(wei).toBe(500_000_000_000_000_000n);
  });

  it("applies the fractional 1.5× band (13-20ch) exactly", () => {
    // 5 × 1.5 × 1e15 = 7.5e15
    const wei = calculatePrice("a-13-char-name", "human", BASE_FEE);
    expect(wei).toBe(7_500_000_000_000_000n);
  });

  it("prices a cluster name at 20× the category multiplier", () => {
    // 20 × 1 × 1e15 = 2e16
    const wei = calculatePrice("primary", "cluster", BASE_FEE);
    expect(wei).toBe(20_000_000_000_000_000n);
  });

  it("prices a contract name at 10× the category multiplier", () => {
    const wei = calculatePrice("bridge", "contract", BASE_FEE);
    expect(wei).toBe(10_000_000_000_000_000n);
  });

  it("prices an agent name at 2× the category multiplier", () => {
    const wei = calculatePrice("worker", "agent", BASE_FEE);
    expect(wei).toBe(2_000_000_000_000_000n);
  });

  it("throws PricingError(system_forbidden) for system TLD", () => {
    try {
      calculatePrice("foundation", "system", BASE_FEE);
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(PricingError);
      expect((cause as PricingError).code).toBe("system_forbidden");
    }
  });

  it("throws PricingError(forbidden_length) at >=64 chars", () => {
    try {
      calculatePrice("a".repeat(64), "human", BASE_FEE);
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(PricingError);
      expect((cause as PricingError).code).toBe("forbidden_length");
    }
  });

  it("scales linearly with baseTxFee", () => {
    const a = calculatePrice("name", "human", BASE_FEE); // 5×5
    const b = calculatePrice("name", "human", BASE_FEE * 3n);
    expect(b).toBe(a * 3n);
  });
});

describe("naming-pricing · calculatePriceBreakdown", () => {
  it("returns the wei + decimal LYTH + multipliers", () => {
    const br = calculatePriceBreakdown({
      label: "alice",
      category: "human",
      baseTxFee: BASE_FEE,
    });
    expect(br.wei).toBe(15_000_000_000_000_000n); // 5 × 3 × 1e15
    expect(br.lyth).toBeCloseTo(0.015);
    expect(br.categoryMultiplier).toBe(5);
    expect(br.lengthModifier).toBe(3);
  });
});
