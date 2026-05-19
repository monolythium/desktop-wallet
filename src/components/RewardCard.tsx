// RewardCard — pending-rewards primitive used on Stake page + Home.
//
// The chain's `claim()` primitive (mono-core delegation precompile,
// MS-CORE-0009) settles + withdraws ALL pending rewards in one tx.
// There's no per-cluster claim — the chain doesn't expose a
// `claimFromCluster(uint32)` selector — so this card is dominated by
// "Claim all" rather than per-row claim buttons.
//
// Pending rewards aren't yet emitted by the v2 testnet
// (`lyth_pendingRewards` not live as of Phase 2); the card renders
// with [mock] tags where the chain hasn't surfaced amounts. See
// GAP #D2 in docs/phases/phase-02-staking.md.

import type { PendingRewards } from "../sdk/staking";

interface Props {
  rewards: PendingRewards | null;
  isLoading?: boolean;
  /** Triggered when the user clicks "Claim all". */
  onClaim?: () => void;
  /** Optional refresh hook surfaced as a small icon button. */
  onRefresh?: () => void;
  /** Compact mode for Home — single row, no per-cluster breakdown. */
  compact?: boolean;
}

export function RewardCard({
  rewards,
  isLoading = false,
  onClaim,
  onRefresh,
  compact = false,
}: Props) {
  const total = rewards?.totalLyth ?? null;
  const isChainGap = total === null;
  const hasCallable = total !== null && total > 0;
  return (
    <div className={`w-card ${compact ? "w-card--compact" : ""}`}>
      <div className="w-card__head">
        <h3>Pending rewards</h3>
        {isChainGap ? (
          <span className="w-mock-tag" title={rewards?.chainGap ?? undefined}>
            [mock]
          </span>
        ) : null}
        <div className="w-card__head__spacer" />
        {onRefresh ? (
          <button className="btn btn--sm" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "…" : "Refresh"}
          </button>
        ) : null}
      </div>
      <div className="w-card__body">
        <div className="w-reward-headline">
          {total === null ? (
            <span className="w-reward-amount is-mock">—</span>
          ) : (
            <span className="w-reward-amount">{total.toFixed(4)}</span>
          )}
          <span className="tok">LYTH</span>
          {onClaim ? (
            <button
              className="btn btn--primary"
              onClick={onClaim}
              disabled={!hasCallable}
              style={{ marginLeft: "auto" }}
            >
              Claim all
            </button>
          ) : null}
        </div>

        {compact ? null : (
          <>
            {rewards?.lastClaimedHeight !== null && rewards?.lastClaimedHeight !== undefined ? (
              <div className="row-help" style={{ marginTop: 8 }}>
                Last claim at block {rewards.lastClaimedHeight.toString()}
              </div>
            ) : null}

            {rewards && rewards.perCluster.length > 0 ? (
              <ul className="w-reward-list" style={{ marginTop: 10 }}>
                {rewards.perCluster.map((row) => (
                  <li key={row.clusterId} className="w-reward-row">
                    <span>{row.clusterName}</span>
                    <span className="mono">
                      {row.amountLyth === null ? (
                        <span className="w-mock-tag">[mock]</span>
                      ) : (
                        `${row.amountLyth.toFixed(4)} LYTH`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {isChainGap ? (
              <div className="row-help" style={{ marginTop: 8 }}>
                The chain's pending-rewards reader (`lyth_pendingRewards`)
                isn't yet emitting on v2 testnet. The Claim all action
                still works — the chain's `claim()` primitive settles
                whatever rewards have accrued.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
