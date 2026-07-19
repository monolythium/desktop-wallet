// The ten-row delegation limit.
//
// The chain counts delegation ROWS, not weight. That distinction is the whole
// test: blocking an eleventh distinct cluster is correct, and blocking a top-up
// of a cluster the wallet already delegates to would deny an action the chain
// permits — refusing the user something they are entitled to do, which is worse
// than letting the chain refuse it.
//
// A redelegate counts as well, and that is the non-obvious one: the chain opens
// the destination row before it frees the source, so moving weight to an
// eleventh cluster reverts even though the row total afterwards would be ten.

import { describe, expect, it, vi } from "vitest";
import {
  MAX_DELEGATIONS_PER_WALLET,
  PER_WALLET_CAP_REVERT_MESSAGE,
  TOO_MANY_DELEGATIONS_MESSAGE,
  WALLET_TOTAL_CAP_REVERT_MESSAGE,
  opensNewDelegationRowAtLimit,
  preflightDelegationVerdict,
} from "../delegation-caps";
import { preflightAutovotePlan } from "../autovote";

/** A verdict request with room everywhere, so a single field can be varied. */
function args(over: Partial<Parameters<typeof preflightDelegationVerdict>[0]> = {}) {
  return {
    action: "delegate" as const,
    dstExistingWeightBps: 0,
    totalDelegatedBps: 0,
    moveBps: 100,
    capBps: null,
    ...over,
  };
}

describe("opensNewDelegationRowAtLimit", () => {
  it("is true only for a new row at the limit", () => {
    expect(opensNewDelegationRowAtLimit(0, MAX_DELEGATIONS_PER_WALLET)).toBe(true);
    expect(opensNewDelegationRowAtLimit(0, MAX_DELEGATIONS_PER_WALLET + 5)).toBe(true);
  });

  it("is false below the limit", () => {
    expect(opensNewDelegationRowAtLimit(0, MAX_DELEGATIONS_PER_WALLET - 1)).toBe(false);
    expect(opensNewDelegationRowAtLimit(0, 0)).toBe(false);
  });

  it("is false for a TOP-UP even at the limit", () => {
    // The row already exists; the chain opens nothing.
    expect(opensNewDelegationRowAtLimit(1, MAX_DELEGATIONS_PER_WALLET)).toBe(false);
    expect(opensNewDelegationRowAtLimit(5000, MAX_DELEGATIONS_PER_WALLET)).toBe(false);
  });

  it("is false when the count is unknown — skipped, never guessed", () => {
    expect(opensNewDelegationRowAtLimit(0, undefined)).toBe(false);
  });
});

