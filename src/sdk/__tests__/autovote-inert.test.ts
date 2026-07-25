// The inert check for a batch — and why it is not the single-path check run N
// times.
//
// A plan spreads a budget across clusters, so each allocation is a FRACTION of
// the budget. At a modest balance a split that looks reasonable can make every
// allocation credit zero whole LYTH: the plan passes every cap, costs N fees, and
// does nothing anywhere. That failure only exists because the weight was divided,
// so it is a property of the plan, not of any one allocation.
//
// Detection is therefore per-allocation and the verdict is plan-level, and the
// advice has to be plan-level too: "use at least m bps" is unfollowable when the
// budget cannot give m to every cluster.

import { describe, expect, it } from "vitest";
import { autovoteInertVerdict } from "../autovote";

const ONE = 10n ** 18n;
const lythoshi = (whole: bigint) => (whole * ONE).toString();
const alloc = (clusterId: number, weightBps: number) => ({ clusterId, weightBps });

describe("autovoteInertVerdict", () => {
  it("passes a plan whose every allocation credits at least one whole LYTH", () => {
    // 1000 LYTH: 2500 bps each credits 250 LYTH.
    const r = autovoteInertVerdict({
      allocations: [alloc(1, 2500), alloc(2, 2500)],
      balanceLythoshi: lythoshi(1000n),
    });
    expect(r).toEqual({ ok: true });
  });

  it("refuses when every allocation credits nothing — the budget-split trap", () => {
    // 2 LYTH, 5000 bps over 4 clusters = 1250 each → 0.25 LYTH each → all zero.
    const r = autovoteInertVerdict({
      allocations: [alloc(1, 1250), alloc(2, 1250), alloc(3, 1250), alloc(4, 1250)],
      balanceLythoshi: lythoshi(2n),
    });
    expect(r.ok).toBe(false);
    expect(r.inertClusterIds).toEqual([1, 2, 3, 4]);
  });

  it("refuses when only some allocations credit nothing, and names those", () => {
    // 4 LYTH: min is 2500 bps. 3000 credits 1 LYTH; 1000 credits 0.4 → inert.
    const r = autovoteInertVerdict({
      allocations: [alloc(1, 3000), alloc(2, 1000), alloc(3, 4000)],
      balanceLythoshi: lythoshi(4n),
    });
    expect(r.ok).toBe(false);
    expect(r.inertClusterIds).toEqual([2]);
  });

  describe("the advice is plan-level, because the remedy is", () => {
    it("says how many clusters this budget can actually support", () => {
      // 2 LYTH → min 5000 bps. A 5000 bps budget supports exactly 1 cluster.
      const r = autovoteInertVerdict({
        allocations: [alloc(1, 1250), alloc(2, 1250), alloc(3, 1250), alloc(4, 1250)],
        balanceLythoshi: lythoshi(2n),
      });
      expect(r.message).toContain("5000");
      expect(r.message).toContain("1 cluster");
    });

    it("does not tell the user to use a per-cluster weight the budget cannot give", () => {
      // The single-path advice "use at least m bps" is unfollowable across a
      // split: 4 x 5000 would be 20000 bps of a 10000 bps wallet.
      const r = autovoteInertVerdict({
        allocations: [alloc(1, 1250), alloc(2, 1250), alloc(3, 1250), alloc(4, 1250)],
        balanceLythoshi: lythoshi(2n),
      });
      expect(r.message).not.toContain("Use at least");
    });

    it("says plainly when no split of this budget can credit anything", () => {
      // 0.5 LYTH: no weight up to 100% reaches one whole LYTH, so no split does.
      const r = autovoteInertVerdict({
        allocations: [alloc(1, 5000), alloc(2, 5000)],
        balanceLythoshi: (ONE / 2n).toString(),
      });
      expect(r.ok).toBe(false);
      expect(r.message?.toLowerCase()).toContain("balance");
      expect(r.message).not.toContain("NaN");
      expect(r.message).not.toContain("null");
    });
  });

  describe("failing OPEN — an unevaluable condition never refuses", () => {
    it("passes when the balance cannot be read", () => {
      // A6: null means CANNOT TEST, never inert.
      for (const b of [null, undefined, "", "not-a-number"]) {
        expect(
          autovoteInertVerdict({
            allocations: [alloc(1, 1), alloc(2, 1)],
            balanceLythoshi: b,
          }).ok,
        ).toBe(true);
      }
    });

    it("passes at a zero balance — there is nothing to round down", () => {
      expect(
        autovoteInertVerdict({
          allocations: [alloc(1, 5000)],
          balanceLythoshi: "0",
        }).ok,
      ).toBe(true);
    });

    it("passes an empty plan — emptiness is the caller's own refusal", () => {
      expect(
        autovoteInertVerdict({ allocations: [], balanceLythoshi: lythoshi(1n) }),
      ).toEqual({ ok: true });
    });
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    const r = autovoteInertVerdict({
      allocations: [alloc(1, 1250), alloc(2, 1250)],
      balanceLythoshi: lythoshi(2n),
    });
    expect(r.message?.toLowerCase()).not.toContain("revert");
  });
});
