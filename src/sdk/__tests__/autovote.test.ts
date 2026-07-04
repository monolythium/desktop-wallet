import { describe, expect, it } from "vitest";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
} from "@monolythium/core-sdk";
import {
  AUTOVOTE_MODES,
  autovoteModeMeta,
  autovoteShuffleBytes,
  buildAutovotePlan,
  reorderNearTies,
  seededPermutation,
} from "../autovote";

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

describe("autovote mode metadata", () => {
  it("covers all four modes with a label + description", () => {
    const modes = AUTOVOTE_MODES.map((m) => m.mode);
    expect(new Set(modes)).toEqual(
      new Set(["maxYield", "maxDiversity", "maxDecentralization", "custom"]),
    );
    for (const m of AUTOVOTE_MODES) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it("never claims a reputation weighting (there is no cluster reputation read)", () => {
    for (const m of AUTOVOTE_MODES) {
      expect(m.description.toLowerCase()).not.toContain("reputation weight");
    }
    // Max Yield explicitly disclaims reputation/health guesswork.
    expect(autovoteModeMeta("maxYield").description.toLowerCase()).toContain("no reputation");
  });

  it("resolves each mode to its own metadata", () => {
    expect(autovoteModeMeta("custom").label).toBe("Custom");
    expect(autovoteModeMeta("maxDiversity").mode).toBe("maxDiversity");
  });
});

describe("autovote per-user entropy shuffle (SHAKE256)", () => {
  it("is deterministic per seed and generally differs across seeds", () => {
    const a1 = seededPermutation(8, "mono1alice");
    const a2 = seededPermutation(8, "mono1alice");
    const b = seededPermutation(8, "mono1bob");
    expect(a1).toEqual(a2); // same user → same order
    expect(a1).not.toEqual(b); // different users → different order (8! space)
    // A permutation is a bijection of [0..8).
    expect([...a1].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("is case-insensitive on the seed (address casing must not change order)", () => {
    expect(seededPermutation(6, "MONO1ALICE")).toEqual(seededPermutation(6, "mono1alice"));
  });

  it("shuffle bytes are deterministic and the requested length", () => {
    expect(autovoteShuffleBytes("mono1alice", 16)).toEqual(autovoteShuffleBytes("mono1alice", 16));
    expect(autovoteShuffleBytes("mono1alice", 16).length).toBe(16);
  });

  it("reorderNearTies keeps strict ranks but permutes ties per user", () => {
    const scored = [
      { id: "a", raw: 3 },
      { id: "b", raw: 1 },
      { id: "c", raw: 1 },
      { id: "d", raw: 1 },
      { id: "e", raw: 1 },
    ];
    const alice = reorderNearTies(scored, "mono1alice");
    const bob = reorderNearTies(scored, "mono1bob");
    // The strict top rank stays first for everyone.
    expect(alice[0]!.id).toBe("a");
    expect(bob[0]!.id).toBe("a");
    // The tie group {b,c,d,e} is a permutation, generally ordered differently.
    expect(alice.map((x) => x.id).slice(1).sort()).toEqual(["b", "c", "d", "e"]);
    expect(alice.map((x) => x.id)).not.toEqual(bob.map((x) => x.id));
    // Same user → same order.
    expect(reorderNearTies(scored, "mono1alice")).toEqual(alice);
  });

  it("no seed → stable score-desc order (no shuffle)", () => {
    const scored = [
      { id: "x", raw: 1 },
      { id: "y", raw: 1 },
      { id: "z", raw: 5 },
    ];
    expect(reorderNearTies(scored, undefined).map((s) => s.id)).toEqual(["z", "x", "y"]);
  });

  it("plan: different users get different tie orderings, same total + cap held", () => {
    const many = Array.from({ length: 8 }, (_, i) => cluster(i + 1));
    const flatApr = new Map<number, number>(); // all tied → shuffle decides
    const alice = buildAutovotePlan({
      mode: "maxYield",
      clusters: many,
      diversities: new Map(),
      aprBpsByCluster: flatApr,
      shuffleSeed: "mono1alice",
      capBps: 8000,
    });
    const bob = buildAutovotePlan({
      mode: "maxYield",
      clusters: many,
      diversities: new Map(),
      aprBpsByCluster: flatApr,
      shuffleSeed: "mono1bob",
      capBps: 8000,
    });
    expect(alice.totalWeightBps).toBe(8000);
    expect(bob.totalWeightBps).toBe(8000);
    expect(alice.allocations.map((a) => a.clusterId)).not.toEqual(
      bob.allocations.map((a) => a.clusterId),
    );
    // Same user reproduces the same plan order.
    const alice2 = buildAutovotePlan({
      mode: "maxYield",
      clusters: many,
      diversities: new Map(),
      aprBpsByCluster: flatApr,
      shuffleSeed: "mono1alice",
      capBps: 8000,
    });
    expect(alice2.allocations).toEqual(alice.allocations);
  });
});

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
