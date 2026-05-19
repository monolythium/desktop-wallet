// DelegationsDashboard — active per-cluster delegations + per-row
// management menu.
//
// Data flows in from `getDelegations()` + `getRewards()` (Stake page
// composes both). Each row carries:
//
//   - Cluster name (resolved from the §22.4 cluster-name registry when
//     that lookup lands; today, derived from the entity flag in
//     staking.ts)
//   - Weight in bps + percentage
//   - Per-row pending rewards (chain-gapped → [mock] tag)
//   - Manage menu: Add stake / Unstake / Redelegate / Claim
//
// The action handlers are prop callbacks so the Stake page owns the
// flow wiring (Add stake = open delegate composer with cluster
// preselected; Unstake = Commit 10; Redelegate = Commit 11; Claim =
// Commit 12). This component is render-only.

import { useState } from "react";
import type { Delegation } from "../sdk/staking";

export type DelegationAction =
  | "add-stake"
  | "unstake"
  | "redelegate"
  | "claim";

interface Props {
  delegations: Delegation[] | null;
  isLoading?: boolean;
  error?: string | null;
  /** Map cluster id → pending rewards in LYTH; null = chain-gapped. */
  pendingByCluster?: Map<number, number | null>;
  onAction?: (action: DelegationAction, delegation: Delegation) => void;
  onRefresh?: () => void;
}

export function DelegationsDashboard({
  delegations,
  isLoading = false,
  error = null,
  pendingByCluster,
  onAction,
  onRefresh,
}: Props) {
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Your delegations</h3>
        <span className="w-live-pill">live</span>
        <div className="w-card__head__spacer" />
        {onRefresh ? (
          <button className="btn btn--sm" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
      <div className="w-card__body">
        {isLoading && delegations === null ? (
          <div className="row-help">Loading delegations…</div>
        ) : error ? (
          <div className="w-live-error">{error}</div>
        ) : !delegations || delegations.length === 0 ? (
          <div className="row-help">
            No active delegations. Use the autovote section above or pick a
            cluster manually.
          </div>
        ) : (
          <ul className="w-delegations-list">
            {delegations.map((d) => (
              <DelegationRow
                key={d.clusterId}
                delegation={d}
                pending={pendingByCluster?.get(d.clusterId) ?? null}
                onAction={onAction}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DelegationRow({
  delegation,
  pending,
  onAction,
}: {
  delegation: Delegation;
  pending: number | null;
  onAction?: (action: DelegationAction, delegation: Delegation) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dispatch = (action: DelegationAction) => {
    setMenuOpen(false);
    onAction?.(action, delegation);
  };
  return (
    <li className="w-delegation-row">
      <div className="w-delegation-row__main">
        <div className="w-delegation-row__name">{delegation.clusterName}</div>
        <div className="w-delegation-row__meta">
          <span className="mono">
            {delegation.weightBps} bps · {(delegation.weightBps / 100).toFixed(2)}%
          </span>
          <span>
            APR: {delegation.apr === null ? <Mock /> : <>{(delegation.apr * 100).toFixed(2)}%</>}
          </span>
          <span>
            Pending: {pending === null ? <Mock /> : <>{pending.toFixed(4)} LYTH</>}
          </span>
        </div>
      </div>
      <div className="w-delegation-row__actions">
        <button
          className="btn btn--sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          Manage ▾
        </button>
        {menuOpen ? (
          <div className="w-menu" role="menu">
            <button role="menuitem" className="w-menu__item" onClick={() => dispatch("add-stake")}>
              Add stake
            </button>
            <button role="menuitem" className="w-menu__item" onClick={() => dispatch("unstake")}>
              Unstake
            </button>
            <button role="menuitem" className="w-menu__item" onClick={() => dispatch("redelegate")}>
              Redelegate
            </button>
            <button role="menuitem" className="w-menu__item" onClick={() => dispatch("claim")}>
              Claim rewards
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Mock() {
  return <span className="w-mock-tag">[mock]</span>;
}
