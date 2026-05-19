// Staking SDK seam — typed readers for the Stake / Operators pages.
//
// Every chain read flows through `MonolythiumProvider.rpcClient.*`
// just like Phase 1's `loadChainSnapshot`. Errors are surfaced as
// `RpcOutcome` envelopes (same shape as `src/sdk/live.ts`) so the
// UI never has to unwind a thrown `SdkError`.
//
// Chain gaps:
//
// The whitepaper §14 cluster marketplace describes a much richer
// per-cluster signal set than the v2 testnet currently emits. APR,
// reputation, uptime %, total bonded stake (as a value rather than
// derived from operator info), and pending rewards aren't yet
// surfaced by any `lyth_*` method. Where a getter ought to return
// a real number we return `null` plus a `[chain-gap]` reason string;
// the Stake page renders the cell with the existing `[mock]` styling
// so users see "preview" rather than "broken." See GAPs in
// docs/phases/phase-02-staking.md.

import { SdkError } from "@monolythium/core-sdk";
import type {
  ClusterDirectoryEntryResponse,
  ClusterEntityResponse,
  ClusterStatusResponse,
  DelegationCapResponse,
  DelegationRow,
  DelegationsResponse,
  OperatorCapabilitiesResponse,
  OperatorInfoResponse,
  OperatorSigningActivityResponse,
} from "@monolythium/core-sdk";
import { getProvider } from "./client";
import type { RpcOutcome } from "./live";
import { capture } from "./live";

// ─── Public types ────────────────────────────────────────────────

/** One row in the cluster picker. */
export interface ClusterSummary {
  clusterId: number;
  /** Display name (defaults to `C-NNN` until on-chain naming lands). */
  name: string;
  size: number;
  threshold: number;
  active: boolean;
  aggregateHealth: string;
  regionDiversity: string[] | null;
  /** Entity flag — `mono-labs` is the Foundation badge from §30.5. */
  entity: string | null;
  /** APR fraction (e.g. 0.082 for 8.2%); `null` when chain-gapped. */
  apr: number | null;
  /** 0..1 uptime ratio; `null` when chain-gapped. */
  uptime: number | null;
  /** 0..5 reputation; `null` when chain-gapped. */
  reputation: number | null;
  /** Total bonded stake in LYTH (number); `null` when chain-gapped. */
  totalStakeLyth: number | null;
  /** Operator count derived from `size` (always known). */
  operatorCount: number;
  /** Capability badges synthesised from §28.3 attestation. */
  capabilities: CapabilityBadge[];
  /** Sentinel set when one of the optional fields above was chain-gapped. */
  chainGap: string | null;
}

/** Capability surface a cluster operator advertises (§28.3). */
export interface CapabilityBadge {
  /** Surface name as emitted by `lyth_operatorCapabilities` (e.g. `"rpc"`). */
  surface: string;
  status: "active" | "degraded" | "offline" | "unknown";
  /** Optional tracking note (operator-published, e.g. version string). */
  note: string | null;
}

/** A single delegation row in the dashboard. */
export interface Delegation {
  clusterId: number;
  weightBps: number;
  /** Approximate stake amount derived from `weightBps`; null if unavailable. */
  stakeLyth: number | null;
  /** Per-cluster APR copied through from cluster summary. */
  apr: number | null;
  /** Resolved cluster name for display. */
  clusterName: string;
}

/** Pending-reward snapshot for the wallet's RewardCard. */
export interface PendingRewards {
  /** Total across all delegations; `null` when chain-gapped. */
  totalLyth: number | null;
  perCluster: Array<{
    clusterId: number;
    clusterName: string;
    amountLyth: number | null;
  }>;
  /** Block height of the last on-chain claim. `null` when never claimed. */
  lastClaimedHeight: bigint | null;
  chainGap: string | null;
}

