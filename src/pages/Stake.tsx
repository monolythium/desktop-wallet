// Stake page — Phase 2 entry point.
//
// Layout (top to bottom):
//
//   1. Delegate to a cluster CTA → ClusterPicker → amount → drawer
//   2. (Phase 2 follow-up commits add: autovote modes, delegations
//      dashboard, RewardCard, unstake/redelegate flows in this same
//      page.)
//
// Cluster reads come from `getClusters()` (src/sdk/staking.ts). The
// chain-gap reality (no on-chain APR / reputation / uptime yet) is
// surfaced via the ClusterPicker's [mock] tagging.

import { useCallback, useEffect, useMemo, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { ClusterMobilityNotice } from "../components/ClusterMobilityNotice";
import { ClusterPicker } from "../components/ClusterPicker";
import { DelegationsDashboard, type DelegationAction } from "../components/DelegationsDashboard";
import { RewardCard } from "../components/RewardCard";
import { formatAddress } from "../components/format";
import { useOperations } from "../operations/context";
import {
  encodeClaim,
  encodeDelegate,
  encodeRedelegate,
  encodeUndelegate,
} from "../sdk/delegation";
import {
  getClusters,
  getDelegationCap,
  getDelegations,
  getRewards,
  type ClusterSummary,
  type Delegation,
  type PendingRewards,
} from "../sdk/staking";
import { submitDelegationCall } from "../sdk/submit-delegation";
import {
  type AutovoteAllocation,
  type AutovoteMode,
  type AutovoteResult,
  runAutovote,
} from "../sdk/autovote";
import {
  buildAutovoteSeed,
  sampleClusters,
} from "../sdk/autovote-entropy";
import { useChainSnapshot } from "../sdk/useChainSnapshot";

type ClustersState =
  | { status: "loading"; value: null; error: null }
  | { status: "ok"; value: ClusterSummary[]; error: null }
  | { status: "error"; value: null; error: string };

export function Stake() {
  const ops = useOperations();
  const [clusters, setClusters] = useState<ClustersState>({
    status: "loading",
    value: null,
    error: null,
  });
  const [capBps, setCapBps] = useState<number | null>(null);
  const [delegations, setDelegations] = useState<Delegation[] | null>(null);
  const [delegationsError, setDelegationsError] = useState<string | null>(null);
  const [rewards, setRewards] = useState<PendingRewards | null>(null);
  // Chain snapshot — gives us the latest block hash for per-user
  // autovote entropy. The hash changes each block, so consecutive
  // autovote runs sample fresh.
  const chain = useChainSnapshot(IDENTITY.address);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<ClusterSummary | null>(null);
  const [weightBpsInput, setWeightBpsInput] = useState("1000");
  // Redelegate state — when set, the in-page UI surfaces the picker
  // with the source cluster excluded, then the composer.
  const [redelegateSource, setRedelegateSource] = useState<Delegation | null>(null);
  const [redelegateTarget, setRedelegateTarget] = useState<ClusterSummary | null>(null);
  // Autovote state — Phase 2 §23.9 surface. `null` until the user
  // picks a mode; recomputed on cluster-set refresh.
  const [autovoteMode, setAutovoteMode] = useState<AutovoteMode | "custom" | null>(null);
  const [autovoteResult, setAutovoteResult] = useState<AutovoteResult | null>(null);

  const refresh = useCallback(async () => {
    setClusters({ status: "loading", value: null, error: null });
    const [clusterResult, capResult, delResult, rewardResult] = await Promise.all([
      getClusters(),
      getDelegationCap(),
      getDelegations(IDENTITY.address),
      getRewards(IDENTITY.address),
    ]);
    if (capResult.ok) setCapBps(capResult.value ?? null);
    if (delResult.ok) {
      setDelegations(delResult.value ?? []);
      setDelegationsError(null);
    } else {
      setDelegations(null);
      setDelegationsError(delResult.error ?? "delegations unavailable");
    }
    if (rewardResult.ok) {
      setRewards(rewardResult.value ?? null);
    }
    if (!clusterResult.ok || !clusterResult.value) {
      setClusters({
        status: "error",
        value: null,
        error: clusterResult.error ?? "directory unavailable",
      });
      return;
    }
    setClusters({ status: "ok", value: clusterResult.value, error: null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMode = useCallback(
    (mode: AutovoteMode) => {
      setAutovoteMode(mode);
      if (clusters.status !== "ok") {
        setAutovoteResult(null);
        return;
      }
      // Per-user entropy keyed by (user_address, latest_block_hash)
      // per §23.9. blockHeight as a fallback identifier when the
      // snapshot doesn't yet carry a hash (offline / pre-first-tick).
      const blockMarker = chain.snapshot?.blockHeight
        ? `0x${chain.snapshot.blockHeight.toString(16)}`
        : "0x0";
      const seed = buildAutovoteSeed(IDENTITY.address, blockMarker);
      const result = runAutovote(mode, clusters.value, {
        capBps,
        sampleStrategy: (eligible, count) =>
          sampleClusters(eligible, count, seed),
      });
      setAutovoteResult(result);
    },
    [clusters, capBps, chain.snapshot?.blockHeight],
  );

  /**
   * Build a list of OperationsDrawer descriptors — one per allocation
   * row — and walk them sequentially. Each row signs + submits its
   * own delegation tx; the drawer is opened anew for each step so the
   * user sees the per-cluster diff before approving. Failures abort
   * the chain.
   */
  const submitAutovote = (allocations: AutovoteAllocation[]) => {
    if (allocations.length === 0) return;
    const queue = [...allocations];
    const stepN = queue.length;
    const runStep = (step: number) => {
      const next = queue.shift();
      if (!next) return;
      ops.open({
        title: `Autovote · step ${step}/${stepN}`,
        subtitle: `Delegate to ${next.cluster.name} (${next.weightBps} bps)`,
        auth: "keychain",
        diff: [
          { k: "From", v: formatAddress(IDENTITY.address) },
          { k: "Mode", v: humanMode(autovoteMode) },
          { k: "Cluster", v: next.cluster.name },
          {
            k: "Weight",
            v: `${next.weightBps} bps (${(next.weightBps / 100).toFixed(2)}%)`,
          },
          { k: "Step", v: `${step} of ${stepN}` },
        ],
        effects: [
          {
            text:
              "Per-cluster cap enforced protocol-side (§23.7); chain rejects " +
              "over-cap rows even if the wallet over-submits.",
          },
          { text: "Encrypted Sprintnet envelope via lyth_submitEncrypted." },
        ],
        execute: async (ctx) => {
          if (!ctx?.vaultSeed) {
            throw new Error("vault seed unavailable after keychain authorization");
          }
          const tx = encodeDelegate({
            from: IDENTITY.address,
            clusterId: next.cluster.clusterId,
            weightBps: next.weightBps,
          });
          const sub = await submitDelegationCall({ seed: ctx.vaultSeed, tx });
          // Queue the next step (if any) once the drawer closes.
          if (queue.length > 0) {
            // Defer to a microtask so the current drawer can transition
            // through `done` before we open the next one.
            setTimeout(() => runStep(step + 1), 0);
          }
          return {
            headline: `Autovote step ${step}/${stepN} broadcast`,
            detail: sub.txHash,
          };
        },
      });
    };
    runStep(1);
  };

  /** Open the OperationsDrawer for a delegate call. */
  const openDelegate = (cluster: ClusterSummary, weightBps: number) => {
    ops.open({
      title: `Delegate to ${cluster.name}`,
      subtitle: `Allocate ${weightBps} bps (${(weightBps / 100).toFixed(2)}%) to cluster ${cluster.clusterId}`,
      auth: "keychain",
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "Cluster", v: cluster.name },
        { k: "Cluster id", v: String(cluster.clusterId) },
        { k: "Weight", v: `${weightBps} bps (${(weightBps / 100).toFixed(2)}%)` },
        {
          k: "Expected APR",
          v: cluster.apr === null ? "preview unavailable" : `${(cluster.apr * 100).toFixed(2)}%`,
        },
      ],
      effects: [
        {
          text:
            "Adds (or tops up) your weight on this cluster. Per-cluster cap " +
            "is enforced protocol-side (§23.7).",
        },
        {
          text: "Sends an encrypted ML-DSA envelope via lyth_submitEncrypted.",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const tx = encodeDelegate({
          from: IDENTITY.address,
          clusterId: cluster.clusterId,
          weightBps,
        });
        const submission = await submitDelegationCall({
          seed: ctx.vaultSeed,
          tx,
        });
        return {
          headline: `Delegated to ${cluster.name}`,
          detail: `${submission.txHash} · ${submission.envelopeWireBytes} byte envelope`,
        };
      },
    });
  };

  const cancelPick = () => {
    setPickerOpen(false);
    setSelected(null);
  };

  /**
   * Action handler for the Manage menu. Unstake/Redelegate/Claim
   * flows are wired in subsequent commits (10, 11, 12); Add stake
   * here reuses the existing delegate composer by pre-selecting the
   * delegation's cluster. Until those land, the unwired actions
   * surface a transient notice via the OperationsDrawer "info"
   * pathway rather than failing silently.
   */
  const handleAction = (action: DelegationAction, delegation: Delegation) => {
    if (clusters.status !== "ok") return;
    const cluster = clusters.value.find((c) => c.clusterId === delegation.clusterId);
    if (!cluster) return;
    switch (action) {
      case "add-stake":
        setSelected(cluster);
        setPickerOpen(true);
        return;
      case "unstake":
        openUnstake(delegation);
        return;
      case "redelegate":
        setRedelegateSource(delegation);
        setRedelegateTarget(null);
        setWeightBpsInput(String(delegation.weightBps));
        return;
      case "claim":
        openClaim();
        return;
    }
  };

  /**
   * Claim — settles + withdraws ALL of the wallet's accrued
   * delegation rewards in one tx (mono-core delegation precompile
   * `claim()`, MS-CORE-0009). The chain doesn't expose a per-cluster
   * claim primitive, so the surface is "Claim all" rather than
   * per-row.
   */
  const openClaim = () => {
    ops.open({
      title: "Claim delegation rewards",
      subtitle: "Settles + withdraws every accrued reward",
      auth: "keychain",
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        {
          k: "Pending",
          v:
            rewards?.totalLyth === null || rewards?.totalLyth === undefined
              ? "preview unavailable"
              : `${rewards.totalLyth.toFixed(4)} LYTH`,
        },
        {
          k: "Scope",
          v: "all clusters (chain `claim()` is wallet-wide)",
        },
      ],
      effects: [
        {
          text:
            "Calls the delegation precompile `claim()` selector. The " +
            "chain settles every delegation row's accrued reward + " +
            "credits the LYTH to your balance in a single tx.",
        },
        {
          text:
            "Per-cluster claim is not a chain primitive — `claim()` is " +
            "wallet-wide.",
          level: "info",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const tx = encodeClaim({ from: IDENTITY.address });
        const sub = await submitDelegationCall({ seed: ctx.vaultSeed, tx });
        void refresh();
        return {
          headline: "Rewards claimed",
          detail: sub.txHash,
        };
      },
    });
  };

  const cancelRedelegate = () => {
    setRedelegateSource(null);
    setRedelegateTarget(null);
  };

  /**
   * Redelegate — atomic move of `weightBps` from one cluster to
   * another (no two-step undelegate→delegate). The chain primitive
   * is `redelegate(uint32 fromCluster, uint32 toCluster, uint16
   * weightBps)`; per §14 cluster mobility this carries no cooldown
   * for delegators (operator-side swap cooldown is separate).
   */
  const submitRedelegate = () => {
    if (!redelegateSource || !redelegateTarget) return;
    const bps = Number.parseInt(weightBpsInput, 10);
    if (!Number.isInteger(bps) || bps <= 0 || bps > redelegateSource.weightBps) {
      return;
    }
    const source = redelegateSource;
    const target = redelegateTarget;
    setRedelegateSource(null);
    setRedelegateTarget(null);
    ops.open({
      title: `Redelegate to ${target.name}`,
      subtitle: `Move ${bps} bps from ${source.clusterName}`,
      auth: "keychain",
      diff: [
        { k: "From cluster", v: source.clusterName },
        { k: "From cluster id", v: String(source.clusterId) },
        { k: "To cluster", v: target.name },
        { k: "To cluster id", v: String(target.clusterId) },
        { k: "Weight moved", v: `${bps} bps (${(bps / 100).toFixed(2)}%)` },
        { k: "Source remainder", v: `${source.weightBps - bps} bps` },
      ],
      effects: [
        {
          text:
            "Atomic move — chain executes the source-side decrement + " +
            "destination-side credit in a single tx. No cooldown.",
        },
        {
          text:
            "Per-cluster cap enforced protocol-side; the destination's " +
            "post-state weight cannot exceed the active cap (§23.7).",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const tx = encodeRedelegate({
          from: IDENTITY.address,
          fromClusterId: source.clusterId,
          toClusterId: target.clusterId,
          weightBps: bps,
        });
        const sub = await submitDelegationCall({ seed: ctx.vaultSeed, tx });
        void refresh();
        return {
          headline: `Redelegated ${bps} bps to ${target.name}`,
          detail: sub.txHash,
        };
      },
    });
  };

  /**
   * Unstake — calls `undelegate(cluster)`, removing the wallet's entire
   * row for that cluster. Per whitepaper §23.2 delegators have zero
   * unbonding period — funds are available immediately. (Note: this
   * differs from the operator self-bond, which carries a 14d+1ep
   * cooldown per §14 cluster mobility; the operator cooldown does
   * NOT apply to delegators.)
   *
   * The chain's `undelegate` primitive is all-or-nothing — no partial
   * unstake. Partial reductions would need an `undelegate` followed
   * by a `delegate(newWeightBps)` sequence; Phase 2 ships full-unstake
   * only.
   */
  const openUnstake = (delegation: Delegation) => {
    ops.open({
      title: `Unstake from ${delegation.clusterName}`,
      subtitle: `Remove all ${delegation.weightBps} bps from cluster ${delegation.clusterId}`,
      auth: "keychain",
      diff: [
        { k: "From", v: formatAddress(IDENTITY.address) },
        { k: "Cluster", v: delegation.clusterName },
        { k: "Cluster id", v: String(delegation.clusterId) },
        { k: "Removing", v: `${delegation.weightBps} bps (entire row)` },
        { k: "Unbonding period", v: "none — funds available immediately (§23.2)" },
      ],
      effects: [
        {
          text:
            "Removes your delegation row entirely. The chain's undelegate " +
            "primitive is all-or-nothing — partial reduction would require " +
            "undelegate followed by a fresh delegate.",
        },
        {
          text:
            "Per §23.2, delegators have no unbonding cooldown — slashing " +
            "applies to operator self-bonds, not to delegated stake.",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const tx = encodeUndelegate({
          from: IDENTITY.address,
          clusterId: delegation.clusterId,
        });
        const sub = await submitDelegationCall({ seed: ctx.vaultSeed, tx });
        // Refresh delegations on completion so the row disappears.
        void refresh();
        return {
          headline: `Unstaked from ${delegation.clusterName}`,
          detail: sub.txHash,
        };
      },
    });
  };

  const pendingByCluster = new Map<number, number | null>(
    rewards?.perCluster.map((r) => [r.clusterId, r.amountLyth]) ?? [],
  );

  // Cluster ids the user has delegations on — drives the mobility
  // notice. Memoised so the notice's effect doesn't re-fire each
  // render.
  const delegatedClusterIds = useMemo(
    () => (delegations ?? []).map((d) => d.clusterId),
    [delegations],
  );

  /** Returns null if the input is valid; otherwise an error string. */
  const validateBps = (): string | null => {
    const n = Number.parseInt(weightBpsInput, 10);
    if (!Number.isInteger(n)) return "Weight must be an integer";
    if (n <= 0) return "Weight must be > 0";
    if (n > 10_000) return "Weight must be ≤ 10000 (100%)";
    return null;
  };

  const submitSelected = () => {
    if (!selected) return;
    const err = validateBps();
    if (err !== null) return;
    const bps = Number.parseInt(weightBpsInput, 10);
    setPickerOpen(false);
    setSelected(null);
    openDelegate(selected, bps);
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Stake</h1>
        <div className="sub">
          Delegate to a cluster of operators. Per-wallet delegation cap and the
          quadratic reward curve (§23.5 / §23.7) push toward diversification at
          every margin.
        </div>
      </div>

      <ClusterMobilityNotice
        clusterIds={delegatedClusterIds}
        title="Recent membership changes on your clusters"
      />

      {redelegateSource ? (
        <RedelegateCard
          source={redelegateSource}
          target={redelegateTarget}
          clusters={clusters.value ?? []}
          weightBpsInput={weightBpsInput}
          onWeightChange={setWeightBpsInput}
          onPickTarget={setRedelegateTarget}
          onCancel={cancelRedelegate}
          onSubmit={submitRedelegate}
        />
      ) : null}

      <RewardCard
        rewards={rewards}
        onClaim={openClaim}
        onRefresh={() => void refresh()}
      />

      <DelegationsDashboard
        delegations={delegations}
        isLoading={delegations === null && delegationsError === null}
        error={delegationsError}
        pendingByCluster={pendingByCluster}
        onAction={handleAction}
        onRefresh={() => void refresh()}
      />

      <AutovoteCard
        mode={autovoteMode}
        result={autovoteResult}
        capBps={capBps}
        clustersReady={clusters.status === "ok"}
        onPickMode={(mode) => {
          if (mode === "custom") {
            setAutovoteMode("custom");
            setAutovoteResult(null);
            setPickerOpen(true);
            return;
          }
          runMode(mode);
        }}
        onSubmit={() => {
          if (autovoteResult) submitAutovote(autovoteResult.allocations);
        }}
      />

      <div className="w-card">
        <div className="w-card__head">
          <h3>Delegate to a cluster</h3>
          <div className="w-card__head__spacer" />
          {!pickerOpen ? (
            <button
              className="btn btn--primary btn--sm"
              onClick={() => setPickerOpen(true)}
              disabled={clusters.status !== "ok"}
            >
              Pick cluster
            </button>
          ) : (
            <button className="btn btn--sm btn--ghost" onClick={cancelPick}>
              Cancel
            </button>
          )}
        </div>

        <div className="w-card__body">
          {!pickerOpen && !selected ? (
            <div className="row-help">
              Open the picker to see live clusters from{" "}
              <span className="mono">lyth_clusterDirectory</span>. Operators
              listed in each row come from{" "}
              <span className="mono">lyth_clusterStatus</span>; capability
              badges and signing activity follow on the Operators page.
            </div>
          ) : null}

          {pickerOpen && !selected ? (
            <ClusterPicker
              clusters={clusters.value ?? []}
              isLoading={clusters.status === "loading"}
              error={clusters.error}
              onRefresh={refresh}
              onSelect={(c) => setSelected(c)}
            />
          ) : null}

          {selected ? (
            <DelegateComposer
              cluster={selected}
              weightBpsInput={weightBpsInput}
              onWeightChange={setWeightBpsInput}
              validateBps={validateBps}
              onCancel={cancelPick}
              onSubmit={submitSelected}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function humanMode(mode: AutovoteMode | "custom" | null): string {
  switch (mode) {
    case "max-yield":
      return "Max Yield";
    case "max-diversity":
      return "Max Diversity";
    case "max-decentralization":
      return "Max Decentralization";
    case "custom":
      return "Custom";
    default:
      return "(none)";
  }
}

/**
 * Whitepaper §23.9 four-button surface. The chain rewards
 * diversification — the wallet's job is to make diversification the
 * easy path. Each button computes an allocation against the live
 * cluster set and the active delegation cap; the user reviews the
 * preview and submits when ready.
 *
 * Per-user randomization (so two users picking Max Yield don't end
 * up at the same cluster set) lands in Commit 8 — this commit
 * uses deterministic sampling so the rest of the page wires cleanly
 * first.
 */
function AutovoteCard({
  mode,
  result,
  capBps,
  clustersReady,
  onPickMode,
  onSubmit,
}: {
  mode: AutovoteMode | "custom" | null;
  result: AutovoteResult | null;
  capBps: number | null;
  clustersReady: boolean;
  onPickMode: (mode: AutovoteMode | "custom") => void;
  onSubmit: () => void;
}) {
  const buttons: Array<{ id: AutovoteMode | "custom"; label: string; hint: string }> = [
    {
      id: "max-yield",
      label: "Max Yield",
      hint: "Highest APR consistent with the per-cluster cap.",
    },
    {
      id: "max-diversity",
      label: "Max Diversity",
      hint: "Spread across reputable, high-uptime clusters.",
    },
    {
      id: "max-decentralization",
      label: "Max Decentralization",
      hint: "Route stake away from concentrated clusters.",
    },
    {
      id: "custom",
      label: "Custom",
      hint: "Manual per-cluster allocation, cap-enforced at submit.",
    },
  ];

  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Autovote · §23.9 four-button</h3>
        <span className="w-live-pill">live</span>
      </div>
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 10 }}>
          Pick a mode. The wallet computes an allocation against the live
          cluster directory, respects the per-cluster cap (
          {capBps === null ? "no cap" : `${capBps} bps`}), and previews the
          result before signing. Per-user entropy ships in the next commit.
        </div>
        <div className="w-autovote-buttons">
          {buttons.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`w-autovote-btn ${mode === b.id ? "is-on" : ""}`}
              onClick={() => onPickMode(b.id)}
              disabled={!clustersReady}
            >
              <div className="label">{b.label}</div>
              <div className="hint">{b.hint}</div>
            </button>
          ))}
        </div>

        {mode !== null && mode !== "custom" && result ? (
          <AutovotePreview result={result} onSubmit={onSubmit} />
        ) : null}
      </div>
    </div>
  );
}

function AutovotePreview({
  result,
  onSubmit,
}: {
  result: AutovoteResult;
  onSubmit: () => void;
}) {
  const total = result.allocations.reduce((a, b) => a + b.weightBps, 0);
  return (
    <div className="w-autovote-preview">
      <div className="w-autovote-preview__meta">
        <span>
          <b>{humanMode(result.mode)}</b> — {result.allocations.length} cluster
          {result.allocations.length === 1 ? "" : "s"} · {total} bps total
        </span>
        <span className="row-help">
          {result.eligibleCount} eligible
          {result.skipped.length > 0
            ? ` · ${result.skipped.length} chain-gapped skipped`
            : ""}
        </span>
      </div>
      <ul className="w-autovote-list">
        {result.allocations.map((a) => (
          <li key={a.cluster.clusterId} className="w-autovote-row">
            <span>{a.cluster.name}</span>
            <span className="mono">{a.weightBps} bps</span>
          </li>
        ))}
      </ul>
      <button
        className="btn btn--primary"
        onClick={onSubmit}
        disabled={result.allocations.length === 0}
      >
        Submit autovote
      </button>
    </div>
  );
}

function RedelegateCard({
  source,
  target,
  clusters,
  weightBpsInput,
  onWeightChange,
  onPickTarget,
  onCancel,
  onSubmit,
}: {
  source: Delegation;
  target: ClusterSummary | null;
  clusters: ClusterSummary[];
  weightBpsInput: string;
  onWeightChange: (v: string) => void;
  onPickTarget: (c: ClusterSummary | null) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const bps = Number.parseInt(weightBpsInput, 10);
  const valid =
    Number.isInteger(bps) && bps > 0 && bps <= source.weightBps;
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Redelegate from {source.clusterName}</h3>
        <div className="w-card__head__spacer" />
        <button className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 10 }}>
          Atomic move from <b>{source.clusterName}</b> to another active
          cluster. Currently holding <span className="mono">{source.weightBps} bps</span>
          on the source row.
        </div>
        {!target ? (
          <ClusterPicker
            clusters={clusters}
            excludeIds={[source.clusterId]}
            onSelect={onPickTarget}
          />
        ) : (
          <div className="w-live-grid">
            <div className="w-live-cell">
              <div className="cap">Destination</div>
              <div>{target.name}</div>
            </div>
            <div className="w-live-cell">
              <div className="cap">Cluster id</div>
              <div className="mono">{target.clusterId}</div>
            </div>
            <div className="w-live-cell">
              <div className="cap">Move (bps)</div>
              <div className="w-live-form" style={{ marginTop: 4 }}>
                <input
                  aria-label="Redelegate weight in basis points"
                  className="w-live-input mono"
                  type="number"
                  min={1}
                  max={source.weightBps}
                  value={weightBpsInput}
                  onChange={(e) => onWeightChange(e.currentTarget.value)}
                />
                <span className="row-help" style={{ marginLeft: 8 }}>
                  max {source.weightBps} bps from source
                </span>
              </div>
              {!valid ? (
                <div className="w-live-error" style={{ marginTop: 6 }}>
                  Move must be between 1 and {source.weightBps} bps.
                </div>
              ) : null}
            </div>
            <div className="w-live-cell">
              <div className="cap">Actions</div>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => onPickTarget(null)}
                >
                  Change target
                </button>
                <button
                  className="btn btn--sm btn--primary"
                  onClick={onSubmit}
                  disabled={!valid}
                >
                  Redelegate
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DelegateComposer({
  cluster,
  weightBpsInput,
  onWeightChange,
  validateBps,
  onCancel,
  onSubmit,
}: {
  cluster: ClusterSummary;
  weightBpsInput: string;
  onWeightChange: (v: string) => void;
  validateBps: () => string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const err = validateBps();
  return (
    <div className="w-live-grid">
      <div className="w-live-cell">
        <div className="cap">Cluster</div>
        <div>{cluster.name}</div>
      </div>
      <div className="w-live-cell">
        <div className="cap">Cluster id</div>
        <div className="mono">{cluster.clusterId}</div>
      </div>
      <div className="w-live-cell">
        <div className="cap">Weight (bps)</div>
        <div className="w-live-form" style={{ marginTop: 4 }}>
          <input
            aria-label="Delegation weight in basis points"
            className="w-live-input mono"
            type="number"
            min={1}
            max={10000}
            value={weightBpsInput}
            onChange={(e) => onWeightChange(e.currentTarget.value)}
          />
          <span className="row-help" style={{ marginLeft: 8 }}>
            {weightBpsInput}/10000 = {(Number(weightBpsInput) / 100).toFixed(2)}%
          </span>
        </div>
        {err ? <div className="w-live-error" style={{ marginTop: 6 }}>{err}</div> : null}
      </div>
      <div className="w-live-cell">
        <div className="cap">Actions</div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button className="btn btn--sm btn--ghost" onClick={onCancel}>
            Back
          </button>
          <button
            className="btn btn--sm btn--primary"
            onClick={onSubmit}
            disabled={err !== null}
          >
            Delegate
          </button>
        </div>
      </div>
    </div>
  );
}
