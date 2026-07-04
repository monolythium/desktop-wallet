// Delegate page — DVT cluster delegation.
//
// Top: spendable balance + effective weight + non-custodial copy; a
// rewards/actions block (pending rewards → Claim all; effective weight →
// Undelegate all); and the wallet's Active delegations, each row carrying the
// derived LYTH figure (balance × weightBps ÷ 10000, or a bps-only fallback) and
// the Delegate / Redelegate / Undelegate action flows.
// Lower cards (cluster directory + Details, autovote) are later passes.
// Every write routes through the OperationsDrawer (password unlock → vault seed
// → delegation precompile call → plaintext mesh_submitTx submit).

import { useEffect, useState } from "react";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
  PendingRewardsResponse,
  RedemptionQueueResponse,
} from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { useActiveWallet } from "../sdk/active-wallet";
import {
  DELEGATION_PRECOMPILE,
  buildClaimRewardsCalldata,
  buildDelegateCalldata,
  buildRedelegateCalldata,
  buildSetAutoCompoundCalldata,
  buildUndelegateCalldata,
  fetchClusterDirectory,
  fetchPendingRewards,
  fetchRedemptionQueue,
  formatRewardLyth,
  hasClaimableRewards,
  submitDelegationTx,
} from "../sdk/delegation";
import {
  capture,
  loadLiveClusterAprBpsMap,
  loadLiveClusterDelegatorCount,
  loadLiveClusterEntities,
  loadLiveClusterNames,
  loadLiveClusterStatus,
  loadNativeBalanceLythoshi,
  type LiveClusterOperatorStatus,
  type RpcOutcome,
} from "../sdk/live";
import { bpsToPercentLabel } from "../sdk/delegation-summary";
import {
  activeDelegationsSummary,
  effectiveWeightLythDisplay,
} from "../sdk/delegation-derive";
import {
  aprLabelFromBps,
  clusterActivity,
  truncateWithMore,
} from "../sdk/delegation-cards";
import { formatLythDisplay, truncateDecimals } from "../sdk/lyth-display";
import {
  buildAutovotePlan,
  fetchClusterDiversities,
  submitAutovotePlan,
  type AutovoteMode,
} from "../sdk/autovote";
import {
  loadLiveDelegationStatus,
  type LiveDelegationStatus,
} from "../sdk/live";
import {
  delegateCapWarning,
  normalizeAggregateCapBps,
  preflightDelegationVerdict,
} from "../sdk/delegation-caps";

interface DelegateProps {
  /** Gate the experimental autovote planner (and the diversity reads that feed
   *  it). */
  experimentalEnabled?: boolean;
}

