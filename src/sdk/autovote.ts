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
import { shake256 } from "@noble/hashes/sha3.js";
import { getProvider } from "./client";
import { buildDelegateCalldata, submitDelegationTx } from "./delegation";
import { preflightDelegationVerdict } from "./delegation-caps";
import { isInertDelegation, minNonInertBps } from "./delegation-derive";
import { withDelegationRevertCopy } from "./delegation-reverts";

/** Domain tag mixed into the per-user shuffle seed so autovote entropy can't
 *  collide with any other SHAKE256 use of the same address. */
const AUTOVOTE_SHUFFLE_DOMAIN = "monolythium.autovote.v1";

/** Deterministic per-user byte stream for the near-tie shuffle: SHAKE256 over
 *  the user's own seed (their address/key) with a domain tag, extended to
 *  `length` bytes. Same user → same bytes; different users → different bytes.
 *  Pure (no Math.random), so the anti-concentration ordering is reproducible. */
export function autovoteShuffleBytes(seed: string, length: number): Uint8Array {
  const input = new TextEncoder().encode(`${AUTOVOTE_SHUFFLE_DOMAIN}:${seed.toLowerCase()}`);
  return shake256(input, { dkLen: Math.max(1, length) });
}

/** Deterministic Fisher-Yates permutation of [0..n) driven by the SHAKE256
 *  stream for `seed`. Same seed → same permutation; different seeds generally
 *  differ. Consumes 4 seed bytes per swap. Pure. */
export function seededPermutation(n: number, seed: string): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (n <= 1) return idx;
  const bytes = autovoteShuffleBytes(seed, n * 4);
  for (let i = n - 1; i > 0; i--) {
    const o = i * 4;
    const r =
      ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
    const j = r % (i + 1);
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}

/** Reorder a scored list so that near-tied entries (equal raw score) are
 *  permuted deterministically per user, while strictly-ranked entries keep
 *  their order. This is the WP §23.9 anti-concentration property: when clusters
 *  are indistinguishable on the chosen signal (e.g. Max Yield with flat APR),
 *  different users route weight — and the rounding remainder — to different
 *  clusters, yet stably for any one user. No seed → input order unchanged. */
export function reorderNearTies<T extends { raw: number }>(
  scored: readonly T[],
  seed: string | undefined,
): T[] {
  const sorted = [...scored].sort((a, b) => b.raw - a.raw);
  if (!seed || sorted.length <= 1) return sorted;
  const EPS = 1e-9;
  const out: T[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && Math.abs(sorted[j]!.raw - sorted[i]!.raw) <= EPS) j++;
    const group = sorted.slice(i, j);
    if (group.length > 1) {
      // A per-group sub-seed so adjacent tie-groups don't share a permutation.
      const perm = seededPermutation(group.length, `${seed}#${i}`);
      out.push(...perm.map((k) => group[k]!));
    } else {
      out.push(group[0]!);
    }
    i = j;
  }
  return out;
}

export type AutovoteMode =
  | "maxYield"
  | "maxDiversity"
  | "maxDecentralization"
  | "custom";

export interface AutovoteModeMeta {
  mode: AutovoteMode;
  label: string;
  /** One-line description shown next to the mode. Honest about the real signals
   *  each mode uses and about what is NOT used (no reputation weighting — there
   *  is no cluster-level reputation read). */
  description: string;
}

/** The four autovote modes with their user-facing copy. Ordered
 *  decentralization-first (the network-health objective), then diversity,
 *  yield, and manual — but the UI may present them in any order. */
