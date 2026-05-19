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
import { formatAddress } from "../components/format";
import { useOperations } from "../operations/context";
import { encodeDelegate } from "../sdk/delegation";
import { getClusters, type ClusterSummary } from "../sdk/staking";
import { submitDelegationCall } from "../sdk/submit-delegation";

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<ClusterSummary | null>(null);
  const [weightBpsInput, setWeightBpsInput] = useState("1000");

  const refresh = useCallback(async () => {
    setClusters({ status: "loading", value: null, error: null });
    const result = await getClusters();
    if (!result.ok || !result.value) {
      setClusters({
        status: "error",
        value: null,
        error: result.error ?? "directory unavailable",
      });
      return;
    }
    setClusters({ status: "ok", value: result.value, error: null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
