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

  it("respects the weight cap (sum of weightBps <= cap)", () => {
    const plan = buildAutovotePlan({
      mode: "maxDiversity",
      clusters,
      diversities,
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
      capBps: 9000,
    });
    const byCluster = new Map(
      plan.allocations.map((a) => [a.clusterId, a.weightBps]),
    );
    // Cluster 1 (score 9000) should outweigh cluster 3 (score 3000).
    expect((byCluster.get(1) ?? 0)).toBeGreaterThan(byCluster.get(3) ?? 0);
  });

  it("Max Yield falls back to a health proxy (no APR source) and stays in-policy", () => {
    const mixed = [
      cluster(1, true, "healthy"),
      cluster(2, true, "degraded"),
    ];
    const plan = buildAutovotePlan({
      mode: "maxYield",
      clusters: mixed,
      diversities: new Map(),
      capBps: 4000,
    });
    expect(plan.totalWeightBps).toBeLessThanOrEqual(4000);
    const byCluster = new Map(
      plan.allocations.map((a) => [a.clusterId, a.weightBps]),
    );
    // Healthy cluster outranks the degraded one under the health proxy.
    expect((byCluster.get(1) ?? 0)).toBeGreaterThanOrEqual(byCluster.get(2) ?? 0);
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
      capBps: 5000,
    });
    expect(plan.allocations.every((a) => a.clusterId !== 2)).toBe(true);
  });

  it("warns when a custom allocation exceeds the cap (out-of-policy)", () => {
    const plan = buildAutovotePlan({
      mode: "custom",
      clusters,
      diversities,
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