/** Full cluster detail used by the Operators page. */
export interface ClusterDetail {
  summary: ClusterSummary;
  status: ClusterStatusResponse;
  entity: ClusterEntityResponse | null;
  operators: OperatorRow[];
  /** Recent slashing history; empty when no events on-chain. */
  slashingHistory: SlashingEvent[];
  chainGap: string | null;
}

export interface OperatorRow {
  operatorId: string;
  moniker: string | null;
  chainAddress: string;
  bonded: boolean;
  bondedAmount: string;
  state: string;
  capabilities: CapabilityBadge[];
  /** Last-N-block sign/miss rate. `null` when signing-activity unavailable. */
  signingMissRate: number | null;
}

export interface SlashingEvent {
  /** Round in which the slash landed. */
  round: bigint;
  operatorId: string;
  reasonCode: string;
  amountLyth: number | null;
}

// ─── Readers ─────────────────────────────────────────────────────

/**
 * Fetch the public cluster directory and synthesise the picker rows.
 * Currently pages once at 100 entries — enough for the v2 launch
 * topology (~100 clusters per §14). When the directory grows the
 * Stake page will introduce paging.
 */
export async function getClusters(): Promise<RpcOutcome<ClusterSummary[]>> {
  const provider = getProvider();
  const client = provider.rpcClient;
  const page = await capture(() => client.lythClusterDirectory(0, 100));
  if (!page.ok || !page.value) {
    return { ok: false, error: page.error ?? "directory unavailable" };
  }
  const summaries: ClusterSummary[] = await Promise.all(
    page.value.clusters.map((row) => summariseCluster(row)),
  );
  return { ok: true, value: summaries };
}

async function summariseCluster(
  row: ClusterDirectoryEntryResponse,
): Promise<ClusterSummary> {
  const provider = getProvider();
  const entityCall = await capture(() =>
    provider.rpcClient.lythGetClusterEntity(row.clusterId),
  );
  const entity = entityCall.ok ? entityCall.value?.entity ?? null : null;
  return {
    clusterId: row.clusterId,
    name: deriveClusterName(row.clusterId, entity),
    size: row.size,
    threshold: row.threshold,
    active: row.active,
    aggregateHealth: row.aggregateHealth,
    regionDiversity: row.regionDiversity,
    entity,
    // Chain-gapped fields — none of these surface on the v2 testnet
    // yet; the Stake page renders `null` with a `[mock]` tag.
    apr: null,
    uptime: null,
    reputation: null,
    totalStakeLyth: null,
    operatorCount: row.size,
    capabilities: [],
    chainGap:
      "apr / reputation / uptime / total-stake not yet emitted by chain",
  };
}

function deriveClusterName(clusterId: number, entity: string | null): string {
  // Until the on-chain cluster-name-registry (§22.4) is reachable
  // from the wallet, prefer the entity flag for foundation clusters
  // and fall back to `C-NNN`. The §22.4 lookup is Phase 4 (Naming).
  if (entity === "mono-labs") return `C-${pad3(clusterId)} · Foundation`;
  return `C-${pad3(clusterId)}`;
}

function pad3(n: number): string {
  return String(n + 1).padStart(3, "0");
}

/**
 * Fetch active delegations for `wallet`. Returned rows include the
 * resolved cluster name + per-row stake estimate.
 *
 * The stake estimate is derived from `weightBps` against the wallet's
 * balance — that is, current behaviour treats `weightBps` as a
 * percentage of the wallet's bonded LYTH. The chain hasn't yet
 * surfaced an "amount per delegation" primitive; this estimate is
 * intentionally approximate. Surface it with `[mock]` styling where
 * shown.
 */
