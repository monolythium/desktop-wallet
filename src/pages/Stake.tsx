// Stake page — DVT cluster delegation. Public denom only.
//
// Top card: live read-only RPC snapshot (clusters / active / healthy /
// delegations) — unchanged from the scaffold.
// Lower card: cluster directory rows with an inline Delegate form that
// routes through the OperationsDrawer (password unlock → vault seed →
// delegation precompile call → encrypted-envelope submit).

import { useEffect, useState } from "react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import type { ClusterDirectoryEntryResponse } from "@monolythium/core-sdk";
import { IDENTITY } from "../data/fixtures";
import { useOperations } from "../operations/context";
import {
  buildDelegateCalldata,
  fetchClusterDirectory,
  submitStakingTx,
} from "../sdk/staking";
import {
  formatOutcome,
  loadLiveStakeStatus,
  type LiveStakeStatus,
} from "../sdk/live";

export function Stake() {
  const ops = useOperations();
  const [status, setStatus] = useState<LiveStakeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<ClusterDirectoryEntryResponse[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<number | null>(null);
  const [draftWeightBps, setDraftWeightBps] = useState("1000");
  const [draftError, setDraftError] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const [s, dir] = await Promise.all([
        loadLiveStakeStatus(IDENTITY.address),
        fetchClusterDirectory(1, 20).catch((cause: unknown) => {
          setDirectoryError((cause as Error)?.message ?? "directory unavailable");
          return null;
        }),
      ]);
      setStatus(s);
      if (dir) {
        setDirectory(dir.clusters);
        setDirectoryError(null);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const clusters = status?.clusters.ok ? status.clusters.value ?? [] : [];
  const active = status?.activeClusters.ok ? status.activeClusters.value ?? [] : [];
  const healthy = status?.healthyClusters.ok ? status.healthyClusters.value ?? [] : [];
  const delegations = status?.delegations.ok ? status.delegations.value : null;
  const delegationHistory = status?.delegationHistory.ok
    ? status.delegationHistory.value ?? []
    : [];

  const selfBech32m = addressToTypedBech32("user", IDENTITY.address);

  const openDelegate = (clusterId: number, weightBps: number) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    ops.open({
      title: `Delegate to cluster ${clusterId}`,
      subtitle: `Stake ${weightLabel} of wallet weight to a DVT cluster`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Cluster", v: String(clusterId) },
        { k: "Weight", v: weightLabel },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes a delegate(clusterId, weightBps) call to the §5.4 precompile." },
        { text: "Wraps the native transaction in an encrypted envelope and submits lyth_submitEncrypted." },
        {
          text: "Chain may reject at the precompile gate if delegation isn't activated yet on this network — the rejection is surfaced verbatim.",
          level: "warn",
        },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildDelegateCalldata(clusterId, weightBps);
        const result = await submitStakingTx({
          seed: ctx.vaultSeed,
          data: calldata,
        });
        return {
          headline: `Delegated ${weightLabel} to cluster ${clusterId}`,
          detail: result.txHash,
        };
      },
    });
    setOpenForm(null);
    setDraftError(null);
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Stake</h1>
        <div className="sub">
          DVT clusters · 100 clusters · 7 or 10 operators per cluster.
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live staking reads</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          <div className="w-live-grid">
            <LiveCell
              label="Clusters"
              value={
                status
                  ? formatOutcome(status.clusters, (rows) => rows.length.toString())
                  : "loading"
              }
            />
            <LiveCell
              label="Active"
              value={
                status
                  ? formatOutcome(status.activeClusters, (rows) => rows.length.toString())
                  : "loading"
              }
            />
            <LiveCell
              label="Healthy"
              value={
                status
                  ? formatOutcome(status.healthyClusters, (rows) => rows.length.toString())
                  : "loading"
              }
            />
            <LiveCell
              label="My bps"
              value={
                delegations
                  ? delegations.totalBps.toString()
                  : status?.delegations.error ?? "loading"
              }
            />
          </div>
          {status ? (
            <div className="row-help">
              Endpoint: <span className="mono">{status.endpoint}</span>
            </div>
          ) : null}

          {delegations && delegations.rows.length > 0 && (
            <div className="w-live-list">
              {delegations.rows.map((row) => (
                <div className="w-live-row" key={row.cluster}>
                  <div>
                    <div className="row-label">Cluster #{row.cluster}</div>
                    <div className="row-help">your delegation</div>
                  </div>
                  <div className="w-live-right mono">
                    {(row.weightBps / 100).toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>
          )}

          {clusters.length > 0 ? (
            <div className="w-live-list">
              {clusters.slice(0, 6).map((cluster) => (
                <div className="w-live-row" key={cluster.clusterId}>
                  <div>
                    <div className="row-label">Cluster #{cluster.clusterId}</div>
                    <div className="row-help mono">
                      {cluster.threshold}-of-{cluster.size} · {cluster.aggregateHealth}
                    </div>
                  </div>
                  <div className="w-live-right">
                    <div className="mono">{cluster.size} operators</div>
                    <span className={`w-live-pill ${cluster.active ? "" : "is-muted"}`}>
                      {cluster.active ? "active" : "inactive"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {delegationHistory.length > 0 ? (
            <div className="w-live-list">
              {delegationHistory.slice(0, 5).map((row) => (
                <div
                  className="w-live-row"
                  key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                >
                  <div>
                    <div className="row-label">{row.kind}</div>
                    <div className="row-help">block {row.blockHeight.toString()}</div>
                  </div>
                  <div className="w-live-right mono">{row.weightBps} bps</div>
                </div>
              ))}
            </div>
          ) : null}

          {clusters.length === 0 && status?.clusters.ok ? (
            <div className="row-help">Cluster descriptor set is empty.</div>
          ) : null}
          {status?.clusters.ok === false ? (
            <div className="w-live-error">cluster set: {status.clusters.error}</div>
          ) : null}
          {status?.delegations.ok === false ? (
            <div className="w-live-error">delegations: {status.delegations.error}</div>
          ) : null}
          {status?.delegationHistory.ok === false ? (
            <div className="w-live-error">
              delegation history: {status.delegationHistory.error}
            </div>
          ) : null}
          {active.length || healthy.length ? null : null}
        </div>
      </div>

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
            return (
              <div
                key={c.clusterId}
                className="w-setting-row"
                style={{ alignItems: "stretch", flexDirection: "column", gap: 10 }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-label">
                      Cluster #{c.clusterId}
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
                    <div className="row-help mono">
                      {c.threshold}-of-{c.size} · health {c.aggregateHealth}
                    </div>
                    {c.regionDiversity && c.regionDiversity.length > 0 && (
                      <div className="row-help">
                        Regions · {c.regionDiversity.join(", ")}
                      </div>
                    )}
                  </div>
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
                      Weight (basis points · 100 = 1%)
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
                          openDelegate(c.clusterId, bps);
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
