// Stake page — DVT cluster delegation. Public denom only.
// Live read-only RPCs are wired where the SDK exposes them; write flows
// remain as visible placeholders.

import { useEffect, useState } from "react";
import { TodoSection } from "../components/TodoSection";
import { IDENTITY } from "../data/fixtures";
import { formatOutcome, loadLiveStakeStatus, type LiveStakeStatus } from "../sdk/live";

export function Stake() {
  const [status, setStatus] = useState<LiveStakeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setStatus(await loadLiveStakeStatus(IDENTITY.address));
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
  const delegationHistory = status?.delegationHistory.ok ? status.delegationHistory.value ?? [] : [];

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Stake</h1>
        <div className="sub">DVT clusters · 100 operators × 7 slots = 700 seats.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live staking reads</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          <div className="w-live-grid">
            <LiveCell label="Clusters" value={status ? formatOutcome(status.clusters, (rows) => rows.length.toString()) : "loading"} />
            <LiveCell label="Active" value={status ? formatOutcome(status.activeClusters, (rows) => rows.length.toString()) : "loading"} />
            <LiveCell label="Healthy" value={status ? formatOutcome(status.healthyClusters, (rows) => rows.length.toString()) : "loading"} />
            <LiveCell label="My bps" value={delegations ? delegations.totalBps.toString() : status?.delegations.error ?? "loading"} />
          </div>
          {status ? <div className="row-help">Endpoint: <span className="mono">{status.endpoint}</span></div> : null}
          {clusters.length > 0 ? (
            <div className="w-live-list">
              {clusters.slice(0, 6).map((cluster) => (
                <div className="w-live-row" key={cluster.id}>
                  <div>
                    <div className="row-label">Cluster #{cluster.id}</div>
                    <div className="row-help mono">{cluster.pubkey.slice(0, 18)}…{cluster.pubkey.slice(-10)}</div>
                  </div>
                  <div className="w-live-right">
                    <div className="mono">{cluster.stake}</div>
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
                <div className="w-live-row" key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}>
                  <div>
                    <div className="row-label">{row.kind}</div>
                    <div className="row-help">block {row.blockHeight.toString()}</div>
                  </div>
                  <div className="w-live-right mono">{row.weightBps} bps</div>
                </div>
              ))}
            </div>
          ) : null}
          {clusters.length === 0 && status?.clusters.ok ? <div className="row-help">Cluster descriptor set is empty.</div> : null}
          {status?.clusters.ok === false ? <div className="w-live-error">cluster set: {status.clusters.error}</div> : null}
          {status?.delegations.ok === false ? <div className="w-live-error">delegations: {status.delegations.error}</div> : null}
          {status?.delegationHistory.ok === false ? <div className="w-live-error">delegation history: {status.delegationHistory.error}</div> : null}
          {active.length || healthy.length ? null : null}
        </div>
      </div>

      <TodoSection
        title="My stakes"
        items={[
          "TODO — list of clusters this wallet has stake in (multi-vote up to 10)",
          "TODO — per-cluster amount + earned (30d) + unlock window; current bps + event history are live",
          "TODO — auto-compound toggle per stake (OperationsDrawer write)",
          "TODO — claim rewards (OperationsDrawer write)",
          "TODO — withdraw / migrate to a different cluster (cooldown 14d+1ep)",
        ]}
      />

      <TodoSection
        title="Cluster marketplace"
        items={[
          "TODO — full cluster list (lyth_listClusters when surfaced)",
          "TODO — filter by region · APR · reliability · diversity score",
          "TODO — cluster detail: members, slot fill (live/total), TVS, slashing history",
          "TODO — stake to cluster (OperationsDrawer write)",
        ]}
      />

      <TodoSection
        title="Operator path"
        items={[
          "TODO — apply to run a cluster slot (deep link to /staking on website)",
          "TODO — bond commitment estimator",
          "TODO — operator profile preview (hardware attest, public uptime, refs)",
        ]}
      />

      <TodoSection
        title="Network state"
        items={[
          "TODO — total seats filled / open (live descriptor count is wired)",
          "TODO — foundation vs marketplace operators",
          "TODO — current swap window (3-epoch notice)",
        ]}
      />
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
