import { describe, expect, it } from "vitest";
import {
  DELEGATION_PER_WALLET_CAP_BPS,
  bindingPerClusterCapBps,
  delegateCapWarning,
  normalizeAggregateCapBps,
  preflightDelegationVerdict,
} from "../delegation-caps";

describe("normalizeAggregateCapBps", () => {
  it("maps the u32::MAX disabled sentinel + absent/non-finite to null (no fabricated cap)", () => {
    expect(normalizeAggregateCapBps(0xffffffff)).toBeNull();
    expect(normalizeAggregateCapBps(null)).toBeNull();
    expect(normalizeAggregateCapBps(undefined)).toBeNull();
    expect(normalizeAggregateCapBps(Number.NaN)).toBeNull();
  });
  it("passes a real aggregate cap through", () => {
    expect(normalizeAggregateCapBps(3000)).toBe(3000);
  });
});

describe("bindingPerClusterCapBps", () => {
  it("fails closed to the 5000 (50%) floor when no aggregate cap", () => {
    expect(bindingPerClusterCapBps(null)).toBe(5000);
    expect(DELEGATION_PER_WALLET_CAP_BPS).toBe(5000);
  });
  it("tightens to a smaller aggregate cap but never lifts the floor", () => {
    expect(bindingPerClusterCapBps(3000)).toBe(3000);
    expect(bindingPerClusterCapBps(8000)).toBe(5000);
  });
});

describe("delegateCapWarning", () => {
  const base = { totalDelegatedBps: 0, aggregateCapBps: null as number | null };

  it("below cap → only the always-on note, no warning", () => {
    const r = delegateCapWarning({ ...base, existingWeightBps: 0, additionalBps: 1000 });
    expect(r.note).toBe("Per-wallet limit: 50% to any one cluster.");
    expect(r.warning).toBeNull();
  });

  it("already at the per-cluster cap → cap-reached warning (any amount)", () => {
    const r = delegateCapWarning({ ...base, existingWeightBps: 5000, additionalBps: 100 });
    expect(r.warning).toMatch(/already delegated the 50% per-cluster maximum/);
  });

  it("over the per-cluster cap → overage warning with the exact excess", () => {
    const r = delegateCapWarning({ ...base, existingWeightBps: 4000, additionalBps: 2000 });
    expect(r.warning).toBe(
      "Delegation would exceed the 50% per-wallet cap for one cluster by 10.00%.",
    );
  });

  it("over the global 100% total → global-headroom warning", () => {
    const r = delegateCapWarning({
      existingWeightBps: 0,
      totalDelegatedBps: 9000,
      additionalBps: 2000,
      aggregateCapBps: null,
    });
    expect(r.warning).toBe(
      "You can delegate at most 10.00% more — total delegation across all clusters can't exceed 100%.",
    );
  });

  it("no warning while the input isn't a positive amount yet", () => {
    expect(delegateCapWarning({ ...base, existingWeightBps: 0, additionalBps: null }).warning).toBeNull();
  });
});

describe("preflightDelegationVerdict", () => {
  it("blocks a delegate that exceeds the per-cluster cap", () => {
    const v = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 4500,
      totalDelegatedBps: 4500,
      moveBps: 1000,
      capBps: null,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/50% per-wallet cap/);
  });

  it("blocks a delegate that exceeds the global 100% total", () => {
    const v = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 0,
      totalDelegatedBps: 9500,
      moveBps: 1000,
      capBps: null,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/total delegation limit \(100%\)/);
  });

  it("allows a within-cap delegate, and never blocks an undelegate", () => {
    expect(
      preflightDelegationVerdict({
        action: "delegate",
        dstExistingWeightBps: 1000,
        totalDelegatedBps: 1000,
        moveBps: 1000,
        capBps: null,
      }).ok,
    ).toBe(true);
    expect(
      preflightDelegationVerdict({
        action: "undelegate",
        dstExistingWeightBps: 9999,
        totalDelegatedBps: 10000,
        moveBps: 5000,
        capBps: null,
      }).ok,
    ).toBe(true);
  });
});