describe("P3 — the preflight blocks a new row and allows a top-up", () => {
  it("BLOCKS an eleventh distinct cluster with the verbatim copy", () => {
    const v = preflightDelegationVerdict(
      args({ dstExistingWeightBps: 0, currentDelegationCount: 10 }),
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toBe(TOO_MANY_DELEGATIONS_MESSAGE);
  });

  it("ALLOWS a top-up of an existing cluster at ten rows", () => {
    const v = preflightDelegationVerdict(
      args({ dstExistingWeightBps: 1000, currentDelegationCount: 10 }),
    );
    expect(v.ok).toBe(true);
  });

  it("ALLOWS a new row at nine", () => {
    expect(
      preflightDelegationVerdict(args({ dstExistingWeightBps: 0, currentDelegationCount: 9 })).ok,
    ).toBe(true);
  });

  it("SKIPS the check entirely when the count is omitted", () => {
    // A caller that cannot determine the count must not be blocked by a guess.
    expect(preflightDelegationVerdict(args({ dstExistingWeightBps: 0 })).ok).toBe(true);
  });

  it("counts a REDELEGATE destination", () => {
    // The destination row opens before the source frees.
    const v = preflightDelegationVerdict(
      args({ action: "redelegate", dstExistingWeightBps: 0, currentDelegationCount: 10 }),
    );
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toBe(TOO_MANY_DELEGATIONS_MESSAGE);
  });

  it("allows a redelegate INTO an existing row at ten", () => {
    expect(
      preflightDelegationVerdict(
        args({ action: "redelegate", dstExistingWeightBps: 2000, currentDelegationCount: 10 }),
      ).ok,
    ).toBe(true);
  });

  it("never blocks an undelegate, whatever the count", () => {
    expect(
      preflightDelegationVerdict(
        args({ action: "undelegate", dstExistingWeightBps: 0, currentDelegationCount: 99 }),
      ).ok,
    ).toBe(true);
  });
});

describe("the pinned check order", () => {
  it("undelegate short-circuits every other check", () => {
    const v = preflightDelegationVerdict({
      action: "undelegate",
      dstExistingWeightBps: 5000,
      totalDelegatedBps: 10_000,
      moveBps: 10_000,
      capBps: null,
      currentDelegationCount: 50,
    });
    expect(v.ok).toBe(true);
  });

  it("the row limit fires BEFORE the per-cluster cap", () => {
    // Both would block; the row limit is the structural refusal, so it is the
    // one that names what the user must actually do.
    const v = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 0,
      totalDelegatedBps: 0,
      moveBps: 9_000, // over the 5000 per-cluster floor
      capBps: null,
      currentDelegationCount: 10,
    });
    expect(v.ok === false && v.message).toBe(TOO_MANY_DELEGATIONS_MESSAGE);
  });

  it("the per-cluster cap fires BEFORE the wallet total", () => {
    const v = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 4_900,
      totalDelegatedBps: 9_900,
      moveBps: 200, // breaches both
      capBps: null,
      currentDelegationCount: 1,
    });
    expect(v.ok === false && v.message).toBe(PER_WALLET_CAP_REVERT_MESSAGE);
  });

  it("the wallet total is additive for a DELEGATE only", () => {
    const overTotal = {
      dstExistingWeightBps: 0,
      totalDelegatedBps: 10_000,
      moveBps: 100,
      capBps: null,
      currentDelegationCount: 1,
    };
    expect(
      preflightDelegationVerdict({ ...overTotal, action: "delegate" }).ok,
    ).toBe(false);
    // A redelegate MOVES weight — the wallet total is unchanged.
    expect(
      preflightDelegationVerdict({ ...overTotal, action: "redelegate" }).ok,
    ).toBe(true);
  });

  it("still reports the wallet-total message when only that check trips", () => {
    const v = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 0,
      totalDelegatedBps: 10_000,
      moveBps: 100,
      capBps: null,
      currentDelegationCount: 1,
    });
    expect(v.ok === false && v.message).toBe(WALLET_TOTAL_CAP_REVERT_MESSAGE);
  });
});

describe("the autovote batch accumulates the row count", () => {
  const alloc = (clusterId: number, weightBps: number) => ({ clusterId, weightBps });

  it("blocks the allocation that opens the eleventh row", () => {
    // Eight rows already; the plan opens three more, so the third is the one
    // that reverts even though each looked fine on its own.
    const v = preflightAutovotePlan({
      allocations: [alloc(101, 100), alloc(102, 100), alloc(103, 100)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
      currentDelegationCount: 8,
    });
    expect(v.ok).toBe(false);
    expect(v.clusterId).toBe(103);
    expect(v.message).toBe(TOO_MANY_DELEGATIONS_MESSAGE);
  });

  it("does NOT count top-ups toward the accumulation", () => {
    // Ten rows, and every allocation tops up an existing one — all allowed.
    const existing = new Map([
      [1, 100],
      [2, 100],
    ]);
    const v = preflightAutovotePlan({
      allocations: [alloc(1, 100), alloc(2, 100)],
      existingWeightByCluster: existing,
      currentTotalBps: 0,
      capBps: null,
      currentDelegationCount: 10,
    });
    expect(v.ok).toBe(true);
  });

  it("skips the row check when the count is omitted", () => {
    const v = preflightAutovotePlan({
      allocations: [alloc(1, 100), alloc(2, 100), alloc(3, 100)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
    });
    expect(v.ok).toBe(true);
  });

  it("still enforces the caps it always did", () => {
    const v = preflightAutovotePlan({
      allocations: [alloc(1, 6_000)],
      existingWeightByCluster: new Map(),
      currentTotalBps: 0,
      capBps: null,
      currentDelegationCount: 0,
    });
    expect(v.ok).toBe(false);
    expect(v.message).toBe(PER_WALLET_CAP_REVERT_MESSAGE);
  });
});

describe("P4 — a blocked verdict never reaches the signer", () => {
  it("the caller returns before submitting", async () => {
    // The shape every call site follows: verdict first, submit only on ok.
    const submit = vi.fn(async () => ({ txHash: "0x1", nonce: 0 }));
    const runGuarded = async (count: number, dstExisting: number) => {
      const verdict = preflightDelegationVerdict(
        args({ dstExistingWeightBps: dstExisting, currentDelegationCount: count }),
      );
      if (!verdict.ok) return verdict.message;
      await submit();
      return null;
    };

    expect(await runGuarded(10, 0)).toBe(TOO_MANY_DELEGATIONS_MESSAGE);
    expect(submit).not.toHaveBeenCalled();

    expect(await runGuarded(10, 500)).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