export async function getDelegations(
  wallet: string,
): Promise<RpcOutcome<Delegation[]>> {
  const provider = getProvider();
  const rows = await capture<DelegationsResponse>(() =>
    provider.rpcClient.lythGetDelegations(wallet),
  );
  if (!rows.ok || !rows.value) {
    return { ok: false, error: rows.error ?? "no delegations" };
  }
  // Resolve cluster names in parallel.
  const named = await Promise.all(
    rows.value.rows.map(async (row): Promise<Delegation> => {
      const entityCall = await capture(() =>
        provider.rpcClient.lythGetClusterEntity(row.cluster),
      );
      const entity = entityCall.ok ? entityCall.value?.entity ?? null : null;
      return {
        clusterId: row.cluster,
        weightBps: row.weightBps,
        stakeLyth: null,
        apr: null,
        clusterName: deriveClusterName(row.cluster, entity),
      };
    }),
  );
  return { ok: true, value: named };
}

/**
 * Pending-reward snapshot. The v2 testnet doesn't yet expose a
 * `lyth_pendingRewards` RPC, so this returns a chain-gapped sentinel
 * envelope; the wallet renders the RewardCard in `[mock]` mode.
 *
 * When the chain ships the method, switch the body to call it and
 * drop the sentinel. The shape of the return value is already
 * future-proof.
 */
export async function getRewards(
  wallet: string,
): Promise<RpcOutcome<PendingRewards>> {
  // Pull the wallet's delegations so the per-cluster array is
  // populated with the right cluster names even while amounts are
  // sentinel-null.
  const dels = await getDelegations(wallet);
  if (!dels.ok || !dels.value) {
    return {
      ok: true,
      value: {
        totalLyth: null,
        perCluster: [],
        lastClaimedHeight: null,
        chainGap:
          "lyth_pendingRewards not yet emitted by chain; delegations also unavailable",
      },
    };
  }
  return {
    ok: true,
    value: {
      totalLyth: null,
      perCluster: dels.value.map((d) => ({
        clusterId: d.clusterId,
        clusterName: d.clusterName,
        amountLyth: null,
      })),
      lastClaimedHeight: null,
      chainGap: "lyth_pendingRewards not yet emitted by chain",
    },
  };
}

/**
 * Active per-cluster delegation cap (§23.7). Returns a basis-points
 * number in the [0, 10000] range, or `null` if the cap is disabled
 * (chain encodes that as `u32::MAX`).
 */
export async function getDelegationCap(): Promise<RpcOutcome<number | null>> {
  const provider = getProvider();
  const cap = await capture<DelegationCapResponse>(() =>
    provider.rpcClient.lythGetDelegationCap(),
  );
  if (!cap.ok || !cap.value) {
    return { ok: false, error: cap.error ?? "cap unavailable" };
  }
  // u32::MAX = 4294967295 — treat as "no cap" per §23.7.
  if (cap.value.capBps >= 4_000_000_000) return { ok: true, value: null };
  return { ok: true, value: cap.value.capBps };
}

/**
 * Full per-cluster detail surfaced by the Operators page. Pulls the
 * cluster summary, status, entity flag, and per-operator info /
 * capabilities / signing activity in parallel.
 */
export async function getClusterDetail(
  clusterId: number,
): Promise<RpcOutcome<ClusterDetail>> {
  const provider = getProvider();
  const [summary, status, entity] = await Promise.all([
    getClusterSummary(clusterId),
    capture<ClusterStatusResponse>(() =>
      provider.rpcClient.lythClusterStatus(clusterId),
    ),
    capture<ClusterEntityResponse>(() =>
      provider.rpcClient.lythGetClusterEntity(clusterId),
    ),
  ]);
  if (!summary.ok || !summary.value) {
    return { ok: false, error: summary.error ?? "summary unavailable" };
  }
  if (!status.ok || !status.value) {
    return { ok: false, error: status.error ?? "status unavailable" };
  }

  const operators: OperatorRow[] = await Promise.all(
    status.value.members.map(async (member): Promise<OperatorRow> => {
      const info = await capture<OperatorInfoResponse>(() =>
        provider.rpcClient.lythOperatorInfo(member.operatorId),
      );
      const caps = await capture<OperatorCapabilitiesResponse>(() =>
        provider.rpcClient.lythOperatorCapabilities(),
      );
      return {
        operatorId: member.operatorId,
        moniker: info.ok ? info.value?.moniker ?? null : null,
        chainAddress: info.ok ? info.value?.chainAddress ?? "" : "",
        bonded: info.ok ? Boolean(info.value?.bonded) : false,
        bondedAmount: info.ok ? info.value?.bondedAmount ?? "0" : "0",
        state: member.state,
        capabilities: caps.ok ? translateCapabilities(caps.value) : [],
        // Signing-activity per-member would page through every authority
        // index; defer to the on-detail-screen render rather than batch
        // here. Wallet currently leaves this `null` and the detail panel
        // refines it via `getOperatorSigningActivity` on focus.
        signingMissRate: null,
      };
    }),
  );

  return {
    ok: true,
    value: {
      summary: summary.value,
      status: status.value,
      entity: entity.ok ? entity.value ?? null : null,
      operators,
      slashingHistory: [],
      chainGap: summary.value.chainGap,
    },
  };
}