export const AUTOVOTE_MODES: readonly AutovoteModeMeta[] = [
  {
    mode: "maxDecentralization",
    label: "Max Decentralization",
    description:
      "Routes weight toward balanced variance across every diversity dimension (ASN, region, hosting), penalising clusters concentrated on a single one. Uses the live lyth_getClusterDiversity read.",
  },
  {
    mode: "maxDiversity",
    label: "Max Diversity",
    description:
      "Spreads across clusters by their live diversity score, favouring the most independent operators. Uses the live lyth_getClusterDiversity read.",
  },
  {
    mode: "maxYield",
    label: "Max Yield",
    description:
      "Weights clusters by their real per-cluster APR (lyth_clusterApr). When APR is flat or zero it spreads evenly and lets the per-user shuffle settle near-ties — no reputation or health guesswork.",
  },
  {
    mode: "custom",
    label: "Custom",
    description:
      "Allocate weight to clusters yourself. The wallet still enforces the per-cluster cap and warns before signing an out-of-policy distribution.",
  },
] as const;

/** The metadata for one mode (label + description). */
export function autovoteModeMeta(mode: AutovoteMode): AutovoteModeMeta {
  const found = AUTOVOTE_MODES.find((m) => m.mode === mode);
  // Every AutovoteMode has an entry above; the fallback keeps this total.
  return found ?? AUTOVOTE_MODES[AUTOVOTE_MODES.length - 1]!;
}

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

  let scored = active.map((c) => ({ cluster: c, raw: scoreFor(c) }));
  let totalRaw = scored.reduce((s, x) => s + x.raw, 0);

  if (totalRaw <= 0) {
    // Degenerate (e.g. Max Yield with flat/zero APR, or every diversity read
    // failed) — distribute evenly so the user still gets a usable, in-policy
    // plan. Every cluster is now tied, so the per-user shuffle below decides
    // the order (and which cluster takes the rounding remainder).
    warnings.push(
      "No scoring signal available for the selected mode — falling back to an even split across active clusters.",
    );
    scored = scored.map((x) => ({ cluster: x.cluster, raw: 1 }));
    totalRaw = scored.length;
  }

  // Order strictly-ranked clusters by score, and permute near-ties per user so
  // indistinguishable clusters aren't always weighted in the same order.
  scored = reorderNearTies(scored, input.shuffleSeed);

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

export interface AutovotePreflightResult {
  ok: boolean;
  /** The first allocation that would revert, when blocked. */
  clusterId?: number;
  message?: string;
}

/** Pre-sign cap check for a WHOLE plan. Each delegate() stacks onto the wallet's
 *  existing weight for that cluster and adds to the wallet total, so verify
 *  every allocation against the per-cluster cap AND the 100% total, accumulating
 *  as the plan applies. Reuses preflightDelegationVerdict — the exact gate the
 *  per-row Delegate / Redelegate flows use — so a batch never signs a
 *  guaranteed 0x0213 / 0x0205 revert. Blocks on the FIRST offending allocation.
 *  `capBps` is the per-cluster cap (the aggregate cap when present, else null →
 *  the 50% floor), NOT the autovote weight budget (the planner already bounds
 *  the budget). Pure. */
export function preflightAutovotePlan(args: {
  allocations: readonly AutovoteAllocation[];
  existingWeightByCluster: Map<number, number>;
  currentTotalBps: number;
  capBps: number | null;
  /** Active delegation rows before the plan runs. Omitted → the row-limit check
   *  is skipped for every allocation. */
  currentDelegationCount?: number;
}): AutovotePreflightResult {
  let runningTotal = args.currentTotalBps;
  // The row count ACCUMULATES across the plan the same way the total does: a
  // batch that opens three new rows from a base of eight reaches eleven, and the
  // chain rejects the eleventh even though each allocation looked fine alone.
  let runningCount = args.currentDelegationCount;
  for (const a of args.allocations) {
    const dstExistingWeightBps = args.existingWeightByCluster.get(a.clusterId) ?? 0;
    const verdict = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps,
      totalDelegatedBps: runningTotal,
      moveBps: a.weightBps,
      capBps: args.capBps,
      currentDelegationCount: runningCount,
    });
    if (!verdict.ok) {
      return { ok: false, clusterId: a.clusterId, message: verdict.message };
    }
    runningTotal += a.weightBps;
    if (runningCount !== undefined && dstExistingWeightBps === 0) runningCount += 1;
  }
  return { ok: true };
}

