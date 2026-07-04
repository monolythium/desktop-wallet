import { describe, expect, it } from "vitest";
import {
  activeDelegationsSummary,
  effectiveWeightLythDisplay,
  effectiveWeightLythoshi,
} from "../delegation-derive";

// 965.9882 LYTH in lythoshi — the spec's worked example (× 50% → 482.9941 LYTH).
const BALANCE = "965988200000000000000";

describe("effectiveWeightLythoshi — derived floor(balance × bps / 10000)", () => {
  it("derives the weighted lythoshi", () => {
    expect(effectiveWeightLythoshi(BALANCE, 5000)).toBe("482994100000000000000");
    expect(effectiveWeightLythoshi(BALANCE, 10000)).toBe(BALANCE);
    expect(effectiveWeightLythoshi(BALANCE, 0)).toBe("0");
  });

  it("floors (never rounds) the integer division", () => {
    expect(effectiveWeightLythoshi("1", 5000)).toBe("0"); // 0.5 → 0
    expect(effectiveWeightLythoshi("3", 5000)).toBe("1"); // 1.5 → 1
  });

  it("returns null (→ bps-only fallback) when the balance is absent/undecodable", () => {
    expect(effectiveWeightLythoshi(null, 5000)).toBeNull();
    expect(effectiveWeightLythoshi(undefined, 5000)).toBeNull();
    expect(effectiveWeightLythoshi("", 5000)).toBeNull();
    expect(effectiveWeightLythoshi("   ", 5000)).toBeNull();
    expect(effectiveWeightLythoshi("not-a-number", 5000)).toBeNull();
    expect(effectiveWeightLythoshi("-5", 5000)).toBeNull();
  });

  it("returns null for a malformed bps", () => {
    expect(effectiveWeightLythoshi(BALANCE, -1)).toBeNull();
    expect(effectiveWeightLythoshi(BALANCE, 1.5)).toBeNull();
  });
});

describe("effectiveWeightLythDisplay — 4-dp LYTH or null", () => {
  it("formats the derived weight at 4 dp (matches the spec examples)", () => {
    expect(effectiveWeightLythDisplay(BALANCE, 5000)).toBe("482.9941");
    expect(effectiveWeightLythDisplay(BALANCE, 10000)).toBe("965.9882");
  });

  it("caps at the caller's precision (2 dp)", () => {
    expect(effectiveWeightLythDisplay(BALANCE, 10000, 2)).toBe("965.98");
  });

  it("is null when the balance is unavailable (caller shows bps-only)", () => {
    expect(effectiveWeightLythDisplay(null, 5000)).toBeNull();
    expect(effectiveWeightLythDisplay("bad", 5000)).toBeNull();
  });
});

describe("activeDelegationsSummary", () => {
  it("counts weighted clusters and labels the real totalBps", () => {
    expect(
      activeDelegationsSummary([{ weightBps: 5000 }, { weightBps: 5000 }], 10000),
    ).toEqual({ count: 2, totalBps: 10000, percentLabel: "100.00%" });
  });

  it("ignores zero-weight rows in the count", () => {
    expect(
      activeDelegationsSummary([{ weightBps: 5000 }, { weightBps: 0 }], 5000),
    ).toEqual({ count: 1, totalBps: 5000, percentLabel: "50.00%" });
  });

  it("is honest at zero (no delegations)", () => {
    expect(activeDelegationsSummary([], 0)).toEqual({
      count: 0,
      totalBps: 0,
      percentLabel: "0.00%",
    });
  });
});
