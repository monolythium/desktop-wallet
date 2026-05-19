// Autovote algorithm — whitepaper §23.9 "Wallet-Side Autovote".
//
// Four named modes:
//
//   - Max Yield          → highest-APR clusters consistent with the cap
//   - Max Diversity      → spread across as many clusters as cap permits,
//                          weighted by reputation + uptime
//   - Max Decentralization → actively route stake AWAY from concentrated
//                          clusters (correlated preference, geographic
//                          concentration, shared operator membership)
//   - Custom             → manual allocation handled by the page; not
//                          computed here
//
// Per-user randomization (§23.9 "two delegators each picking Max Yield
// must not end up at the same cluster set") is wired in Commit 8 via
// SHAKE256-keyed Fisher-Yates. This commit ships the deterministic
// shape so the rest of the page wires cleanly; the sampling step is
// abstracted behind a `sampleStrategy` argument that Commit 8 fills in.

import type { ClusterSummary } from "./staking";

export type AutovoteMode = "max-yield" | "max-diversity" | "max-decentralization";

/** One allocation row produced by an autovote run. */
export interface AutovoteAllocation {
  cluster: ClusterSummary;
  weightBps: number;
}

/** Result envelope — includes the eligible bracket so the UI can show its size. */
export interface AutovoteResult {
  mode: AutovoteMode;
  allocations: AutovoteAllocation[];
  /**
   * Number of clusters considered before sampling/sorting. Useful for
   * the UI to display "12 eligible · 5 selected" guidance.
   */
  eligibleCount: number;
  /** Per-cluster cap that was enforced (bps). `null` = no cap. */
  capBps: number | null;
  /** Cluster ids that were excluded for being chain-gapped on the sort key. */
  skipped: number[];
}

export interface AutovoteOptions {
  /**
   * Total weight (in basis points) the wallet wants to distribute.
   * Default 10000 = 100% of bonded weight.
   */
  totalBps?: number;
  /**
   * Maximum per-cluster cap (bps). Null = no cap. The autovote will
   * never produce an allocation row that exceeds the cap.
   */
  capBps?: number | null;
  /**
   * Number of clusters to allocate to. Modes interpret this slightly
   * differently — Max Yield treats it as "top N"; Max Diversity uses
   * the larger of `count` and the minimum needed to honor the cap.
   */
  count?: number;
  /**
   * Optional sampler — given a bracket of eligible clusters + a count,
   * returns a per-user-randomized selection. When omitted, the helper
   * falls back to the deterministic head of the sorted bracket (the
   * shape Commit 7 ships; Commit 8 replaces this with SHAKE256-keyed
   * Fisher-Yates so two users picking the same mode against the same
   * cluster set diverge).
   */
  sampleStrategy?: (eligible: ClusterSummary[], count: number) => ClusterSummary[];
}

const DEFAULT_TOTAL_BPS = 10_000;
const DEFAULT_COUNT_YIELD = 5;
const DEFAULT_COUNT_DIVERSITY = 10;
const DEFAULT_COUNT_DECENTRALIZATION = 10;

/**
 * Resolve an autovote mode against the live cluster directory. Pure
 * function — same inputs → same outputs (modulo the `sampleStrategy`,
 * which is the per-user randomization seam).
 */
