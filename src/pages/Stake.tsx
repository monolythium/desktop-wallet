// Stake page — DVT cluster delegation. Public denom only.
//
// Top card: live read-only RPC snapshot (clusters / active / healthy /
// delegations) — unchanged from the scaffold.
// Lower card: cluster directory rows with an inline Delegate form that
// routes through the OperationsDrawer (password unlock → vault seed →
// delegation precompile call → encrypted-envelope submit).

import { useEffect, useState } from "react";
import type {
  ClusterDirectoryEntryResponse,
  ClusterDiversityView,
} from "@monolythium/core-sdk";
import { useOperations } from "../operations/context";
import { useActiveWallet } from "../sdk/active-wallet";
import {
  DELEGATION_PRECOMPILE,
  buildDelegateCalldata,
  fetchClusterDirectory,
  submitStakingTx,
} from "../sdk/staking";
import {
  buildAutovotePlan,
  fetchClusterDiversities,
  submitAutovotePlan,
  type AutovoteMode,
} from "../sdk/autovote";
import {
  formatOutcome,
  loadLiveStakeStatus,
  type LiveStakeStatus,
} from "../sdk/live";

interface StakeProps {
  /** Gate the autovote planner + per-cluster diversity column (experimental). */
  experimentalEnabled?: boolean;
}

