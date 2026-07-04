import { describe, expect, it } from "vitest";
import {
  aprLabelFromBps,
  clusterActivity,
  pendingRewardForCluster,
  truncateWithMore,
} from "../delegation-cards";

describe("aprLabelFromBps — real aprBps → percent, else honest em-dash", () => {
  it("renders a real rate at 2 dp, including a genuine 0", () => {
    expect(aprLabelFromBps(0)).toBe("0.00%"); // real chain 0, NOT a placeholder
    expect(aprLabelFromBps(500)).toBe("5.00%");
    expect(aprLabelFromBps(1234)).toBe("12.34%");
    expect(aprLabelFromBps(10000)).toBe("100.00%");
  });

  it("renders '—' only when the read is unavailable (never fabricates)", () => {
    expect(aprLabelFromBps(null)).toBe("—");
    expect(aprLabelFromBps(undefined)).toBe("—");
    expect(aprLabelFromBps(NaN)).toBe("—");
    expect(aprLabelFromBps(Infinity)).toBe("—");
  });
});

describe("clusterActivity — history filtered to one cluster", () => {
  const history = [
    { cluster: 0, toCluster: null, kind: "delegated" },
    { cluster: 1, toCluster: null, kind: "delegated" },
    { cluster: 0, toCluster: 2, kind: "redelegated" }, // out of 0 → into 2
    { cluster: 3, toCluster: 0, kind: "redelegated" }, // into 0
    { cluster: 4, toCluster: 5, kind: "redelegated" },
  ];

  it("matches the source cluster or the redelegate destination", () => {
    const rows = clusterActivity(history, 0);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.kind)).toEqual(["delegated", "redelegated", "redelegated"]);
  });

  it("returns an empty list when the cluster has no events", () => {
    expect(clusterActivity(history, 9)).toEqual([]);
  });
});

describe("truncateWithMore — first N + '+N more'", () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it("shows the first N and counts the remainder", () => {
    expect(truncateWithMore(items, 5)).toEqual({ shown: [1, 2, 3, 4, 5], more: 2 });
  });

  it("shows all with more:0 when N >= length", () => {
    expect(truncateWithMore(items, 7)).toEqual({ shown: items, more: 0 });
    expect(truncateWithMore(items, 99)).toEqual({ shown: items, more: 0 });
  });

  it("handles empty + non-positive N honestly", () => {
    expect(truncateWithMore([], 5)).toEqual({ shown: [], more: 0 });
    expect(truncateWithMore(items, 0)).toEqual({ shown: [], more: 7 });
  });
});

describe("pendingRewardForCluster — pre-claim per-cluster reward view", () => {
  const rows = [
    { cluster: 1, weightBps: 3000, unsettledAmountLythoshi: "0x64" },
    { cluster: 2, weightBps: 2000, unsettledAmountLythoshi: "0x0" },
  ];

  it("returns the row for a cluster that has one", () => {
    expect(pendingRewardForCluster(rows, 1)).toEqual(rows[0]);
  });

  it("returns undefined for a cluster with no pending row (honest absence)", () => {
    expect(pendingRewardForCluster(rows, 9)).toBeUndefined();
    expect(pendingRewardForCluster(undefined, 1)).toBeUndefined();
  });
});
