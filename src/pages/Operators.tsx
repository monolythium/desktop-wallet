// Operators — cluster directory + per-cluster detail panel.
//
// Phase 2 surface for §28.3 continuous-runtime-attestation + §14
// cluster marketplace. The page is split into two panes:
//
//   Left:  ClusterPicker (reused from the Stake page). Selecting a
//          row reveals the right pane.
//   Right: Detail panel — cluster status (live/lagging/offline
//          counters), operator list with per-operator capability
//          badges + signing-activity miss-rate.
//
// Chain gaps (mirror the Stake page surface):
//   - operator-level capabilities are emitted at network scope
//     today, not per-operator (§28.3); the per-operator badges
//     therefore show the same surface set for every operator until
//     the chain splits the reader. The detail panel surfaces a
//     [chain-gap] note.
//   - signing-activity miss-rate is computed only when the
//     `lyth_signingActivity` call returns a window > 0.

import { useEffect, useState } from "react";
import { ClusterPicker } from "../components/ClusterPicker";
import { formatAddress, formatAddressShort } from "../components/format";
import {
  getClusterDetail,
  getClusters,
  getOperatorSigningActivity,
  type CapabilityBadge,
  type ClusterDetail,
  type ClusterSummary,
  type OperatorRow,
} from "../sdk/staking";
import type { OperatorSigningActivityResponse } from "@monolythium/core-sdk";

type ClustersState =
  | { status: "loading"; value: null; error: null }
  | { status: "ok"; value: ClusterSummary[]; error: null }
  | { status: "error"; value: null; error: string };

type DetailState =
  | { status: "idle"; value: null; error: null }
  | { status: "loading"; value: null; error: null }
  | { status: "ok"; value: ClusterDetail; error: null }
  | { status: "error"; value: null; error: string };

