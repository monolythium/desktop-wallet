// The best-effort re-read that closes the stale-snapshot race.
//
// The failure it exists to prevent: delegate to a cluster, then without
// refreshing open the add-more form on the same row and delegate again. The
// mount-time snapshot still reads the pre-delegation weight, the verdict passes,
// and the wallet signs a guaranteed refusal.
//
// The direction it fails is the opposite of the destination check, and
// deliberately so. A stale cap producing a false pass costs an admission
// refusal, which is free — value = 0, nothing charged, and the failure is
// already recorded and named. A failed read producing a false block would deny a
// legitimate non-custodial action with no chain-side confirmation the block was
// right. So every unresolved read keeps the snapshot and proceeds.

import { describe, expect, it } from "vitest";
import {
  DELEGATION_REREAD_TIMEOUT_MS,
  LATE_REFUSAL_PREFIX,
  lateRefusalMessage,
  refreshDelegationSnapshot,
  type DelegationSnapshot,
} from "../delegation-preflight";

const SNAPSHOT: DelegationSnapshot = {
  rows: [{ cluster: 1, weightBps: 2000 }],
  totalBps: 2000,
  aggregateCapBps: null,
};

const freshStatus = (rows: Array<{ cluster: number; weightBps: number }>, totalBps: number) => ({
  delegations: { ok: true as const, value: { rows, totalBps } },
  delegationCap: { ok: true as const, value: { capBps: 3000 } },
});

describe("refreshDelegationSnapshot", () => {
  it("takes the fresher rows and total when the read resolves", async () => {
    const r = await refreshDelegationSnapshot({
      snapshot: SNAPSHOT,
      read: async () => freshStatus([{ cluster: 1, weightBps: 4000 }], 4000),
    });
    expect(r.source).toBe("fresh");
    expect(r.snapshot.rows).toEqual([{ cluster: 1, weightBps: 4000 }]);
    expect(r.snapshot.totalBps).toBe(4000);
  });

  it("takes a fresher aggregate cap, normalised", async () => {
    const r = await refreshDelegationSnapshot({
      snapshot: SNAPSHOT,
      read: async () => freshStatus([], 0),
    });
    expect(r.snapshot.aggregateCapBps).toBe(3000);
  });

  it("normalises the disabled sentinel rather than trusting it as a cap", async () => {
    const r = await refreshDelegationSnapshot({
      snapshot: SNAPSHOT,
      read: async () => ({
        delegations: { ok: true as const, value: { rows: [], totalBps: 0 } },
        delegationCap: { ok: true as const, value: { capBps: 0xffffffff } },
      }),
    });
    expect(r.snapshot.aggregateCapBps).toBeNull();
  });

  describe("failing OPEN — every unresolved read keeps the snapshot", () => {
    it("keeps the snapshot when the read rejects", async () => {
      const r = await refreshDelegationSnapshot({
        snapshot: SNAPSHOT,
        read: async () => {
          throw new Error("refusing to use an untrusted operator");
        },
      });
      expect(r.source).toBe("snapshot");
      expect(r.snapshot).toEqual(SNAPSHOT);
    });

    it("keeps the snapshot when the read outruns its bound", async () => {
      const r = await refreshDelegationSnapshot({
        snapshot: SNAPSHOT,
        read: () => new Promise(() => {}), // never settles
        timeoutMs: 10,
      });
      expect(r.source).toBe("snapshot");
      expect(r.snapshot).toEqual(SNAPSHOT);
    });

    it("keeps the snapshot when the delegations read itself failed", async () => {
      const r = await refreshDelegationSnapshot({
        snapshot: SNAPSHOT,
        read: async () => ({
          delegations: { ok: false as const, error: "node error" },
          delegationCap: { ok: true as const, value: { capBps: 3000 } },
        }),
      });
      expect(r.source).toBe("snapshot");
      expect(r.snapshot).toEqual(SNAPSHOT);
    });

    it("never fabricates rows from an absent value", async () => {
      const r = await refreshDelegationSnapshot({
        snapshot: SNAPSHOT,
        read: async () => ({
          delegations: { ok: true as const, value: null },
          delegationCap: { ok: true as const, value: { capBps: 3000 } },
        }),
      });
      expect(r.source).toBe("snapshot");
      expect(r.snapshot.rows).toEqual(SNAPSHOT.rows);
    });
  });

  it("keeps the snapshot cap when only the cap read failed, but still takes fresh rows", async () => {
    // The rows are what race; a cap that could not be re-read is no reason to
    // discard a fresher view of the weight.
    const r = await refreshDelegationSnapshot({
      snapshot: { ...SNAPSHOT, aggregateCapBps: 4200 },
      read: async () => ({
        delegations: { ok: true as const, value: { rows: [{ cluster: 1, weightBps: 4000 }], totalBps: 4000 } },
        delegationCap: { ok: false as const, error: "node error" },
      }),
    });
    expect(r.snapshot.totalBps).toBe(4000);
    expect(r.snapshot.aggregateCapBps).toBe(4200);
  });

  it("bounds the wait by default rather than waiting indefinitely", () => {
    expect(DELEGATION_REREAD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DELEGATION_REREAD_TIMEOUT_MS).toBeLessThanOrEqual(2_500);
  });
});

// The verdict re-run after the passphrase unlock. Re-checking at Review only
// narrows the window; the unlock interaction sits between that check and the
// signature, so the last word belongs immediately before signing.
describe("lateRefusalMessage", () => {
  const VERDICT = "This would exceed your total delegation limit (100%) — reduce the amount.";

  it("keeps the verdict's own words", () => {
    expect(lateRefusalMessage(VERDICT)).toContain(VERDICT);
  });

  it("says why the refusal arrived late, so it is not read as a chain rejection", () => {
    // The gap-check recorded that the wallet cannot otherwise tell a local
    // refusal from a chain one. This is the distinguishing mark.
    expect(lateRefusalMessage(VERDICT)).toContain(LATE_REFUSAL_PREFIX);
    expect(lateRefusalMessage(VERDICT)).not.toBe(VERDICT);
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    // classifySendError matches "revert" as a substring and would replace the
    // text with a generic "Transaction reverted" body.
    expect(lateRefusalMessage(VERDICT).toLowerCase()).not.toContain("revert");
  });
});