export interface AutovoteInertVerdict {
  ok: boolean;
  /** The allocations that would credit nothing, when blocked. */
  inertClusterIds?: number[];
  message?: string;
}

/**
 * Would any allocation in this plan credit nothing at all?
 *
 * NOT the single-path check run N times. A plan divides a budget across
 * clusters, so each allocation is a FRACTION of it, and at a modest balance a
 * split that looks reasonable makes every allocation floor to zero whole LYTH:
 * every cap passes, N fees are paid, and nothing is credited anywhere. That
 * failure exists only because the weight was divided, which makes it a property
 * of the plan rather than of any one allocation.
 *
 * So detection is per-allocation and the verdict is plan-level. Refusing the
 * whole plan is right on both counts: this surface offers no way to sign "just
 * the ones that work", and the remedy — fewer clusters, or a larger budget — is
 * a plan-level adjustment anyway. A batch refusal is also cheap to recover from;
 * the user changes one number and reviews again.
 *
 * THE ADVICE MUST BE PLAN-LEVEL TOO. The single-path message quotes a minimum
 * per-cluster weight, which is unfollowable across a split: four clusters each
 * needing 5000 bps would be 20000 bps of a 10000 bps wallet. This one quotes how
 * many clusters the budget can actually support.
 *
 * FAILS OPEN. An unreadable balance yields null from the arithmetic (A6) and
 * every allocation reads as not-inert: null means *cannot test*, never *inert*.
 * A zero balance is likewise not inert — there is nothing to round down. Pure.
 */
export function autovoteInertVerdict(args: {
  allocations: readonly AutovoteAllocation[];
  balanceLythoshi: string | null | undefined;
}): AutovoteInertVerdict {
  if (args.allocations.length === 0) return { ok: true };
  const inertClusterIds = args.allocations
    .filter((a) => isInertDelegation(args.balanceLythoshi, a.weightBps))
    .map((a) => a.clusterId);
  if (inertClusterIds.length === 0) return { ok: true };

  const total = args.allocations.length;
  const minBps = minNonInertBps(args.balanceLythoshi);
  const head =
    inertClusterIds.length === total
      ? `None of these ${total} allocations would credit anything at your balance — each would earn nothing and cast no vote, and still cost a fee.`
      : `${inertClusterIds.length} of ${total} allocations would credit nothing at your balance — each would earn nothing and cast no vote, and still cost a fee.`;

  // No weight up to 100% reaches a whole LYTH, so no split of any budget does.
  if (minBps === null) {
    return {
      ok: false,
      inertClusterIds,
      message: `${head} No split reaches a whole LYTH until your balance grows.`,
    };
  }
  // How many clusters this budget can actually carry at that minimum. Integer
  // division, never rounded up — a partial cluster is an inert one.
  const budgetBps = args.allocations.reduce((sum, a) => sum + a.weightBps, 0);
  const supported = Math.floor(budgetBps / minBps);
  if (supported < 1) {
    return {
      ok: false,
      inertClusterIds,
      message: `${head} A cluster needs at least ${minBps} bps at this balance, more than this whole budget — raise the budget.`,
    };
  }
  return {
    ok: false,
    inertClusterIds,
    message: `${head} A cluster needs at least ${minBps} bps at this balance, so this budget supports ${supported} cluster${supported === 1 ? "" : "s"} — spread it across that many or fewer, or raise it.`,
  };
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
  onProgress?: (submitted: number, total: number) => void,
): Promise<SubmitAutovotePlanResult> {
  const txHashes: string[] = [];
  for (const a of plan.allocations) {
    const calldata = buildDelegateCalldata({ clusterId: a.clusterId, weightBps: a.weightBps });
    // Each batch step classifies too — a plan that trips a cap or the row limit
    // mid-run must say which wall it hit, not just that a step failed.
    const result = await withDelegationRevertCopy(() =>
      submitDelegationTx({ seed, data: calldata }),
    );
    txHashes.push(result.txHash);
    onProgress?.(txHashes.length, plan.allocations.length);
  }
  return { txHashes };
}
