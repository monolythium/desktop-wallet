// Autovote planner seam (§25.1).
//
// Consumes the read-only per-cluster diversity scoring
// (lyth_getClusterDiversity → ClusterDiversityView) to turn one of four
// delegator intents into a concrete {clusterId, weightBps} allocation plan.
// The plan is then submitted as N sequential delegate calls reusing the
// delegation seam (buildDelegateCalldata + submitDelegationTx) — there is no
// new write path; autovote is a planner on top of delegate.
//
// NON-CUSTODIAL: the plan distributes a WEIGHT BUDGET (basis points of the
// wallet's balance) across clusters. No principal is escrowed — each delegate
// is sent with value = 0 and the effective weight tracks the live balance.

import { DIVERSITY_SCORE_MAX } from "@monolythium/core-sdk";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
} from "@monolythium/core-sdk";
import { getProvider } from "./client";
import { buildDelegateCalldata, submitDelegationTx } from "./delegation";

export type AutovoteMode =
  | "maxYield"
  | "maxDiversity"
  | "maxDecentralization"
  | "custom";

export interface AutovoteAllocation {
  clusterId: number;
  /** Basis points of total wallet weight assigned to this cluster. */
  weightBps: number;
}

export interface AutovotePlanInput {
  mode: AutovoteMode;
  clusters: ClusterDirectoryEntryResponse[];
  /** Per-cluster diversity reads keyed by clusterId (maxDiversity / maxDecentralization). */
  diversities: Map<number, ClusterDiversityView>;
  /**
   * Real per-cluster APR in basis points (lyth_clusterApr → aprBps), keyed by
   * clusterId — the ONLY Max-Yield signal. A missing key means the read was
   * unavailable (treated as 0, no fabricated fallback); a real 0 is honest too.
   * When every cluster is 0/absent (the current testnet reality) Max-Yield has
   * no yield signal and falls back to an even split — the near-tie shuffle then
   * spreads it deterministically per user.
   */
  aprBpsByCluster: Map<number, number>;
  /**
   * Optional real per-cluster liveness in basis points (lyth_clusterStatus →
   * livenessScore) keyed by clusterId. Used ONLY when present as a mild
   * Max-Yield multiplier; absent → no effect (never fabricated). livenessScore
   * is null on the current testnet, so in practice this is empty and Max-Yield
   * ranks on aprBps alone.
   */
  livenessByCluster?: Map<number, number>;
  /** Total weight budget (cap) the plan distributes + must not exceed, in basis points. */
  capBps: number;
  /**
   * Per-user shuffle seed (the wallet's own address/key, hex or bech32m). Seeds
   * the deterministic near-tie shuffle so equally-ranked clusters are ordered
   * differently per user (WP §23.9 anti-concentration) yet stably for one user.
   * Absent → no shuffle (stable input order).
   */
  shuffleSeed?: string;
  /**
   * Pre-built per-cluster allocation for `custom` mode (passthrough).
   * Ignored for the three computed modes.
   */
  customAllocations?: AutovoteAllocation[];
}

export interface AutovotePlan {
  mode: AutovoteMode;
  allocations: AutovoteAllocation[];
  /** Sum of allocation weightBps — guaranteed <= capBps by buildAutovotePlan. */
  totalWeightBps: number;
  /** Non-fatal advisories surfaced before the user approves the plan. */
  warnings: string[];
}

/** Fetch the diversity score for one cluster (read-only, PF-6). */
export async function fetchClusterDiversity(
  clusterId: number,
): Promise<ClusterDiversityView> {
  return getProvider().rpcClient.lythGetClusterDiversity(clusterId);
}

/** Fetch diversity for every directory cluster, tolerating per-cluster failures. */
export async function fetchClusterDiversities(
  clusters: ClusterDirectoryEntryResponse[],
): Promise<Map<number, ClusterDiversityView>> {
  const out = new Map<number, ClusterDiversityView>();
  const results = await Promise.all(
    clusters.map((c) =>
      fetchClusterDiversity(c.clusterId)
        .then((view) => ({ clusterId: c.clusterId, view }))
        .catch(() => null),
    ),
  );
  for (const r of results) {
    if (r) out.set(r.clusterId, r.view);
  }
  return out;
}

// Max-Yield score = the REAL per-cluster APR (aprBps), optionally discounted by
// REAL liveness when a livenessScore is present. No mock APR fallback, no
// health-label proxy, no reputation term — a missing/zero APR contributes 0 and
// (if every cluster is 0) the caller's even-split fallback + near-tie shuffle
// take over. `DIVERSITY_SCORE_MAX` (10000 bps) is also the bps scale for these.
function yieldWeight(
  clusterId: number,
  aprBpsByCluster: Map<number, number>,
  livenessByCluster: Map<number, number> | undefined,
): number {
  const apr = aprBpsByCluster.get(clusterId);
  const base = typeof apr === "number" && apr > 0 ? apr / DIVERSITY_SCORE_MAX : 0;
  const liveness = livenessByCluster?.get(clusterId);
  // Real liveness, when present, gently discounts a less-live cluster (fully
  // live keeps full weight); absent liveness leaves the APR weight untouched.
  const mult =
    typeof liveness === "number"
      ? 0.5 + 0.5 * Math.max(0, Math.min(1, liveness / DIVERSITY_SCORE_MAX))
      : 1;
  return base * mult;
}

