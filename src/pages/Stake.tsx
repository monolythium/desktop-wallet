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

import { useCallback, useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { ClusterPicker } from "../components/ClusterPicker";
import { DelegationsDashboard, type DelegationAction } from "../components/DelegationsDashboard";
import { formatAddress } from "../components/format";
import { useOperations } from "../operations/context";
import { encodeDelegate } from "../sdk/delegation";
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
      case "redelegate":
      case "claim":
        // Wired in commits 10 / 11 / 12. Surface the descriptor so
        // the user gets feedback that the action is recognized.
        ops.open({
          title: `${action[0]!.toUpperCase()}${action.slice(1)} (preview)`,
          subtitle: `Targets ${delegation.clusterName}`,
          auth: "none",
          diff: [
            { k: "Cluster", v: delegation.clusterName },
            { k: "Weight", v: `${delegation.weightBps} bps` },
            { k: "Action", v: action },
          ],
          effects: [
            {
              text:
                action === "unstake"
                  ? "Unstake flow wires in Commit 10 (this phase)."
                  : action === "redelegate"
                    ? "Redelegate flow wires in Commit 11 (this phase)."
                    : "Claim flow wires in Commit 12 (this phase).",
              level: "info",
            },
          ],
          execute: () =>
            Promise.resolve({
              headline: `${action} preview only`,
              detail: "Real flow ships within Phase 2.",
            }),
        });
    }
  };

  const pendingByCluster = new Map<number, number | null>(
    rewards?.perCluster.map((r) => [r.clusterId, r.amountLyth]) ?? [],
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
