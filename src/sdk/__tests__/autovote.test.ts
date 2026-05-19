// Autovote — whitepaper §23.9 four-button computation.
//
// Tests the three computed modes (max-yield, max-diversity,
// max-decentralization). Custom is a UI surface, not a function in
// this module.

import { describe, expect, it } from "vitest";
import { runAutovote } from "../autovote";
import type { ClusterSummary } from "../staking";

function mk(over: Partial<ClusterSummary>): ClusterSummary {
  return {
    clusterId: 0,
    name: "C-000",
    size: 10,
    threshold: 7,
    active: true,
    aggregateHealth: "ok",
    regionDiversity: null,
    entity: "independent",
    apr: null,
    uptime: null,
    reputation: null,
    totalStakeLyth: null,
    operatorCount: 10,
    capabilities: [],
    chainGap: null,
    ...over,
  };
}

const CLUSTERS: ClusterSummary[] = [
  mk({ clusterId: 0, name: "yield-king", apr: 0.12, uptime: 0.95, reputation: 4.0 }),
  mk({ clusterId: 1, name: "balanced", apr: 0.08, uptime: 0.99, reputation: 4.8 }),
  mk({ clusterId: 2, name: "indie", apr: 0.07, uptime: 0.97, reputation: 4.5 }),
  mk({ clusterId: 3, name: "foundation", entity: "mono-labs", apr: 0.075, uptime: 0.99, reputation: 4.5, totalStakeLyth: 10_000_000 }),
  mk({ clusterId: 4, name: "concentrated", apr: 0.085, uptime: 0.98, reputation: 4.2, totalStakeLyth: 50_000_000 }),
  mk({ clusterId: 5, name: "chain-gap", chainGap: "no data" }),  // null apr / reputation / uptime
  mk({ clusterId: 6, name: "inactive", active: false, apr: 0.20, uptime: 1.0, reputation: 5.0 }),
];

describe("runAutovote", () => {
  it("max-yield picks the highest-APR active clusters", () => {
    const result = runAutovote("max-yield", CLUSTERS, { count: 3 });
    expect(result.mode).toBe("max-yield");
    // Inactive cluster (cid 6) excluded even though APR is high.
    expect(result.allocations.map((a) => a.cluster.clusterId)).not.toContain(6);
    // Top APR (yield-king @ 12%) must be in the selection.
    expect(result.allocations.map((a) => a.cluster.clusterId)).toContain(0);
    // Chain-gapped cluster (cid 5) is in skipped, not allocations.
    expect(result.skipped).toContain(5);
    expect(result.allocations.map((a) => a.cluster.clusterId)).not.toContain(5);
  });

  it("max-diversity weights reputation + uptime, skipping fully-null rows", () => {
    const result = runAutovote("max-diversity", CLUSTERS, { count: 3 });
    expect(result.mode).toBe("max-diversity");
    expect(result.skipped).toContain(5);
    // Highest score by mean(rep/5, up): balanced (0.48 + 0.495 → 0.487)
    expect(result.allocations.map((a) => a.cluster.clusterId)).toContain(1);
  });

  it("max-decentralization deprioritises Foundation + concentrated clusters", () => {
    const result = runAutovote("max-decentralization", CLUSTERS, { count: 3 });
    expect(result.mode).toBe("max-decentralization");
    // Foundation (cid 3, entity=mono-labs) penalised — should not be
    // top of allocation.
    const ids = result.allocations.map((a) => a.cluster.clusterId);
    if (ids.includes(3)) {
      // Foundation may still appear if there aren't enough independent
      // clusters, but only after the indies.
      const fnPos = ids.indexOf(3);
      const indies = [0, 1, 2].filter((id) => ids.includes(id));
      for (const indie of indies) {
        expect(ids.indexOf(indie)).toBeLessThan(fnPos);
      }
    }
  });

  it("respects the per-cluster cap (bps) by trimming allocation rows", () => {
    const result = runAutovote("max-yield", CLUSTERS, { count: 2, capBps: 2_000 });
    // Equal split for 2 clusters of 10000 bps = 5000 each, but cap is 2000.
    expect(result.allocations).toHaveLength(2);
    for (const a of result.allocations) {
      expect(a.weightBps).toBeLessThanOrEqual(2_000);
    }
  });

  it("returns empty allocations when no clusters are eligible", () => {
    const allChainGapped = CLUSTERS.map((c) =>
      mk({ ...c, apr: null, uptime: null, reputation: null }),
    );
    const result = runAutovote("max-yield", allChainGapped, { count: 5 });
    expect(result.allocations).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it("is deterministic by default — same inputs produce same outputs", () => {
    const a = runAutovote("max-yield", CLUSTERS, { count: 3 });
    const b = runAutovote("max-yield", CLUSTERS, { count: 3 });
    expect(a.allocations.map((x) => x.cluster.clusterId)).toEqual(
      b.allocations.map((x) => x.cluster.clusterId),
    );
  });

  it("delegates randomization to the sampleStrategy when provided", () => {
    // Sampler that always reverses the bracket — verifies the seam.
    const result = runAutovote("max-yield", CLUSTERS, {
      count: 3,
      sampleStrategy: (eligible, count) =>
        [...eligible].reverse().slice(0, count),
    });
    // With reverse sampling, top of allocation is NOT cluster 0 (yield-king).
    expect(result.allocations[0]?.cluster.clusterId).not.toBe(0);
  });
});