function diversityWeight(view: ClusterDiversityView | undefined): number {
  if (!view) return 0;
  return view.score / DIVERSITY_SCORE_MAX; // 0..1
}

// Decentralization rewards *variance breadth* (uncorrelated ASN / geo /
// hosting), not raw headline score — a high score driven by one dimension
// is more concentrated than balanced variance across all three.
function decentralizationWeight(view: ClusterDiversityView | undefined): number {
  if (!view) return 0;
  const asn = view.asnVariance / DIVERSITY_SCORE_MAX;
  const geo = view.geoVariance / DIVERSITY_SCORE_MAX;
  const host = view.hostingSpread / DIVERSITY_SCORE_MAX;
  // Geometric-style penalty for any low dimension: the min dominates so a
  // cluster concentrated on one ASN is down-weighted even with high geo.
  const mean = (asn + geo + host) / 3;
  const min = Math.min(asn, geo, host);
  return (mean + min) / 2; // 0..1
}

/**
 * Turn an intent into a concrete allocation plan. Active clusters only.
 * Weights are proportional to each mode's scoring function, normalised to
 * exactly the cap budget. Enforces sum(weightBps) <= capBps at plan time.
 * Non-custodial — there is no principal to split.
 */
export function buildAutovotePlan(input: AutovotePlanInput): AutovotePlan {
  const warnings: string[] = [];
  const cap = Math.max(0, Math.min(input.capBps, 10_000));

  if (input.mode === "custom") {
    const allocations = input.customAllocations ?? [];
    const totalWeightBps = allocations.reduce((s, a) => s + a.weightBps, 0);
    if (totalWeightBps > cap) {
      warnings.push(
        `Custom allocation totals ${totalWeightBps} bps, exceeding the ${cap} bps cap — out-of-policy distribution.`,
      );
    }
    return { mode: input.mode, allocations, totalWeightBps, warnings };
  }

  const active = input.clusters.filter((c) => c.active);
  if (active.length === 0) {
    warnings.push("No active clusters available to allocate to.");
    return { mode: input.mode, allocations: [], totalWeightBps: 0, warnings };
  }

  const scoreFor = (c: ClusterDirectoryEntryResponse): number => {
    const view = input.diversities.get(c.clusterId);
    switch (input.mode) {
      case "maxDiversity":
        return diversityWeight(view);
      case "maxDecentralization":
        return decentralizationWeight(view);
      case "maxYield":
        // Real APR only (+ real liveness where present). No proxy, no mock.
        return yieldWeight(c.clusterId, input.aprBpsByCluster, input.livenessByCluster);
      default:
        // `custom` is handled by the early return above; never reached.
        return 0;
    }
  };

  const scored = active.map((c) => ({ cluster: c, raw: scoreFor(c) }));
  let totalRaw = scored.reduce((s, x) => s + x.raw, 0);

  if (totalRaw <= 0) {
    // Degenerate (e.g. every diversity read failed) — distribute evenly so
    // the user still gets a usable, in-policy plan instead of an empty one.
    warnings.push(
      "No scoring signal available for the selected mode — falling back to an even split across active clusters.",
    );
    const even = scored.map((x) => ({ cluster: x.cluster, raw: 1 }));
    scored.length = 0;
    scored.push(...even);
    totalRaw = scored.length;
  }

  const allocations: AutovoteAllocation[] = [];
  let assignedBps = 0;
  for (const [i, entry] of scored.entries()) {
    const { cluster, raw } = entry;
    const frac = raw / totalRaw;
    const isLast = i === scored.length - 1;
    // Last entry takes the remainder so rounding never overshoots the cap.
    const weightBps = isLast ? cap - assignedBps : Math.floor(cap * frac);
    if (weightBps <= 0) {
      // Skip dust allocations; their remainder rolls into the last entry.
      continue;
    }
    assignedBps += weightBps;
    allocations.push({ clusterId: cluster.clusterId, weightBps });
  }

  const totalWeightBps = allocations.reduce((s, a) => s + a.weightBps, 0);
  if (totalWeightBps > cap) {
    warnings.push(
      `Computed allocation totals ${totalWeightBps} bps, exceeding the ${cap} bps cap.`,
    );
  }

  return { mode: input.mode, allocations, totalWeightBps, warnings };
}

export interface SubmitAutovotePlanResult {
  txHashes: string[];
}

/**
 * Submit an autovote plan as N sequential delegate calls. Reuses the
 * delegation seam verbatim — NON-CUSTODIAL, each delegate carries no value
 * (only weightBps). Sequential (not parallel) so each call lands on the
 * previous nonce.
 */
export async function submitAutovotePlan(
  plan: AutovotePlan,
  seed: Uint8Array,
): Promise<SubmitAutovotePlanResult> {
  const txHashes: string[] = [];
  for (const a of plan.allocations) {
    const calldata = buildDelegateCalldata(a.clusterId, a.weightBps);
    const result = await submitDelegationTx({ seed, data: calldata });
    txHashes.push(result.txHash);
  }
  return { txHashes };
}