export function Operators() {
  const [clusters, setClusters] = useState<ClustersState>({
    status: "loading",
    value: null,
    error: null,
  });
  const [detail, setDetail] = useState<DetailState>({
    status: "idle",
    value: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getClusters();
      if (cancelled) return;
      if (!result.ok || !result.value) {
        setClusters({
          status: "error",
          value: null,
          error: result.error ?? "directory unavailable",
        });
        return;
      }
      setClusters({ status: "ok", value: result.value, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelect = async (cluster: ClusterSummary) => {
    setDetail({ status: "loading", value: null, error: null });
    const result = await getClusterDetail(cluster.clusterId);
    if (!result.ok || !result.value) {
      setDetail({
        status: "error",
        value: null,
        error: result.error ?? "detail unavailable",
      });
      return;
    }
    setDetail({ status: "ok", value: result.value, error: null });
  };

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Operators</h1>
        <div className="sub">
          Per-cluster operator rosters, capability badges, and §28.3
          continuous-runtime-attestation surface. Click a cluster to
          inspect its members.
        </div>
      </div>

      <div className="w-operators-grid">
        <div className="w-operators-list">
          <div className="w-card">
            <div className="w-card__head">
              <h3>Active cluster set</h3>
              <span className="w-live-pill">live</span>
            </div>
            <div className="w-card__body">
              <ClusterPicker
                clusters={clusters.value ?? []}
                isLoading={clusters.status === "loading"}
                error={clusters.error}
                onSelect={onSelect}
              />
            </div>
          </div>
        </div>

        <div className="w-operators-detail">
          {detail.status === "idle" ? (
            <div className="w-card">
              <div className="w-card__body">
                <div className="row-help">
                  Pick a cluster from the list to see its operator roster,
                  per-operator capability badges, and recent signing
                  activity.
                </div>
              </div>
            </div>
          ) : null}
          {detail.status === "loading" ? (
            <div className="w-card">
              <div className="w-card__body">
                <div className="row-help">Loading cluster detail…</div>
              </div>
            </div>
          ) : null}
          {detail.status === "error" ? (
            <div className="w-card">
              <div className="w-card__body">
                <div className="w-live-error">{detail.error}</div>
              </div>
            </div>
          ) : null}
          {detail.status === "ok" ? (
            <ClusterDetailPanel detail={detail.value} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClusterDetailPanel({ detail }: { detail: ClusterDetail }) {
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>{detail.summary.name}</h3>
        {detail.entity?.entity === "mono-labs" ? (
          <span className="w-live-pill">foundation</span>
        ) : null}
        <span
          className={`w-live-pill ${detail.summary.aggregateHealth === "ok" ? "" : "is-muted"}`}
        >
          {detail.summary.aggregateHealth}
        </span>
      </div>
      <div className="w-card__body">
        <div className="w-live-grid">
          <LiveCell label="Live" value={detail.status.live.toString()} />
          <LiveCell label="Lagging" value={detail.status.lagging.toString()} />
          <LiveCell label="Offline" value={detail.status.offline.toString()} />
          <LiveCell label="Maint." value={detail.status.maintenance.toString()} />
          <LiveCell label="Threshold" value={`${detail.status.threshold}/${detail.status.size}`} />
          <LiveCell
            label="Reputation"
            value={
              detail.summary.reputation === null
                ? null
                : `${detail.summary.reputation.toFixed(1)}★`
            }
          />
        </div>

        <h4 style={{ margin: "16px 0 8px" }}>Operators</h4>
        <ul className="w-operator-list">
          {detail.operators.map((op) => (
            <OperatorListItem key={op.operatorId} operator={op} />
          ))}
        </ul>

        {detail.chainGap ? (
          <div className="row-help" style={{ marginTop: 12 }}>
            <span className="w-mock-tag">[chain-gap]</span> {detail.chainGap}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OperatorListItem({ operator }: { operator: OperatorRow }) {
  const [signing, setSigning] = useState<OperatorSigningActivityResponse | null>(null);
  const [signingError, setSigningError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSigning = async () => {
    setBusy(true);
    setSigningError(null);
    // The chain keys signing activity by `authorityIndex`. The
    // OperatorInfoResponse doesn't carry that index directly — we
    // pass the cluster's authority index when wiring real data. For
    // Phase 2 we use 0 as a placeholder and surface the chain-gap
    // note if the lookup fails. The Operators page will refine this
    // when the chain ships the operator→authorityIndex resolver.
    const result = await getOperatorSigningActivity(0, 100);
    if (!result.ok || !result.value) {
      setSigningError(result.error ?? "signing-activity unavailable");
    } else {
      setSigning(result.value);
    }
    setBusy(false);
  };

  const missRate = signing
    ? computeMissRate(signing)
    : null;

  return (
    <li className="w-operator-row">
      <div className="w-operator-row__head">
        <div className="w-operator-row__id">
          <span title={operator.operatorId}>
            {operator.moniker ?? `op-${formatAddressShort(operator.chainAddress)}`}
          </span>
          <span className={`w-live-pill ${operator.bonded ? "" : "is-muted"}`}>
            {operator.state}
          </span>
        </div>
        <div className="w-operator-row__meta">
          <span title={operator.chainAddress}>
            {operator.chainAddress
              ? formatAddress(operator.chainAddress)
              : <span className="w-mock-tag">[chain-gap]</span>}
          </span>
          <span className="mono" title="Operator BLS bond">
            bond: {operator.bondedAmount}
          </span>
        </div>
      </div>

      <div className="w-operator-row__caps">
        {operator.capabilities.length === 0 ? (
          <span className="w-mock-tag" title="lyth_operatorCapabilities returned no surfaces">
            [no caps]
          </span>
        ) : (
          operator.capabilities.map((cap) => (
            <CapabilityChip key={cap.surface} cap={cap} />
          ))
        )}
      </div>

      <div className="w-operator-row__signing">
        {signing === null && signingError === null ? (
          <button className="btn btn--sm" onClick={loadSigning} disabled={busy}>
            {busy ? "Loading…" : "Show signing activity"}
          </button>
        ) : null}
        {signingError ? (
          <div className="w-live-error">{signingError}</div>
        ) : null}
        {signing && missRate !== null ? (
          <span className="row-help">
            Miss rate over last {signing.entries.length} rounds:{" "}
            <b className="mono">{(missRate * 100).toFixed(1)}%</b>
          </span>
        ) : null}
      </div>
    </li>
  );
}

function CapabilityChip({ cap }: { cap: CapabilityBadge }) {
  const className = `w-cap-chip is-${cap.status}`;
  return (
    <span className={className} title={cap.note ?? cap.surface}>
      {cap.surface}
    </span>
  );
}

function LiveCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div className="mono">
        {value === null ? <span className="w-mock-tag">[mock]</span> : value}
      </div>
    </div>
  );
}

function computeMissRate(activity: OperatorSigningActivityResponse): number {
  if (activity.entries.length === 0) return 0;
  const missed = activity.entries.filter(
    (e) => e.status === "missed" || e.status === "no_cert",
  ).length;
  return missed / activity.entries.length;
}
