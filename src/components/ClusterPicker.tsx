// ClusterPicker — sortable, searchable list of clusters.
//
// The Stake page (autovote preview, manual delegation) and the
// Operators page (cluster detail entry) both render this. Drawing one
// component for both keeps the cluster-row visual language consistent
// — same name format, same Foundation badge placement, same capability
// surfacing, same chain-gap [mock] tagging.
//
// Data comes from `getClusters()` (src/sdk/staking.ts). The Phase 2
// chain-gap reality: APR / reputation / uptime / totalStake are null
// until the chain ships those readers; the picker still renders the
// columns with the `[mock]` styling so users see "preview" rather
// than empty cells.

import { useMemo, useState } from "react";
import type { ClusterSummary } from "../sdk/staking";

export type ClusterSortKey =
  | "reputation"
  | "apr"
  | "uptime"
  | "totalStake"
  | "name";

interface Props {
  /** Cluster set; pass the resolved `RpcOutcome.value` from getClusters. */
  clusters: ClusterSummary[];
  /** `null` while the SDK call is in flight. */
  isLoading?: boolean;
  /** Surfaced when getClusters returned `ok: false`. */
  error?: string | null;
  /** Caller-handled refresh action (e.g. retry button). */
  onRefresh?: () => void;
  /** Optional row-select handler — for the Operators detail-on-click flow. */
  onSelect?: (cluster: ClusterSummary) => void;
  /** Exclude these cluster ids — used by the redelegate flow to hide
   *  the source cluster from the picker. */
  excludeIds?: number[];
}

const SORT_LABELS: Record<ClusterSortKey, string> = {
  reputation: "Reputation",
  apr: "APR",
  uptime: "Uptime",
  totalStake: "Total stake",
  name: "Name",
};

export function ClusterPicker({
  clusters,
  isLoading = false,
  error = null,
  onRefresh,
  onSelect,
  excludeIds,
}: Props) {
  const [sortKey, setSortKey] = useState<ClusterSortKey>("reputation");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const exclude = new Set(excludeIds ?? []);
    const needle = search.trim().toLowerCase();
    return clusters
      .filter((c) => !exclude.has(c.clusterId))
      .filter((c) => {
        if (!needle) return true;
        if (c.name.toLowerCase().includes(needle)) return true;
        if (String(c.clusterId).includes(needle)) return true;
        return false;
      });
  }, [clusters, excludeIds, search]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => compareByKey(sortKey, a, b));
    return out;
  }, [filtered, sortKey]);

  return (
    <div className="w-cluster-picker">
      <div className="w-cluster-picker__head">
        <input
          className="w-live-input mono"
          type="search"
          placeholder="Search by name or cluster id"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          aria-label="Search clusters"
        />
        <div className="w-cluster-picker__sort">
          <span className="cap">Sort by</span>
          {(Object.keys(SORT_LABELS) as ClusterSortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`w-chip ${sortKey === key ? "is-on" : ""}`}
              onClick={() => setSortKey(key)}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="row-help">Loading clusters…</div>
      ) : error ? (
        <div className="w-live-error">
          {error}
          {onRefresh ? (
            <button className="btn btn--sm" onClick={onRefresh} style={{ marginLeft: 8 }}>
              Retry
            </button>
          ) : null}
        </div>
      ) : sorted.length === 0 ? (
        <div className="row-help">
          No clusters match. {search ? "Clear the search to see all." : null}
        </div>
      ) : (
        <ul className="w-cluster-picker__list">
          {sorted.map((c) => (
            <ClusterRow
              key={c.clusterId}
              cluster={c}
              onSelect={onSelect ? () => onSelect(c) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClusterRow({
  cluster,
  onSelect,
}: {
  cluster: ClusterSummary;
  onSelect?: () => void;
}) {
  const interactive = Boolean(onSelect);
  return (
    <li
      className={`w-cluster-row ${interactive ? "is-interactive" : ""}`}
      role={interactive ? "button" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      tabIndex={interactive ? 0 : undefined}
      data-cluster-id={cluster.clusterId}
    >
      <div className="w-cluster-row__main">
        <div className="w-cluster-row__name">
          <span>{cluster.name}</span>
          {cluster.entity === "mono-labs" ? (
            <span className="w-live-pill" aria-label="Foundation cluster">
              foundation
            </span>
          ) : null}
          <span
            className={`w-live-pill ${cluster.aggregateHealth === "ok" ? "" : "is-muted"}`}
          >
            {cluster.aggregateHealth}
          </span>
        </div>
        <div className="w-cluster-row__meta">
          <span title="Threshold / size">
            {cluster.threshold}/{cluster.size} ops
          </span>
          {cluster.regionDiversity && cluster.regionDiversity.length > 0 ? (
            <span>{cluster.regionDiversity.join(" · ")}</span>
          ) : (
            <span className="w-mock-tag" title="Region diversity not yet on chain">
              [region: mock]
            </span>
          )}
        </div>
      </div>
      <div className="w-cluster-row__stats">
        <Stat
          label="Reputation"
          value={cluster.reputation === null ? null : `${cluster.reputation.toFixed(1)}★`}
        />
        <Stat
          label="APR"
          value={cluster.apr === null ? null : `${(cluster.apr * 100).toFixed(2)}%`}
        />
        <Stat
          label="Uptime"
          value={cluster.uptime === null ? null : `${(cluster.uptime * 100).toFixed(1)}%`}
        />
        <Stat
          label="Total stake"
          value={
            cluster.totalStakeLyth === null
              ? null
              : `${cluster.totalStakeLyth.toFixed(0)} LYTH`
          }
        />
      </div>
    </li>
  );
}

/** One stat cell — renders the value or a [mock] tag when null. */
function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="w-cluster-stat">
      <div className="cap">{label}</div>
      <div className={value === null ? "" : "mono"}>
        {value ?? <span className="w-mock-tag">[mock]</span>}
      </div>
    </div>
  );
}

function compareByKey(
  key: ClusterSortKey,
  a: ClusterSummary,
  b: ClusterSummary,
): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name);
    case "reputation":
      return numDesc(a.reputation, b.reputation);
    case "apr":
      return numDesc(a.apr, b.apr);
    case "uptime":
      return numDesc(a.uptime, b.uptime);
    case "totalStake":
      return numDesc(a.totalStakeLyth, b.totalStakeLyth);
  }
}

/**
 * Descending numeric compare with `null` always last.
 * (Chain-gapped fields stay at the bottom of every "best-first" sort.)
 */
function numDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