async function getClusterSummary(
  clusterId: number,
): Promise<RpcOutcome<ClusterSummary>> {
  // Reuse the directory page lookup but filter for this id. For a
  // 100-entry directory this is the simplest path that re-uses
  // `summariseCluster` end-to-end.
  const all = await getClusters();
  if (!all.ok || !all.value) {
    return { ok: false, error: all.error ?? "directory unavailable" };
  }
  const match = all.value.find((c) => c.clusterId === clusterId);
  if (!match) {
    return { ok: false, error: `cluster ${clusterId} not in directory` };
  }
  return { ok: true, value: match };
}

/**
 * Capability badges for a single operator, derived from the
 * network-wide `lyth_operatorCapabilities` snapshot.
 *
 * The chain currently emits surfaces at network scope rather than
 * per-operator. Until that splits, this helper returns the same
 * surface set for every operator with the chain-gap caveat the UI
 * can render.
 */
export async function getOperatorCapabilities(
  _operatorId: string,
): Promise<RpcOutcome<CapabilityBadge[]>> {
  const provider = getProvider();
  const caps = await capture<OperatorCapabilitiesResponse>(() =>
    provider.rpcClient.lythOperatorCapabilities(),
  );
  if (!caps.ok || !caps.value) {
    return { ok: false, error: caps.error ?? "capabilities unavailable" };
  }
  return { ok: true, value: translateCapabilities(caps.value) };
}

function translateCapabilities(
  response: OperatorCapabilitiesResponse | undefined,
): CapabilityBadge[] {
  if (!response) return [];
  return Object.entries(response.surfaces).map(([surface, cap]) => ({
    surface,
    status: translateSurfaceStatus(cap.status),
    note: cap.tracking ?? null,
  }));
}

function translateSurfaceStatus(
  raw: unknown,
): "active" | "degraded" | "offline" | "unknown" {
  if (typeof raw !== "string") return "unknown";
  const s = raw.toLowerCase();
  if (s === "active" || s === "ok") return "active";
  if (s === "degraded" || s === "lagging") return "degraded";
  if (s === "offline" || s === "down") return "offline";
  return "unknown";
}

/**
 * Operator-level signing activity for the Operators detail panel.
 *
 * Wallet code typically pulls this on-focus rather than as part of
 * the batched cluster summary, since the network call is per
 * operator + per N-block window.
 */
export async function getOperatorSigningActivity(
  authorityIndex: number,
  limit = 100,
): Promise<RpcOutcome<OperatorSigningActivityResponse>> {
  const provider = getProvider();
  return capture(() => provider.rpcClient.lythSigningActivity(authorityIndex, limit));
}

/**
 * Surface raw `SdkError` for the rare caller that needs the typed
 * envelope instead of the `RpcOutcome` shape. Used by tests.
 */
export { SdkError };
// Re-export DelegationRow so dashboard code doesn't have to dig into
// the SDK bindings tree just to type a callback.
export type { DelegationRow };
