// THE INVARIANT THIS PASS EXISTS NOT TO BREAK.
//
// A batch is not N independent delegations. Each allocation stacks onto the
// wallet's running total and, when it opens a new row, onto the running row
// count. So a plan whose allocations are individually acceptable can still be
// refused for its cumulative effect — and that is the whole reason the batch is
// safe today.
//
// These are deliberately narrow, mechanical pins, written BEFORE the batch gains
// any new guard, so that a later change which quietly drops the accumulation
// fails here rather than on chain. Mutation-verified: removing either running
// value turns these red.

import { describe, expect, it } from "vitest";
import { lateBatchVerdict, preflightAutovotePlan } from "../autovote";

const alloc = (clusterId: number, weightBps: number) => ({ clusterId, weightBps });

describe("preflightAutovotePlan — the running TOTAL accumulates", () => {
  it("refuses a plan whose allocations are each fine but together exceed 100%", () => {
    // Three 4000 bps allocations: each is under the 5000 per-cluster cap and
    // each alone fits the wallet total. Together they reach 12000.
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 4000), alloc(2, 4000), alloc(3, 4000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
    });
    expect(r.ok).toBe(false);
    // It is the THIRD that breaks the total — proving the first two were carried
    // forward rather than each judged against a static zero.
    expect(r.clusterId).toBe(3);
  });

  it("accepts the same allocations when their sum fits", () => {
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 3000), alloc(2, 3000), alloc(3, 3000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
    });
    expect(r.ok).toBe(true);
  });

  it("carries the wallet's pre-existing total into the accumulation", () => {
    // Already at 60%: two 3000 bps allocations reach 12000.
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 3000), alloc(2, 3000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 6000,
      capBps: null,
    });
    expect(r.ok).toBe(false);
    expect(r.clusterId).toBe(2);
  });
});

describe("preflightAutovotePlan — the running ROW COUNT accumulates", () => {
  it("refuses the eleventh row a plan opens from a base of eight", () => {
    // Three NEW clusters from a base of eight reaches eleven; the chain refuses
    // the eleventh even though each allocation looked fine alone.
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 100), alloc(2, 100), alloc(3, 100)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
      currentDelegationCount: 8,
    });
    expect(r.ok).toBe(false);
    expect(r.clusterId).toBe(3);
  });

  it("allows two new rows from a base of eight", () => {
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 100), alloc(2, 100)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
      currentDelegationCount: 8,
    });
    expect(r.ok).toBe(true);
  });

  it("does not count a top-up as a new row, even at the limit", () => {
    // A3/A4: the count moves only when a row is actually opened.
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 100), alloc(2, 100)],
      existingWeightByCluster: new Map([
        [1, 500],
        [2, 500],
      ]),
      currentTotalBps: 1000,
      capBps: null,
      currentDelegationCount: 10,
    });
    expect(r.ok).toBe(true);
  });

  it("skips the row check entirely when the count is unknown", () => {
    // A4: an undefined count is never guessed at.
    const r = preflightAutovotePlan({
      allocations: [alloc(1, 100), alloc(2, 100), alloc(3, 100)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
    });
    expect(r.ok).toBe(true);
  });
});

// The post-unlock re-check, and why it is all-or-nothing.
//
// The single paths re-run the verdict after the unlock. A batch cannot do that
// per call: a refusal BETWEEN submits leaves part of the plan on chain with no
// clean recovery and nothing coherent to tell the user. The one moment with a
// clean failure story is before the FIRST submit, where refusing costs nothing.
describe("lateBatchVerdict", () => {
  it("passes a plan that still fits the fresher state", () => {
    const r = lateBatchVerdict({
      allocations: [alloc(1, 1000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses the WHOLE plan when the fresher state no longer allows it", () => {
    // The wallet moved to 95% while the drawer was open.
    const r = lateBatchVerdict({
      allocations: [alloc(1, 1000), alloc(2, 1000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 9500,
      capBps: null,
    });
    expect(r.ok).toBe(false);
  });

  it("still accumulates — it is the same gate, not a looser one", () => {
    // Individually fine, cumulatively over: the invariant must survive here too.
    const r = lateBatchVerdict({
      allocations: [alloc(1, 4000), alloc(2, 4000), alloc(3, 4000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.clusterId).toBe(3);
  });

  it("says the state changed, so a late refusal is not read as a chain rejection", () => {
    const r = lateBatchVerdict({
      allocations: [alloc(1, 1000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 9500,
      capBps: null,
    });
    expect(r.ok === false && r.message).toContain("changed");
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    const r = lateBatchVerdict({
      allocations: [alloc(1, 1000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 9500,
      capBps: null,
    });
    expect(r.ok === false && r.message.toLowerCase()).not.toContain("revert");
  });
});
