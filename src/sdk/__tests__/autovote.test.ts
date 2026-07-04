import { describe, expect, it } from "vitest";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
} from "@monolythium/core-sdk";
import { buildAutovotePlan } from "../autovote";

function cluster(
  id: number,
  active = true,
  health = "healthy",
): ClusterDirectoryEntryResponse {
  return {
    clusterId: id,
    size: 7,
    threshold: 5,
    aggregateHealth: health,
    regionDiversity: ["us-east", "eu-west"],
    active,
  };
}

function diversity(
  id: number,
  score: number,
  asn = score,
  geo = score,
  host = score,
): ClusterDiversityView {
  return {
    clusterId: id,
    score,
    asnVariance: asn,
    geoVariance: geo,
    hostingSpread: host,
  };
}

describe("autovote planner", () => {
  const clusters = [cluster(1), cluster(2), cluster(3)];
  const diversities = new Map<number, ClusterDiversityView>([
    [1, diversity(1, 9000)],
    [2, diversity(2, 6000)],
    [3, diversity(3, 3000)],
  ]);

  const noApr = new Map<number, number>();

  it("respects the weight cap (sum of weightBps <= cap)", () => {
    const plan = buildAutovotePlan({
      mode: "maxDiversity",
      clusters,
      diversities,
      aprBpsByCluster: noApr,
      capBps: 5000,
    });
    expect(plan.allocations.length).toBeGreaterThan(0);
    expect(plan.totalWeightBps).toBeLessThanOrEqual(5000);
    // No single allocation may exceed the cap either.
    for (const a of plan.allocations) {
      expect(a.weightBps).toBeGreaterThan(0);
      expect(a.weightBps).toBeLessThanOrEqual(5000);
    }
  });

  it("distributes the full weight budget across allocations (non-custodial)", () => {
    const plan = buildAutovotePlan({
      mode: "maxDiversity",
      clusters,
      diversities,
      aprBpsByCluster: noApr,
      capBps: 6000,
    });
    // Weight-only: the plan spreads the whole budget, no principal involved.
    expect(plan.totalWeightBps).toBe(6000);
    for (const a of plan.allocations) {
      expect(a).not.toHaveProperty("principalLyth");
    }
  });

  it("weights the highest-diversity cluster most under Max Diversity", () => {
    const plan = buildAutovotePlan({
      mode: "maxDiversity",
      clusters,
      diversities,
      aprBpsByCluster: noApr,
      capBps: 9000,
    });
    const byCluster = new Map(
      plan.allocations.map((a) => [a.clusterId, a.weightBps]),
    );
    // Cluster 1 (score 9000) should outweigh cluster 3 (score 3000).
    expect((byCluster.get(1) ?? 0)).toBeGreaterThan(byCluster.get(3) ?? 0);
  });

  it("Max Yield ranks by real aprBps and stays in-policy", () => {
    const plan = buildAutovotePlan({
      mode: "maxYield",
      clusters: [cluster(1), cluster(2)],
      diversities: new Map(),
      // Real APR: cluster 1 pays more than cluster 2.
      aprBpsByCluster: new Map([
        [1, 800],
        [2, 200],
      ]),
      capBps: 4000,
    });
    expect(plan.totalWeightBps).toBeLessThanOrEqual(4000);
    const byCluster = new Map(
      plan.allocations.map((a) => [a.clusterId, a.weightBps]),
    );
    // Higher real APR → more weight.
    expect((byCluster.get(1) ?? 0)).toBeGreaterThan(byCluster.get(2) ?? 0);
  });

  it("Max Yield with no APR signal (all 0/absent) falls back to an even, in-policy split — no fabrication", () => {
    const plan = buildAutovotePlan({
      mode: "maxYield",
      clusters: [cluster(1), cluster(2)],
      diversities: new Map(),
      aprBpsByCluster: new Map(), // testnet reality: no yield signal
      capBps: 4000,
    });
    expect(plan.totalWeightBps).toBe(4000);
    expect(plan.warnings.some((w) => w.toLowerCase().includes("even split"))).toBe(true);
  });

  it("Max Yield applies a real liveness discount when present (never fabricated)", () => {
    const plan = buildAutovotePlan({
      mode: "maxYield",
      clusters: [cluster(1), cluster(2)],
      diversities: new Map(),
      aprBpsByCluster: new Map([
        [1, 500],
        [2, 500],
      ]),
      // Equal APR, but cluster 2 is barely live — it should get less weight.
      livenessByCluster: new Map([
        [1, 10000],
        [2, 0],
      ]),
      capBps: 4000,
    });
    const byCluster = new Map(
      plan.allocations.map((a) => [a.clusterId, a.weightBps]),
    );
    expect((byCluster.get(1) ?? 0)).toBeGreaterThan(byCluster.get(2) ?? 0);
  });

  it("skips inactive clusters", () => {
    const withInactive = [cluster(1, true), cluster(2, false)];
    const plan = buildAutovotePlan({
      mode: "maxDiversity",
      clusters: withInactive,
      diversities: new Map([
        [1, diversity(1, 8000)],
        [2, diversity(2, 8000)],
      ]),
      aprBpsByCluster: noApr,
      capBps: 5000,
    });
    expect(plan.allocations.every((a) => a.clusterId !== 2)).toBe(true);
  });

  it("warns when a custom allocation exceeds the cap (out-of-policy)", () => {
    const plan = buildAutovotePlan({
      mode: "custom",
      clusters,
      diversities,
      aprBpsByCluster: noApr,
      capBps: 2000,
      customAllocations: [
        { clusterId: 1, weightBps: 1500 },
        { clusterId: 2, weightBps: 1500 },
      ],
    });
    expect(plan.totalWeightBps).toBe(3000);
    expect(plan.warnings.some((w) => w.includes("out-of-policy"))).toBe(true);
  });
});