export function Stake({ experimentalEnabled }: StakeProps = {}) {
  const ops = useOperations();
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [status, setStatus] = useState<LiveStakeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [directory, setDirectory] = useState<ClusterDirectoryEntryResponse[]>([]);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<number | null>(null);
  const [draftWeightBps, setDraftWeightBps] = useState("1000");
  const [draftPrincipalLyth, setDraftPrincipalLyth] = useState("100");
  const [draftError, setDraftError] = useState<string | null>(null);
  // Read-only per-cluster diversity scores (lyth_getClusterDiversity, PF-6),
  // keyed by clusterId. Drives both the directory column and the autovote
  // Max Diversity / Max Decentralization planners.
  const [diversities, setDiversities] = useState<
    Map<number, ClusterDiversityView>
  >(new Map());
  // Autovote (§25.1): total principal to spread + weight cap + last-built plan.
  const [autoPrincipalLyth, setAutoPrincipalLyth] = useState("100");
  const [autoCapBps, setAutoCapBps] = useState("5000");
  const [autovoteBusy, setAutovoteBusy] = useState(false);
  const [autovoteError, setAutovoteError] = useState<string | null>(null);

  const refresh = async () => {
    if (!walletAddress) {
      setStatus(null);
      setDirectory([]);
      setDirectoryError(null);
      return;
    }
    setBusy(true);
    try {
      const [s, dir] = await Promise.all([
        loadLiveStakeStatus(walletAddress),
        fetchClusterDirectory(1, 20).catch((cause: unknown) => {
          setDirectoryError((cause as Error)?.message ?? "directory unavailable");
          return null;
        }),
      ]);
      setStatus(s);
      if (dir) {
        setDirectory(dir.clusters);
        setDirectoryError(null);
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

  const clusters = status?.clusters.ok ? status.clusters.value ?? [] : [];
  const active = status?.activeClusters.ok ? status.activeClusters.value ?? [] : [];
  const healthy = status?.healthyClusters.ok ? status.healthyClusters.value ?? [] : [];
  const delegations = status?.delegations.ok ? status.delegations.value : null;
  const delegationHistory = status?.delegationHistory.ok
    ? status.delegationHistory.value ?? []
    : [];

  const selfBech32m = walletAddress;

  const openDelegate = (clusterId: number, weightBps: number, principalLyth: bigint) => {
    const weightLabel = `${(weightBps / 100).toFixed(2)}%`;
    const principalLythoshi = principalLyth * 100_000_000n; // 1 LYTH = 1e8 lythoshi
    ops.open({
      title: `Delegate ${principalLyth} LYTH to cluster ${clusterId}`,
      subtitle: `Stake ${weightLabel} of wallet weight, ${principalLyth} LYTH principal`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Cluster", v: String(clusterId) },
        { k: "Weight", v: weightLabel },
        { k: "Principal", v: `${principalLyth} LYTH (${principalLythoshi.toString()} lythoshi)` },
        { k: "Precompile", v: "0x…100a" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Encodes delegate(uint32 clusterId, uint16 weightBps) calldata via @monolythium/core-sdk." },
        { text: `Travels msg.value=${principalLythoshi.toString()} lythoshi — this is the principal stake.` },
        { text: "Wraps the native tx in an encrypted envelope; submits via lyth_submitEncrypted." },
        {
          text: "Chain rejects at the precompile gate if delegation is gated off, the cluster is inactive, or the per-cluster cap would be exceeded — verbatim error surfaces here.",
          level: "warn",
        },
      ],
      notify: {
        kind: "delegate",
        amountDecimal: principalLyth.toString(),
        counterparty: DELEGATION_PRECOMPILE,
      },
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const calldata = buildDelegateCalldata(clusterId, weightBps);
        const result = await submitStakingTx({
          seed: ctx.vaultSeed,
          data: calldata,
          valueLythoshi: principalLythoshi,
        });
        return {
          headline: `Delegated ${principalLyth} LYTH @ ${weightLabel} to cluster ${clusterId}`,
          detail: result.txHash,
          txHash: result.txHash,
        };
      },
    });
    setOpenForm(null);
    setDraftError(null);
  };

  const runAutovote = (mode: Exclude<AutovoteMode, "custom">) => {
    setAutovoteError(null);

    let totalPrincipal: bigint;
    try {
      totalPrincipal = BigInt(autoPrincipalLyth);
    } catch {
      setAutovoteError("Total principal must be a positive integer of whole LYTH.");
      return;
    }
    if (totalPrincipal <= 0n) {
      setAutovoteError("Total principal must be > 0 whole LYTH.");
      return;
    }
    const capBps = parseInt(autoCapBps, 10);
    if (!Number.isFinite(capBps) || capBps <= 0 || capBps > 10_000) {
      setAutovoteError("Weight cap must be 1-10000 basis points (0.01% – 100%).");
      return;
    }

    const plan = buildAutovotePlan({
      mode,
      clusters: directory,
      diversities,
      totalPrincipalLyth: totalPrincipal,
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
      subtitle: `Spread ${totalPrincipal} LYTH across ${plan.allocations.length} clusters (${plan.totalWeightBps} bps total)`,
      auth: "keychain",
      diff: [
        { k: "From", v: selfBech32m },
        { k: "Mode", v: modeLabel[mode] },
        { k: "Clusters", v: String(plan.allocations.length) },
        { k: "Total weight", v: `${(plan.totalWeightBps / 100).toFixed(2)}%` },
        ...plan.allocations.map((a) => ({
          k: `Cluster ${a.clusterId}`,
          v: `${(a.weightBps / 100).toFixed(2)}% · ${a.principalLyth} LYTH`,
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
            Spread a principal across active clusters by a chosen objective.
            Diversity / Decentralization consume live per-cluster diversity
            scoring; Custom keeps the per-cluster Delegate form below.
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
                Total principal (whole LYTH)
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={autoPrincipalLyth}
                onChange={(e) => {
                  setAutoPrincipalLyth(e.target.value);
                  setAutovoteError(null);
                }}
                style={autovoteInputStyle}
              />
            </div>
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
                Weight cap (bps · 100 = 1%)
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
                    {experimentalEnabled
                      ? (() => {
                          const div = diversities.get(c.clusterId);
                          return (
                            <div className="row-help mono">
                              Diversity ·{" "}
                              {div
                                ? `${(div.score / 100).toFixed(1)}% (ASN ${(
                                    div.asnVariance / 100
                                  ).toFixed(0)} · geo ${(div.geoVariance / 100).toFixed(
                                    0,
                                  )} · host ${(div.hostingSpread / 100).toFixed(0)})`
                                : "—"}
                            </div>
                          );
                        })()
                      : null}
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
                    <label
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "var(--fg-400)",
                      }}
                    >
                      Principal (whole LYTH)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={draftPrincipalLyth}
                      onChange={(e) => {
                        setDraftPrincipalLyth(e.target.value);
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
                          let principal: bigint;
                          try {
                            principal = BigInt(draftPrincipalLyth);
                          } catch {
                            setDraftError("Principal must be a positive integer of whole LYTH.");
                            return;
                          }
                          if (principal <= 0n) {
                            setDraftError("Principal must be > 0 whole LYTH.");
                            return;
                          }
                          openDelegate(c.clusterId, bps, principal);
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
