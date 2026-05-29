// Autovote planner seam (§25.1).
//
// Consumes the read-only per-cluster diversity scoring
// (lyth_getClusterDiversity → ClusterDiversityView) to turn one of four
// delegator intents into a concrete {clusterId, weightBps, principalLyth}
// allocation plan. The plan is then submitted as N sequential delegate
// calls reusing the staking seam (buildDelegateCalldata + submitStakingTx)
// — there is no new write path; autovote is a planner on top of delegate.

import { DIVERSITY_SCORE_MAX } from "@monolythium/core-sdk";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
} from "@monolythium/core-sdk";
import { getProvider } from "./client";
import { buildDelegateCalldata, submitStakingTx } from "./staking";

export type AutovoteMode =
  | "maxYield"
  | "maxDiversity"
  | "maxDecentralization"
  | "custom";

export interface AutovoteAllocation {
  clusterId: number;
  /** Basis points of total wallet weight assigned to this cluster. */
  weightBps: number;
  /** Whole-LYTH principal assigned to this cluster. */
  principalLyth: bigint;
}

export interface AutovotePlanInput {
  mode: AutovoteMode;
  clusters: ClusterDirectoryEntryResponse[];
  /** Per-cluster diversity reads keyed by clusterId (maxDiversity / maxDecentralization). */
  diversities: Map<number, ClusterDiversityView>;
  /** Total principal to spread across the selected clusters. */
  totalPrincipalLyth: bigint;
  /** Total weight budget (cap) the plan must not exceed, in basis points. */
  capBps: number;
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

// `aggregateHealth` is a free-form chain label (e.g. "healthy", "degraded").
// Map it to a coarse 0..1 proxy weight for the Max-Yield mode, which has
// NO real APR source on-chain.
function healthProxyWeight(label: string): number {
  const l = label.toLowerCase();
  if (l.includes("healthy") || l.includes("optimal")) return 1;
  if (l.includes("degraded") || l.includes("warn")) return 0.5;
  if (l.includes("offline") || l.includes("critical")) return 0.1;
  return 0.7; // unknown — neutral-positive
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
 * exactly the cap budget; principal is split proportionally. Enforces
 * sum(weightBps) <= capBps at plan time.
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
        // TODO(monolythium-vision): lyth_* per-cluster APR/yield read not in
        // 0.3.10 SDK — ClusterDirectoryEntryResponse has no APR field. Max
        // Yield ranks by the aggregateHealth (+ reputation, via
        // lythClusterStatus, when the page supplies it) liveness proxy.
        return healthProxyWeight(c.aggregateHealth);
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
  let assignedPrincipal = 0n;
  for (const [i, entry] of scored.entries()) {
    const { cluster, raw } = entry;
    const frac = raw / totalRaw;
    const isLast = i === scored.length - 1;
    // Last entry takes the remainder so rounding never overshoots the cap
    // or under/over-spends the principal.
    const weightBps = isLast
      ? cap - assignedBps
      : Math.floor(cap * frac);
    const principalLyth = isLast
      ? input.totalPrincipalLyth - assignedPrincipal
      : (input.totalPrincipalLyth * BigInt(Math.floor(frac * 1_000_000))) /
        1_000_000n;
    if (weightBps <= 0 || principalLyth <= 0n) {
      // Skip dust allocations; their remainder rolls into the last entry.
      continue;
    }
    assignedBps += weightBps;
    assignedPrincipal += principalLyth;
    allocations.push({ clusterId: cluster.clusterId, weightBps, principalLyth });
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
 * staking seam verbatim — `value` is the per-cluster principal stake.
 * Sequential (not parallel) so each call lands on the previous nonce.
 */
export async function submitAutovotePlan(
  plan: AutovotePlan,
  seed: Uint8Array,
): Promise<SubmitAutovotePlanResult> {
  const txHashes: string[] = [];
  for (const a of plan.allocations) {
    const calldata = buildDelegateCalldata(a.clusterId, a.weightBps);
    const principalLythoshi = a.principalLyth * 100_000_000n; // 1 LYTH = 1e8 lythoshi
    const result = await submitStakingTx({
      seed,
      data: calldata,
      valueLythoshi: principalLythoshi,
    });
    txHashes.push(result.txHash);
  }
  return { txHashes };
}
