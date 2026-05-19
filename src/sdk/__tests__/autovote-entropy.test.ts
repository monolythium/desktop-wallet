// Per-user entropy — SHAKE256-keyed Fisher-Yates sampling.
//
// Whitepaper §23.9 mandates that two delegators picking the same
// mode end up at different cluster sets. The contract is:
//
//   1. determinism: (user_address, block_hash, eligible) is reproducible
//   2. per-user divergence: different user_address at same block diverges
//   3. per-block freshness: same user at different blocks diverges
//   4. bracket respect: only `eligible` rows show up in the output

import { describe, expect, it } from "vitest";
import { buildAutovoteSeed, sampleClusters } from "../autovote-entropy";
import type { ClusterSummary } from "../staking";

function makeCluster(id: number): ClusterSummary {
  return {
    clusterId: id,
    name: `C-${id}`,
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
  };
}

const BRACKET: ClusterSummary[] = Array.from({ length: 20 }, (_, i) =>
  makeCluster(i),
);

const ALICE = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOB = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BLOCK_A = "0x" + "a".repeat(64);
const BLOCK_B = "0x" + "b".repeat(64);

describe("buildAutovoteSeed", () => {
  it("produces a 32-byte seed", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it("is deterministic — same inputs → same seed", () => {
    const a = buildAutovoteSeed(ALICE, BLOCK_A);
    const b = buildAutovoteSeed(ALICE, BLOCK_A);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("diverges across users at the same block", () => {
    const a = buildAutovoteSeed(ALICE, BLOCK_A);
    const b = buildAutovoteSeed(BOB, BLOCK_A);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("diverges across blocks for the same user", () => {
    const a = buildAutovoteSeed(ALICE, BLOCK_A);
    const b = buildAutovoteSeed(ALICE, BLOCK_B);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("sampleClusters", () => {
  it("returns N clusters from the eligible bracket", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    const out = sampleClusters(BRACKET, 5, seed);
    expect(out.length).toBe(5);
  });

  it("samples only from eligible (no bracket-violation)", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    const out = sampleClusters(BRACKET, 5, seed);
    const eligibleIds = new Set(BRACKET.map((c) => c.clusterId));
    for (const c of out) {
      expect(eligibleIds.has(c.clusterId)).toBe(true);
    }
  });

  it("returns no duplicates", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    const out = sampleClusters(BRACKET, 8, seed);
    const ids = new Set(out.map((c) => c.clusterId));
    expect(ids.size).toBe(out.length);
  });

  it("is deterministic — same seed produces same selection", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    const a = sampleClusters(BRACKET, 6, seed);
    const b = sampleClusters(BRACKET, 6, seed);
    expect(a.map((c) => c.clusterId)).toEqual(b.map((c) => c.clusterId));
  });

  it("diverges across users at the same block", () => {
    const aliceSeed = buildAutovoteSeed(ALICE, BLOCK_A);
    const bobSeed = buildAutovoteSeed(BOB, BLOCK_A);
    const alice = sampleClusters(BRACKET, 6, aliceSeed);
    const bob = sampleClusters(BRACKET, 6, bobSeed);
    // Two independent Fisher-Yates shuffles over a 20-element bracket
    // — the probability of an identical ordering is astronomically
    // low. Comparing the ordered id lists is the strongest assertion
    // we can make without flake risk.
    expect(alice.map((c) => c.clusterId)).not.toEqual(
      bob.map((c) => c.clusterId),
    );
  });

  it("returns empty when count is zero or bracket is empty", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    expect(sampleClusters(BRACKET, 0, seed)).toEqual([]);
    expect(sampleClusters([], 5, seed)).toEqual([]);
  });

  it("returns the whole bracket when count exceeds bracket size", () => {
    const seed = buildAutovoteSeed(ALICE, BLOCK_A);
    const out = sampleClusters(BRACKET.slice(0, 3), 10, seed);
    expect(out.length).toBe(3);
  });
});