export function Delegate({ experimentalEnabled }: DelegateProps = {}) {
  const ops = useOperations();
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [status, setStatus] = useState<LiveDelegationStatus | null>(null);
  // Live wallet balance (raw lythoshi) — the basis for every derived LYTH figure
  // on this page. RpcOutcome so a failed read falls back to a bps-only display
  // (an honest "—" for LYTH) rather than a fabricated number.
  const [balance, setBalance] = useState<RpcOutcome<string> | null>(null);
  const [busy, setBusy] = useState(false);
  // Add-more delegate draft on an active-delegation row (distinct from the
  // redelegate draft + the directory-card delegate form).
  const [delegateMoreFor, setDelegateMoreFor] = useState<number | null>(null);
  const [delegateMoreBps, setDelegateMoreBps] = useState("1000");
  const [delegateMoreError, setDelegateMoreError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<ClusterDirectoryEntryResponse[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  // Pending delegation rewards (lyth_pendingRewards). RpcOutcome so a node
  // failure surfaces the verbatim error rather than a blank/fabricated zero.
  const [rewards, setRewards] = useState<RpcOutcome<PendingRewardsResponse> | null>(null);
  // Open redemption tickets (lyth_redemptionQueue) — READ ONLY. The model is
  // non-custodial: undelegate is instant, so a healthy wallet's queue is empty.
  // Surfaced for transparency over any legacy ticket; there is no settle action
  // (the chain removed completeRedemption — calling it now reverts). RpcOutcome
  // so a node failure shows the verbatim error rather than a fabricated empty.
  const [redemptions, setRedemptions] = useState<RpcOutcome<RedemptionQueueResponse> | null>(null);
  const [openForm, setOpenForm] = useState<number | null>(null);
  // Redelegate draft: which source delegation row is open, plus the
  // destination cluster + weight to move. Distinct from the delegate form.
  const [redelegateFrom, setRedelegateFrom] = useState<number | null>(null);
  const [redelegateTo, setRedelegateTo] = useState("");
  const [redelegateWeightBps, setRedelegateWeightBps] = useState("1000");
  const [redelegateError, setRedelegateError] = useState<string | null>(null);
  const [draftWeightBps, setDraftWeightBps] = useState("1000");
  const [draftError, setDraftError] = useState<string | null>(null);
  // Read-only per-cluster diversity scores (lyth_getClusterDiversity, PF-6),
  // keyed by clusterId. Feeds the autovote Max Diversity / Max Decentralization
  // planners (experimental).
  const [diversities, setDiversities] = useState<
    Map<number, ClusterDiversityView>
  >(new Map());
  // Live per-cluster raw APR (lyth_clusterApr → aprBps), keyed by clusterId. A
  // real 0 IS present (renders "0.00%"); a missing key means the read was
  // unavailable, so the card renders an honest "—".
  const [aprBpsMap, setAprBpsMap] = useState<Map<number, number>>(new Map());
  // Live per-cluster operating entity (lyth_getClusterEntity), keyed by
  // clusterId. A missing key → "—".
  const [entities, setEntities] = useState<Map<number, string>>(new Map());
  // Which cluster's "More details" is expanded, plus the lazily-fetched detail
  // (lyth_clusterStatus + lyth_getClusterDelegators) cached per cluster. Each
  // field is null when its read failed → the detail renders an honest "—".
  const [expandedDetail, setExpandedDetail] = useState<number | null>(null);
  const [detailByCluster, setDetailByCluster] = useState<
    Map<
      number,
      { loading: boolean; status: LiveClusterOperatorStatus | null; delegators: number | null }
    >
  >(new Map());
  // Live cluster display names (lyth_getClusterName), keyed by clusterId, so a
  // delegation captures the real cluster name at submit (sticky on its pending
  // + notification rows). A missing key means "unnamed" → "Cluster #<id>".
  const [names, setNames] = useState<Map<number, string>>(new Map());
  // Autovote (§25.1): weight budget (cap) to spread across clusters.
  const [autoCapBps, setAutoCapBps] = useState("5000");
  const [autovoteBusy, setAutovoteBusy] = useState(false);
  const [autovoteError, setAutovoteError] = useState<string | null>(null);

  const refresh = async () => {
    if (!walletAddress) {
      setStatus(null);
      setBalance(null);
      setDirectory([]);
      setDirectoryError(null);
      setRewards(null);
      setRedemptions(null);
      setAprBpsMap(new Map());
      setEntities(new Map());
      setExpandedDetail(null);
      setDetailByCluster(new Map());
      setNames(new Map());
      return;
    }
    setBusy(true);
    // A fresh load invalidates any expanded cluster detail.
    setExpandedDetail(null);
    setDetailByCluster(new Map());
    try {
      const [s, bal, dir, rew, red] = await Promise.all([
        loadLiveDelegationStatus(walletAddress),
        capture(() => loadNativeBalanceLythoshi(walletAddress)),
        fetchClusterDirectory(1, 20).catch((cause: unknown) => {
          setDirectoryError((cause as Error)?.message ?? "directory unavailable");
          return null;
        }),
        capture(() => fetchPendingRewards(walletAddress)),
        capture(() => fetchRedemptionQueue(walletAddress)),
      ]);
      setStatus(s);
      setBalance(bal);
      setRewards(rew);
      setRedemptions(red);
      if (dir) {
        setDirectory(dir.clusters);
        setDirectoryError(null);
        // Fan out the live per-cluster raw APR (aprBps) reads for the cards;
        // tolerant of per-cluster failures (a missing entry renders "—"). A real
        // 0 is included and renders "0.00%".
        loadLiveClusterAprBpsMap(dir.clusters.map((c) => c.clusterId))
          .then(setAprBpsMap)
          .catch(() => setAprBpsMap(new Map()));
        // Resolve each cluster's operating entity for the card; tolerant of
        // per-cluster failures (a missing entity renders "—").
        loadLiveClusterEntities(dir.clusters.map((c) => c.clusterId))
          .then(setEntities)
          .catch(() => setEntities(new Map()));
        // Resolve cluster names so a delegation can capture the real name at
        // submit; tolerant of per-cluster failures (a missing name → #id).
        loadLiveClusterNames(dir.clusters.map((c) => c.clusterId))
          .then(setNames)
          .catch(() => setNames(new Map()));
        // Fan out the per-cluster diversity reads; tolerant of per-cluster
        // failures (a missing score just renders "—"). Only when the
        // experimental surfaces are enabled — the autovote planner and the
        // directory diversity column are the only consumers.
        if (experimentalEnabled) {
          fetchClusterDiversities(dir.clusters)
            .then(setDiversities)
            .catch(() => setDiversities(new Map()));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [walletAddress]);

  // Lazily load a cluster's "More details" (lyth_clusterStatus +
  // lyth_getClusterDelegators) the first time it is expanded, cached per
  // cluster. Best-effort — a failed read leaves the field null → an honest "—".
  useEffect(() => {
    const id = expandedDetail;
    if (id === null || detailByCluster.has(id)) return;
    setDetailByCluster((prev) => {
      const next = new Map(prev);
      next.set(id, { loading: true, status: null, delegators: null });
      return next;
    });
    void Promise.all([
      loadLiveClusterStatus(id),
      loadLiveClusterDelegatorCount(id),
    ]).then(([status, delegators]) => {
      setDetailByCluster((prev) => {
        const next = new Map(prev);
        next.set(id, { loading: false, status, delegators });
        return next;
      });
    });
  }, [expandedDetail, detailByCluster]);

  const delegations = status?.delegations.ok ? status.delegations.value : null;
  const delegationHistory = status?.delegationHistory.ok
    ? status.delegationHistory.value ?? []
    : [];
  // A FAILED history read must not read as a confirmed-empty "no activity" — it
  // is an honest error, distinct from a genuinely empty history.
  const delegationHistoryError =
    status?.delegationHistory.ok === false
      ? status.delegationHistory.error ?? "unavailable"
      : null;
  // Live cluster-aggregate cap, normalized: the u32::MAX disabled sentinel and a
  // failed/absent read both collapse to null (→ the fixed 50% per-cluster floor
  // applies), never a fabricated cap.
  const aggregateCapBps = (() => {
    const cap = status?.delegationCap;
    if (!cap || !cap.ok) return null;
    const v = cap.value as { capBps?: unknown } | null;
    const raw = v && typeof v.capBps === "number" ? v.capBps : null;
    return normalizeAggregateCapBps(raw);
  })();

  const selfBech32m = walletAddress;

  // The live balance (raw lythoshi) or null — the basis for every derived LYTH
  // figure. When null, callers fall back to the bps-only percent.
  const balanceLythoshi = balance?.ok ? balance.value ?? null : null;
  const delegationRows = delegations?.rows ?? [];
  const totalBps = delegations?.totalBps ?? 0;
  const summary = activeDelegationsSummary(delegationRows, totalBps);
  const clusterName = (id: number) => names.get(id) ?? `Cluster #${id}`;
  /** Effective-weight label: "<LYTH> (<pct>)" when the balance is known, else a
   *  bps-only "<pct>" — never a fabricated LYTH figure. */
  const effectiveWeightLabel = (bps: number): string => {
    const lyth = effectiveWeightLythDisplay(balanceLythoshi, bps, 4);
    const pct = bpsToPercentLabel(bps);
    return lyth === null ? pct : `${lyth} LYTH (${pct})`;
  };
  /** Per-row effective-weight: derived LYTH, or the bps-only percent fallback. */
  const rowWeightLabel = (bps: number): string => {
    const lyth = effectiveWeightLythDisplay(balanceLythoshi, bps, 4);
    return lyth === null ? bpsToPercentLabel(bps) : `${lyth} LYTH`;
  };

  const openDelegate = (clusterId: number, weightBps: number) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Delegate ${weightLabel} to cluster ${clusterId}`,
      subtitle: `Weight ${weightLabel} of your balance — non-custodial, tokens stay liquid`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Cluster", v: String(clusterId) },
        { k: "Weight", v: `${weightLabel} of balance` },
        { k: "Value", v: "0 LYTH (non-custodial)" },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes delegate(uint32 clusterId, uint16 weightBps) calldata via @monolythium/core-sdk." },
        { text: "Sends value = 0 — NO tokens are escrowed. Your effective weight = balance × weightBps; the LYTH stays in your wallet and remains spendable." },
        { text: "Signs the native tx with ML-DSA-65 and submits via the plaintext mesh_submitTx path." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off, the cluster is inactive, the per-cluster cap would be exceeded, or any value is attached (UnexpectedValue) — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "delegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
        clusterId,
        clusterName: names.get(clusterId),
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildDelegateCalldata(clusterId, weightBps);
        const result = await submitDelegationTx({
          seed: ctx.vaultSeed,
          data: calldata,
        });
        return {
          headline: `Delegated ${weightLabel} of balance to cluster ${clusterId}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
    setOpenForm(null);
    setDraftError(null);
  };

  const openUndelegate = (clusterId: number, weightBps: number) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Undelegate from cluster ${clusterId}`,
      subtitle: `Undelegate ${weightLabel} of wallet weight — instant, nothing was locked`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Cluster", v: String(clusterId) },
        { k: "Weight removed", v: weightLabel },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes undelegate(uint32 clusterId) calldata via @monolythium/core-sdk — instantly removes the entire delegation row for this cluster." },
        { text: "Instant — no redemption queue or cooldown. Your tokens were never escrowed, so the weighting simply drops." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off or no delegation row exists for this cluster — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "undelegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
        clusterId,
        clusterName: names.get(clusterId),
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildUndelegateCalldata(clusterId);
        const result = await submitDelegationTx({ seed: ctx.vaultSeed, data: calldata });
        return {
          headline: `Undelegated ${weightLabel} from cluster ${clusterId}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
  };

  /** Undelegate EVERY delegated cluster in one authorized session: a single
   *  keychain unlock, then N sequential undelegate() calls (there is no bulk
   *  undelegate primitive — this reuses the per-cluster action across all rows,
   *  like the autovote submit). */
  const openUndelegateAll = () => {
    // Only rows carrying weight — consistent with the button's `summary.count`
    // gate (a zero-weight row has no delegation to remove and the chain would
    // reject its undelegate, aborting the batch).
    const rows = delegationRows.filter((r) => r.weightBps > 0);
    if (rows.length === 0) return;
    const totalPct = bpsToPercentLabel(totalBps);
    ops.open({
      title: `Undelegate all · ${rows.length} cluster${rows.length === 1 ? "" : "s"}`,
      subtitle: `Remove ${totalPct} of wallet weight across every cluster — instant, nothing was locked`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Clusters", v: String(rows.length) },
        { k: "Weight removed", v: totalPct },
        ...rows.map((r) => ({
          k: clusterName(r.cluster),
          v: `${(r.weightBps / 100).toFixed(2)}%`,
        })),
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: `Submits ${rows.length} sequential undelegate(uint32 clusterId) calls via @monolythium/core-sdk — one per delegated cluster.` },
        { text: "Instant — no redemption queue or cooldown. Your tokens were never escrowed, so the weighting simply drops." },
        {
          text: "Each call may be rejected at the precompile gate (delegation gated off, or a cluster row already gone) — verbatim errors surface here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "undelegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        let last = { txHash: "", nonce: 0 };
        for (const r of rows) {
          const calldata = buildUndelegateCalldata(r.cluster);
          last = await submitDelegationTx({ seed: ctx.vaultSeed, data: calldata });
        }
        return {
          headline: `Undelegated all ${rows.length} cluster${rows.length === 1 ? "" : "s"}`,
          detail: last.txHash,
          txHash: last.txHash,
          nonce: last.nonce,
        };
      },
    });
  };

  const openRedelegate = (
    fromCluster: number,
    toCluster: number,
    weightBps: number,
  ) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Redelegate cluster ${fromCluster} → ${toCluster}`,
      subtitle: `Move ${weightLabel} of wallet weight without an unbonding round`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Source cluster", v: String(fromCluster) },
        { k: "Destination cluster", v: String(toCluster) },
        { k: "Weight moved", v: weightLabel },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes redelegate(uint32 fromCluster, uint32 toCluster, uint16 weightBps) calldata via @monolythium/core-sdk." },
        { text: "Moves voting weight directly between clusters — no redemption ticket, no unbonding wait." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off, the destination is inactive, the source has insufficient weight, or a per-cluster cap would be exceeded — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "redelegate",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
        clusterId: toCluster,
        clusterName: names.get(toCluster),
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildRedelegateCalldata(fromCluster, toCluster, weightBps);
        const result = await submitDelegationTx({ seed: ctx.vaultSeed, data: calldata });
        return {
          headline: `Redelegated ${weightLabel} from cluster ${fromCluster} to ${toCluster}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
    setRedelegateFrom(null);
    setRedelegateError(null);
  };

  const openClaim = (totalLyth: string) => {
    ops.open({
      title: "Claim delegation rewards",
      subtitle: `Settle and withdraw ${totalLyth} LYTH of pending delegation rewards`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Claimable", v: `${totalLyth} LYTH` },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes claim() calldata via @monolythium/core-sdk — settles per-cluster reward indices and withdraws the accrued rewards to this wallet." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off or there is nothing to claim — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "claim",
        amountDecimal: totalLyth,
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildClaimRewardsCalldata();
        const result = await submitDelegationTx({ seed: ctx.vaultSeed, data: calldata });
        return {
          headline: `Claimed ${totalLyth} LYTH of delegation rewards`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
  };

  const openAutoCompoundToggle = (next: boolean) => {
    ops.open({
      title: next ? "Enable auto-compound" : "Disable auto-compound",
      subtitle: next
        ? "Re-delegate settled rewards automatically instead of leaving them claimable"
        : "Leave settled rewards claimable instead of re-delegating them",
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Auto-compound", v: next ? "on" : "off" },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes setAutoCompound(bool enabled) calldata via @monolythium/core-sdk — persists the preference on-chain for this wallet." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        // No dedicated auto-compound op kind in TxOpKind — it is a delegation
        // precompile call, so it records as a generic contract call.
        kind: "contract_call",
        amountDecimal: "0",
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildSetAutoCompoundCalldata(next);
        const result = await submitDelegationTx({ seed: ctx.vaultSeed, data: calldata });
        return {
          headline: `Auto-compound ${next ? "enabled" : "disabled"}`,
          detail: result.txHash,
          txHash: result.txHash,
          nonce: result.nonce,
        };
      },
    });
  };

  const runAutovote = (mode: Exclude<AutovoteMode, "custom">) => {
    setAutovoteError(null);

    const capBps = parseInt(autoCapBps, 10);
    if (!Number.isFinite(capBps) || capBps <= 0 || capBps > 10_000) {
      setAutovoteError("Weight budget must be 1-10000 basis points (0.01% – 100%).");
      return;
    }

    const plan = buildAutovotePlan({
      mode,
      clusters: directory,
      diversities,
      capBps,
    });

    if (plan.allocations.length === 0) {
      setAutovoteError(
        plan.warnings[0] ?? "No active clusters available for an autovote plan.",
      );
      return;
    }

    const modeLabel: Record<Exclude<AutovoteMode, "custom">, string> = {
      maxYield: "Max Yield",
      maxDiversity: "Max Diversity",
      maxDecentralization: "Max Decentralization",
    };

    ops.open({
      title: `Autovote · ${modeLabel[mode]}`,
      subtitle: `Spread a ${(plan.totalWeightBps / 100).toFixed(2)}% weight budget across ${plan.allocations.length} clusters — non-custodial`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Mode", v: modeLabel[mode] },
        { k: "Clusters", v: String(plan.allocations.length) },
        { k: "Total weight", v: `${(plan.totalWeightBps / 100).toFixed(2)}% of balance` },
        ...plan.allocations.map((a) => ({
          k: `Cluster ${a.clusterId}`,
          v: `${(a.weightBps / 100).toFixed(2)}%`,
        })),
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        {
          text: `Submits ${plan.allocations.length} sequential delegate(uint32 clusterId, uint16 weightBps) calls via @monolythium/core-sdk.`,
        },
        ...(mode === "maxYield"
          ? [
              {
                text: "Max Yield ranks by cluster health (no per-cluster APR exists on-chain in this SDK), not a guaranteed return.",
                level: "warn" as const,
              },
            ]
          : []),
        ...plan.warnings.map((w) => ({ text: w, level: "warn" as const })),
        {
          text: "Each call may be rejected at the precompile gate if delegation is gated off, a cluster is inactive, or a per-cluster cap would be exceeded — verbatim errors surface here.",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        setAutovoteBusy(true);
        try {
          const result = await submitAutovotePlan(plan, ctx.vaultSeed);
          return {
            headline: `Autovote ${modeLabel[mode]} · ${result.txHashes.length} delegations submitted`,
            detail: result.txHashes.join(", "),
          };
        } finally {
          setAutovoteBusy(false);
        }
      },
    });
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Delegate</h1>
        <div className="sub">
          Delegating is non-custodial — your full balance stays liquid and
          spendable. Effective weight tracks your live balance.
        </div>
      </div>

      {/* Header facts + rewards/actions. Spendable balance is a real read
          (eth_getBalance); Effective weight LYTH is derived (balance × bps ÷
          10000) and falls back to a bps-only percent when the balance read is
          unavailable — never a fabricated LYTH figure. */}
      <div className="w-card">
        <div className="w-card__head">
          <h3>Delegation</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {!walletAddress ? (
            <div className="row-help">Select or unlock a wallet to delegate.</div>
          ) : (
            <>
              <div className="w-live-grid">
                <LiveCell
                  label="Spendable balance"
                  value={
                    balance === null
                      ? "loading"
                      : balanceLythoshi !== null
                        ? `${formatLythDisplay(balanceLythoshi, 4) ?? "—"} LYTH`
                        : "—"
                  }
                />
                <LiveCell label="Effective weight" value={effectiveWeightLabel(totalBps)} />
              </div>

              <div className="w-live-grid" style={{ marginTop: 12 }}>
                <div className="w-live-cell">
                  <div className="cap">Pending rewards</div>
                  {rewards === null ? (
                    <div className="row-help">Loading…</div>
                  ) : rewards.ok === false ? (
                    <div className="w-live-error">{rewards.error}</div>
                  ) : rewards.value ? (
                    (() => {
                      const r = rewards.value;
                      const pendingLyth = truncateDecimals(
                        formatRewardLyth(r.totalAmountLythoshi),
                        4,
                      );
                      const claimable = hasClaimableRewards(r);
                      return (
                        <>
                          <div>{pendingLyth} LYTH</div>
                          <button
                            className="btn btn--sm btn--primary"
                            style={{ marginTop: 8 }}
                            disabled={!claimable}
                            title={
                              claimable
                                ? "Settle and withdraw all pending rewards"
                                : "Nothing to claim"
                            }
                            onClick={() => openClaim(pendingLyth)}
                          >
                            Claim all
                          </button>
                        </>
                      );
                    })()
                  ) : (
                    <div>—</div>
                  )}
                </div>

                <div className="w-live-cell">
                  <div className="cap">Effective weight</div>
                  <div>{effectiveWeightLabel(totalBps)}</div>
                  <button
                    className="btn btn--sm"
                    style={{ marginTop: 8 }}
                    disabled={summary.count === 0}
                    title={
                      summary.count > 0
                        ? "Undelegate every cluster in one session"
                        : "No active delegations"
                    }
                    onClick={openUndelegateAll}
                  >
                    Undelegate all
                  </button>
                </div>
              </div>

              {/* Secondary reward detail + the auto-compound action (a real read
                  + a real write — preserved, not stubbed). */}
              {rewards?.ok && rewards.value ? (
                <div
                  className="row-help"
                  style={{
                    marginTop: 10,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span>
                    Settled{" "}
                    {truncateDecimals(formatRewardLyth(rewards.value.settledPendingLythoshi), 4)} LYTH
                  </span>
                  <span>
                    · Unsettled{" "}
                    {truncateDecimals(formatRewardLyth(rewards.value.unsettledAmountLythoshi), 4)} LYTH
                  </span>
                  <span>· Auto-compound {rewards.value.autoCompound ? "on" : "off"}</span>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => openAutoCompoundToggle(!rewards.value!.autoCompound)}
                  >
                    {rewards.value.autoCompound ? "Disable auto-compound" : "Enable auto-compound"}
                  </button>
                </div>
              ) : null}

              {balance?.ok === false ? (
                <div className="row-help" style={{ marginTop: 8 }}>
                  Balance read unavailable — showing weight as a percent only.
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Active delegations — the wallet's per-cluster delegation rows, each
          with the derived LYTH (or bps-only) figure and the three action flows
          (Delegate / Redelegate / Undelegate), all reusing the existing
          precompile actions. */}
      {walletAddress ? (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Active delegations</h3>
            <span className="w-card__head__spacer" />
            <span className="row-help mono">
              {summary.count} cluster{summary.count === 1 ? "" : "s"} · {summary.percentLabel} total
            </span>
          </div>
          <div className="w-card__body">
            {status?.delegations.ok === false ? (
              <div className="w-live-error">delegations: {status.delegations.error}</div>
            ) : status === null ? (
              <div className="row-help">Loading delegations…</div>
            ) : delegationRows.length === 0 ? (
              <div className="row-help">
                You are not delegating to any cluster yet. Pick a cluster from the
                directory below to start.
              </div>
            ) : (
              <div className="w-live-list">
                {delegationRows.map((row) => {
                  const isRedelegating = redelegateFrom === row.cluster;
                  const isDelegatingMore = delegateMoreFor === row.cluster;
                  return (
                    <div
                      key={row.cluster}
                      style={{ display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      <div className="w-live-row">
                        <div>
                          <div className="row-label">{clusterName(row.cluster)}</div>
                          {/* Percent is a real read (weightBps); the LYTH figure
                              is derived from the live balance, or bps-only when
                              the balance is unavailable — never fabricated. */}
                          <div className="row-help mono">
                            {(row.weightBps / 100).toFixed(2)}% · {rowWeightLabel(row.weightBps)}
                          </div>
                        </div>
                        <div
                          className="w-live-right"
                          style={{ display: "flex", alignItems: "center", gap: 8 }}
                        >
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                              setDelegateMoreFor(row.cluster);
                              setDelegateMoreBps("1000");
                              setDelegateMoreError(null);
                            }}
                          >
                            Delegate
                          </button>
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => {
                              setRedelegateFrom(row.cluster);
                              setRedelegateTo("");
                              setRedelegateWeightBps(String(row.weightBps));
                              setRedelegateError(null);
                            }}
                          >
                            Redelegate
                          </button>
                          <button
                            className="btn btn--sm"
                            onClick={() => openUndelegate(row.cluster, row.weightBps)}
                          >
                            Undelegate
                          </button>
                        </div>
                      </div>

                      {isDelegatingMore && (
                        <div style={inlineFormStyle}>
                          <label style={redelegateLabelStyle}>
                            Additional weight to delegate (basis points · 100 = 1%)
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={10000}
                            value={delegateMoreBps}
                            onChange={(e) => {
                              setDelegateMoreBps(e.target.value);
                              setDelegateMoreError(null);
                            }}
                            style={autovoteInputStyle}
                          />
                          {delegateMoreError && (
                            <div className="row-help" style={{ color: "var(--err)" }}>
                              {delegateMoreError}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn btn--sm"
                              onClick={() => {
                                setDelegateMoreFor(null);
                                setDelegateMoreError(null);
                              }}
                              style={{ flex: 1 }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn btn--sm btn--primary"
                              onClick={() => {
                                const bps = parseInt(delegateMoreBps, 10);
                                if (!Number.isFinite(bps) || bps <= 0 || bps > 10000) {
                                  setDelegateMoreError(
                                    "Weight must be 1–10000 basis points (0.01% – 100%).",
                                  );
                                  return;
                                }
                                // Same dual-cap pre-flight the directory Delegate
                                // form runs — add-more stacks onto an existing
                                // delegation, so it is the most cap-prone path.
                                const verdict = preflightDelegationVerdict({
                                  action: "delegate",
                                  dstExistingWeightBps: row.weightBps,
                                  totalDelegatedBps: totalBps,
                                  moveBps: bps,
                                  capBps: aggregateCapBps,
                                });
                                if (!verdict.ok) {
                                  setDelegateMoreError(verdict.message);
                                  return;
                                }
                                setDelegateMoreFor(null);
                                openDelegate(row.cluster, bps);
                              }}
                              style={{ flex: 1 }}
                            >
                              Review
                            </button>
                          </div>
                        </div>
                      )}

                      {isRedelegating && (
                        <div style={inlineFormStyle}>
                          <label style={redelegateLabelStyle}>
                            Destination cluster id
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={redelegateTo}
                            placeholder="e.g. 2"
                            onChange={(e) => {
                              setRedelegateTo(e.target.value);
                              setRedelegateError(null);
                            }}
                            style={autovoteInputStyle}
                          />
                          <label style={redelegateLabelStyle}>
                            Weight to move (basis points · 100 = 1%)
                          </label>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={row.weightBps}
                            value={redelegateWeightBps}
                            onChange={(e) => {
                              setRedelegateWeightBps(e.target.value);
                              setRedelegateError(null);
                            }}
                            style={autovoteInputStyle}
                          />
                          {redelegateError && (
                            <div className="row-help" style={{ color: "var(--err)" }}>
                              {redelegateError}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="btn btn--sm"
                              onClick={() => {
                                setRedelegateFrom(null);
                                setRedelegateError(null);
                              }}
                              style={{ flex: 1 }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn btn--sm btn--primary"
                              onClick={() => {
                                const to = parseInt(redelegateTo, 10);
                                if (!Number.isFinite(to) || to < 0) {
                                  setRedelegateError("Enter a valid destination cluster id.");
                                  return;
                                }
                                if (to === row.cluster) {
                                  setRedelegateError("Destination must differ from the source cluster.");
                                  return;
                                }
                                const bps = parseInt(redelegateWeightBps, 10);
                                if (!Number.isFinite(bps) || bps <= 0 || bps > row.weightBps) {
                                  setRedelegateError(
                                    `Weight must be 1–${row.weightBps} basis points (no more than the source delegation).`,
                                  );
                                  return;
                                }
                                openRedelegate(row.cluster, to, bps);
                              }}
                              style={{ flex: 1 }}
                            >
                              Review
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Redemptions — open unbonding tickets (lyth_redemptionQueue). READ
          ONLY: delegation is non-custodial and undelegate is instant, so a
          healthy wallet never queues a ticket and this card stays hidden. We
          mount it only to surface a legacy ticket the node still reports, or a
          read error — never with a settle button, because the chain removed
          the completeRedemption selector (calling it now reverts). */}
      {walletAddress && redemptions
        ? redemptions.ok && redemptions.value && redemptions.value.tickets.length > 0
          ? (() => {
              const q = redemptions.value;
              return (
                <div className="w-card">
                  <div className="w-card__head">
                    <h3>Redemptions</h3>
                    <span className="w-live-pill">live</span>
                    <span className="w-card__head__spacer" />
                    <span className="row-help mono">
                      {q.count.toString()} ticket{q.count === 1n ? "" : "s"}
                    </span>
                  </div>
                  <div className="w-card__body">
                    <div className="row-help" style={{ marginBottom: 10, lineHeight: 1.5 }}>
                      Legacy unbonding tickets. Delegation is now non-custodial —
                      undelegate is instant and queues nothing — so these settle
                      on-chain automatically as they mature. There is no manual
                      completion step (the completeRedemption call was removed
                      from the chain). Tickets carry weight (basis points) only,
                      never a principal LYTH amount.
                    </div>
                    <div className="w-live-list">
                      {q.tickets.map((t) => (
                        <div className="w-live-row" key={t.index.toString()}>
                          <div>
                            <div className="row-label">
                              Ticket #{t.index.toString()} · cluster {t.cluster}
                            </div>
                            <div className="row-help mono">
                              queued block {t.createdHeight.toString()} · matures{" "}
                              {t.maturityHeight.toString()}
                            </div>
                          </div>
                          <div
                            className="w-live-right"
                            style={{ display: "flex", alignItems: "center", gap: 8 }}
                          >
                            <span className="mono">{(t.weightBps / 100).toFixed(2)}%</span>
                            <span
                              className={`w-live-pill ${t.mature ? "" : "is-muted"}`}
                            >
                              {t.mature === null
                                ? "pending"
                                : t.mature
                                  ? "mature"
                                  : "cooling down"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()
          : redemptions.ok === false
            ? (
                <div className="w-card">
                  <div className="w-card__head">
                    <h3>Redemptions</h3>
                    <span className="w-card__head__spacer" />
                  </div>
                  <div className="w-card__body">
                    <div className="w-live-error">
                      redemption queue: {redemptions.error}
                    </div>
                  </div>
                </div>
              )
            : null
        : null}

      {experimentalEnabled ? (
      <div className="w-card">
        <div className="w-card__head">
          <h3>Autovote</h3>
          <span className="w-card__head__spacer" />
          <span className="row-help mono">
            {diversities.size > 0
              ? `${diversities.size} diversity reads`
              : "diversity loading"}
          </span>
        </div>
        <div className="w-card__body">
          <div className="row-help" style={{ marginBottom: 10, lineHeight: 1.5 }}>
            Spread a weight budget (% of your balance) across active clusters by
            a chosen objective. Non-custodial — no tokens are escrowed; your LYTH
            stays liquid. Diversity / Decentralization consume live per-cluster
            diversity scoring; Custom keeps the per-cluster Delegate form below.
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <div style={{ flex: "1 1 160px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--fg-400)",
                  marginBottom: 6,
                }}
              >
                Weight budget (bps · 100 = 1%)
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                value={autoCapBps}
                onChange={(e) => {
                  setAutoCapBps(e.target.value);
                  setAutovoteError(null);
                }}
                style={autovoteInputStyle}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn--sm"
              disabled={autovoteBusy || directory.length === 0}
              onClick={() => runAutovote("maxYield")}
            >
              Max Yield
            </button>
            <button
              className="btn btn--sm"
              disabled={autovoteBusy || directory.length === 0}
              onClick={() => runAutovote("maxDiversity")}
            >
              Max Diversity
            </button>
            <button
              className="btn btn--sm"
              disabled={autovoteBusy || directory.length === 0}
              onClick={() => runAutovote("maxDecentralization")}
            >
              Max Decentralization
            </button>
            <button
              className="btn btn--sm btn--ghost"
              title="Use the per-cluster Delegate forms below for a manual allocation"
              disabled
            >
              Custom (use rows below)
            </button>
          </div>
          {autovoteError && (
            <div className="row-help" style={{ color: "var(--err)", marginTop: 10 }}>
              {autovoteError}
            </div>
          )}
        </div>
      </div>
      ) : null}

      <div className="w-card">
        <div className="w-card__head">
          <h3>Cluster directory</h3>
          <span className="w-card__head__spacer" />
          <span className="row-help mono">
            {directory.length === 0
              ? directoryError
                ? "directory unavailable"
                : "loading"
              : `${directory.length} active`}
          </span>
        </div>
        <div className="w-card__body">
          {directoryError && (
            <div className="w-live-error">{directoryError}</div>
          )}
          {directory.length === 0 && !directoryError && !busy && (
            <div className="row-help">
              No clusters surfaced by lyth_clusterDirectory.
            </div>
          )}
          {directory.map((c) => {
            const isOpen = openForm === c.clusterId;
            // Dual-cap state for this cluster's delegate form: existing weight
            // here + the wallet total drive the per-cluster 50% and global 100%
            // warnings against the entered amount.
            const existingWeightBps =
              delegations?.rows.find((r) => r.cluster === c.clusterId)?.weightBps ?? 0;
            const totalDelegatedBps = delegations?.totalBps ?? 0;
            const draftBps = Number.parseInt(draftWeightBps, 10);
            const capState = delegateCapWarning({
              existingWeightBps,
              totalDelegatedBps,
              additionalBps: Number.isFinite(draftBps) && draftBps > 0 ? draftBps : null,
              aggregateCapBps,
            });
            return (
              <div
                key={c.clusterId}
                className="w-setting-row"
                style={{ alignItems: "stretch", flexDirection: "column", gap: 10 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-label">
                      {clusterName(c.clusterId)}
                      {!c.active && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--warn)",
                            marginLeft: 8,
                            letterSpacing: "0.06em",
                          }}
                        >
                          INACTIVE
                        </span>
                      )}
                    </div>
                    {/* name · entity · id · threshold · APR · rep. Every field is a
                        real read except rep (no per-cluster reputation read exists
                        → honest "—"). APR is the real aprBps (a genuine 0 renders
                        "0.00%"); "—" only when that read is unavailable. */}
                    <div className="row-help mono">
                      {entities.get(c.clusterId) ?? "—"} · id #{c.clusterId} ·{" "}
                      {c.threshold}-of-{c.size} ·{" "}
                      {aprLabelFromBps(aprBpsMap.get(c.clusterId))} APR · rep: —
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      className="btn btn--sm btn--ghost"
                      onClick={() =>
                        setExpandedDetail((cur) =>
                          cur === c.clusterId ? null : c.clusterId,
                        )
                      }
                    >
                      {expandedDetail === c.clusterId ? "Hide details" : "More details"}
                    </button>
                    {!isOpen && (
                      <button
                        className="btn btn--sm"
                        onClick={() => {
                          setOpenForm(c.clusterId);
                          setDraftWeightBps("1000");
                          setDraftError(null);
                        }}
                        disabled={!c.active}
                      >
                        Delegate
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid var(--fg-700)",
                      borderRadius: 8,
                    }}
                  >
                    <label
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--fg-400)",
                      }}
                    >
                      Weight — % of balance (basis points · 100 = 1%)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10000}
                      value={draftWeightBps}
                      onChange={(e) => {
                        setDraftWeightBps(e.target.value);
                        setDraftError(null);
                      }}
                      style={{
                        padding: "8px 10px",
                        fontSize: 14,
                        fontFamily: "var(--f-mono)",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                        color: "var(--fg-100)",
                        outline: "none",
                      }}
                    />
                    <div className="row-help" style={{ lineHeight: 1.5 }}>
                      Non-custodial: this delegates a percent of your balance —
                      no tokens are escrowed. Your LYTH stays in your wallet and
                      remains spendable; effective weight = balance × weightBps.
                    </div>
                    <div className="row-help" style={{ lineHeight: 1.5 }}>
                      {capState.note}
                    </div>
                    {capState.warning && (
                      <div className="row-help" style={{ color: "var(--warn)", lineHeight: 1.5 }}>
                        {capState.warning}
                      </div>
                    )}
                    {draftError && (
                      <div className="row-help" style={{ color: "var(--err)" }}>
                        {draftError}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn--sm"
                        onClick={() => {
                          setOpenForm(null);
                          setDraftError(null);
                        }}
                        style={{ flex: 1 }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => {
                          const bps = parseInt(draftWeightBps, 10);
                          if (!Number.isFinite(bps) || bps <= 0 || bps > 10_000) {
                            setDraftError(
                              "Weight must be 1-10000 basis points (0.01% – 100%).",
                            );
                            return;
                          }
                          // Block a delegate the chain would revert on a cap
                          // (per-cluster 50% / global 100%) before signing.
                          const verdict = preflightDelegationVerdict({
                            action: "delegate",
                            dstExistingWeightBps: existingWeightBps,
                            totalDelegatedBps,
                            moveBps: bps,
                            capBps: aggregateCapBps,
                          });
                          if (!verdict.ok) {
                            setDraftError(verdict.message);
                            return;
                          }
                          openDelegate(c.clusterId, bps);
                        }}
                        style={{ flex: 1 }}
                      >
                        Review
                      </button>
                    </div>
                  </div>
                )}

                {expandedDetail === c.clusterId &&
                  (() => {
                    const d = detailByCluster.get(c.clusterId);
                    const events = clusterActivity(delegationHistory, c.clusterId);
                    const { shown, more } = truncateWithMore(events, 5);
                    return (
                      <div style={inlineFormStyle}>
                        {/* Identity — name/entity real reads, health/threshold/
                            active from the directory entry. */}
                        <div className="cap">Identity</div>
                        <div className="w-live-grid">
                          <LiveCell label="Name" value={clusterName(c.clusterId)} />
                          <LiveCell label="Entity" value={entities.get(c.clusterId) ?? "—"} />
                          <LiveCell label="Health" value={c.aggregateHealth} />
                          <LiveCell label="Threshold" value={`${c.threshold} of ${c.size}`} />
                          <LiveCell label="Active set" value={c.active ? "yes" : "no"} />
                        </div>

                        {/* Live status (lyth_clusterStatus) + Demand
                            (lyth_getClusterDelegators). "—" on a failed read. */}
                        <div className="cap" style={{ marginTop: 10 }}>
                          Live status · Demand
                        </div>
                        {d?.loading ? (
                          <div className="row-help">Loading cluster status…</div>
                        ) : (
                          <div className="w-live-grid">
                            <LiveCell label="Live" value={d?.status ? String(d.status.live) : "—"} />
                            <LiveCell label="Offline" value={d?.status ? String(d.status.offline) : "—"} />
                            <LiveCell
                              label="Delegators"
                              value={d && d.delegators !== null ? String(d.delegators) : "—"}
                            />
                          </div>
                        )}

                        {/* Your activity — this wallet's delegation history for
                            this cluster (lyth_getDelegationHistory: delegated /
                            undelegated / redelegated), first 5 + "+N more". */}
                        <div className="cap" style={{ marginTop: 10 }}>
                          Your activity
                        </div>
                        {delegationHistoryError ? (
                          <div className="w-live-error">
                            delegation history: {delegationHistoryError}
                          </div>
                        ) : events.length === 0 ? (
                          <div className="row-help">
                            No delegation activity for this cluster yet.
                          </div>
                        ) : (
                          <>
                            <div className="w-live-list">
                              {shown.map((e) => (
                                <div
                                  className="w-live-row"
                                  key={`${e.blockHeight}-${e.txIndex}-${e.logIndex}`}
                                >
                                  <div>
                                    <div className="row-label">{e.kind}</div>
                                    <div className="row-help mono">
                                      block {e.blockHeight.toString()}
                                      {e.toCluster !== null && e.toCluster !== c.clusterId
                                        ? ` → cluster ${e.toCluster}`
                                        : ""}
                                    </div>
                                  </div>
                                  <div className="w-live-right mono">
                                    {(e.weightBps / 100).toFixed(2)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                            {more > 0 && (
                              <div className="row-help">
                                + {more} more event{more === 1 ? "" : "s"}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LiveCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div>{value}</div>
    </div>
  );
}

const autovoteInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "var(--f-mono)",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  color: "var(--fg-100)",
  outline: "none",
};

const redelegateLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--fg-400)",
};

/** The inline draft-form wrapper shared by the per-row Delegate + Redelegate
 *  forms on an active-delegation row. */
const inlineFormStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--fg-700)",
  borderRadius: 8,
};
