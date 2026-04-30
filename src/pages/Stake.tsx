// Stake page — DVT cluster delegation. Public denom only.
// Stage 2 placeholder; live wiring lands when lyth_validatorSet +
// stake-position RPCs are stable.

import { TodoSection } from "../components/TodoSection";

export function Stake() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Stake</h1>
        <div className="sub">DVT clusters · 100 operators × 7 slots = 700 seats.</div>
      </div>

      <TodoSection
        title="My stakes"
        items={[
          "TODO — list of clusters this wallet has stake in (multi-vote up to 10)",
          "TODO — per-cluster amount + earned (30d) + unlock window",
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
          "TODO — total seats filled / open (live from validatorSet)",
          "TODO — foundation vs marketplace operators",
          "TODO — current swap window (3-epoch notice)",
        ]}
      />
    </div>
  );
}