export function runAutovote(
  mode: AutovoteMode,
  clusters: ClusterSummary[],
  options: AutovoteOptions = {},
): AutovoteResult {
  const totalBps = options.totalBps ?? DEFAULT_TOTAL_BPS;
  const capBps = options.capBps ?? null;
  const sample = options.sampleStrategy ?? deterministicHead;

  // Only `active` clusters are candidates. The chain refuses
  // delegations to inactive clusters anyway, so showing them is
  // misleading.
  const active = clusters.filter((c) => c.active);

  switch (mode) {
    case "max-yield": {
      const count = options.count ?? DEFAULT_COUNT_YIELD;
      // Bracket: clusters with non-null APR. Chain-gapped clusters
      // (apr === null) sit outside the eligible set for this mode.
      const eligible = active.filter((c) => c.apr !== null);
      const skipped = active
        .filter((c) => c.apr === null)
        .map((c) => c.clusterId);
      // Sort by APR desc, then pick the top bracket and sample within.
      const sorted = [...eligible].sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0));
      // Bracket = top 2N (or all if N ≥ size/2). Keeps "top yield" the
      // primary signal while leaving enough room for the sampler to
      // produce divergent selections across users.
      const bracket = sorted.slice(0, Math.max(count * 2, count + 1));
      const selected = sample(bracket, count);
      return {
        mode,
        eligibleCount: eligible.length,
        capBps,
        skipped,
        allocations: allocateEqual(selected, totalBps, capBps),
      };
    }
    case "max-diversity": {
      const count = options.count ?? DEFAULT_COUNT_DIVERSITY;
      // Bracket: clusters with reputation + uptime. Score = mean of
      // both, fallback to 0 for chain-gapped rows.
      const scored = active.map((c) => ({
        cluster: c,
        score: diversityScore(c),
      }));
      const eligible = scored.filter((s) => s.score > 0).map((s) => s.cluster);
      const skipped = scored
        .filter((s) => s.score <= 0)
        .map((s) => s.cluster.clusterId);
      // Sort by score desc + take 2N as the candidate bracket; sample
      // produces the actual selection.
      const sorted = [...scored]
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((s) => s.cluster);
      const bracket = sorted.slice(0, Math.max(count * 2, count + 1));
      const selected = sample(bracket, count);
      return {
        mode,
        eligibleCount: eligible.length,
        capBps,
        skipped,
        allocations: allocateEqual(selected, totalBps, capBps),
      };
    }
    case "max-decentralization": {
      const count = options.count ?? DEFAULT_COUNT_DECENTRALIZATION;
      // Avoid clusters with high concentration signals:
      //   - high totalStake (the chain hasn't surfaced this yet —
      //     when null, treat as "unknown concentration" → mid-rank)
      //   - identical geographic region (treat clusters sharing a
      //     region as correlated)
      //   - Foundation clusters (entity: "mono-labs"): keep but
      //     deprioritize to push toward independent operators
      //     per §30.5
      const regionSeen = new Map<string, number>();
      for (const c of active) {
        for (const r of c.regionDiversity ?? []) {
          regionSeen.set(r, (regionSeen.get(r) ?? 0) + 1);
        }
      }
      const scored = active.map((c) => ({
        cluster: c,
        score: decentralizationScore(c, regionSeen),
      }));
      const sorted = scored
        .sort((a, b) => b.score - a.score)
        .map((s) => s.cluster);
      const bracket = sorted.slice(0, Math.max(count * 2, count + 1));
      const selected = sample(bracket, count);
      return {
        mode,
        eligibleCount: scored.length,
        capBps,
        skipped: [],
        allocations: allocateEqual(selected, totalBps, capBps),
      };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Default sampler — returns the first `count` of `eligible` as-is.
 * Pure function, deterministic. Commit 8 wraps this with a
 * SHAKE256-keyed Fisher-Yates so per-user randomization kicks in
 * without changing call sites.
 */
function deterministicHead(eligible: ClusterSummary[], count: number): ClusterSummary[] {
  return eligible.slice(0, count);
}

/**
 * Distribute `totalBps` across `selected` clusters, respecting the
 * per-cluster cap. Equal-split first; clusters above the cap are
 * trimmed to the cap and the surplus is redistributed across the
 * remaining clusters (one pass; never recurses past the cap a second
 * time because the chain's protocol-side cap is final).
 */
function allocateEqual(
  selected: ClusterSummary[],
  totalBps: number,
  capBps: number | null,
): AutovoteAllocation[] {
  if (selected.length === 0) return [];
  const equal = Math.floor(totalBps / selected.length);
  if (capBps === null || equal <= capBps) {
    // Distribute the rounding remainder onto the first row.
    const remainder = totalBps - equal * selected.length;
    return selected.map((cluster, i) => ({
      cluster,
      weightBps: equal + (i === 0 ? remainder : 0),
    }));
  }
  // Some rows would exceed the cap; trim and redistribute the surplus.
  const cappedRowBps = capBps;
  const capacity = cappedRowBps * selected.length;
  if (capacity < totalBps) {
    // Can't fit `totalBps` even at full cap — distribute the cap
    // across every row and ignore the shortfall. The UI will warn.
    return selected.map((cluster) => ({ cluster, weightBps: cappedRowBps }));
  }
  // Even split, hard-capped at `cappedRowBps`.
  return selected.map((cluster) => ({
    cluster,
    weightBps: Math.min(equal, cappedRowBps),
  }));
}

function diversityScore(c: ClusterSummary): number {
  const rep = c.reputation ?? 0;
  const up = c.uptime ?? 0;
  if (rep === 0 && up === 0) return 0;
  // Reputation is 0..5 scale; uptime is 0..1. Normalize reputation
  // to 0..1 by dividing by 5, then mean.
  return (rep / 5 + up) / 2;
}

function decentralizationScore(
  c: ClusterSummary,
  regionSeen: Map<string, number>,
): number {
  let score = 1.0;
  // Foundation clusters deprioritised — push toward independent operators
  // per §30.5. Score halves for Foundation.
  if (c.entity === "mono-labs") score *= 0.5;
  // Total-stake concentration penalty (null = unknown, no penalty).
  if (c.totalStakeLyth !== null) {
    // Logarithmic dampening — clusters within 10x of each other get
    // similar scores; a cluster with 100M LYTH ranks below one with
    // 10M LYTH but not catastrophically.
    const log = Math.log10(Math.max(1, c.totalStakeLyth));
    score *= 1 / (1 + log / 10);
  }
  // Region-overlap penalty: each region the cluster sits in costs a
  // little, scaled by how many other clusters share that region.
  for (const region of c.regionDiversity ?? []) {
    const others = (regionSeen.get(region) ?? 1) - 1;
    if (others > 0) score *= 1 / (1 + others * 0.05);
  }
  return score;
}
