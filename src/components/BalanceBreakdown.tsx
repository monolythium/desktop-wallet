// BalanceBreakdown — public balance posture for the Wallets page.
//
// Renders four numbers:
//
//   - Public LYTH       (chain.snapshot.balanceLyth)
//   - Staked LYTH       (sum of delegations[].weightBps over balance — see note)
//   - Unbonding LYTH    (always 0 per §23.2 — delegators have no unbonding;
//                        kept as a row so the user sees the accounting is
//                        complete and the slot is named)
//   - Pending rewards   (rewards.totalLyth — chain-gapped per Phase 2)
//
// Note on Staked: the chain emits delegations as `weightBps` against the
// wallet's bonded weight, not as absolute amounts. Without `lyth_pendingRewards`
// or an explicit `stakedAmount(addr)` reader, we can't surface the actual
// staked LYTH — only the bps share. The component therefore renders Staked
// as "<X bps over N clusters> [mock]" where N>0, and falls back to "0
// LYTH" when there are no delegations.

import type { ChainSnapshot } from "../sdk/client";
import type { Delegation, PendingRewards } from "../sdk/staking";

interface Props {
  chainSnapshot: ChainSnapshot | null;
  delegations: Delegation[] | null;
  rewards: PendingRewards | null;
  isLoading?: boolean;
}

export function BalanceBreakdown({
  chainSnapshot,
  delegations,
  rewards,
  isLoading = false,
}: Props) {
  const publicLyth =
    chainSnapshot && chainSnapshot.error === null ? chainSnapshot.balanceLyth : null;
  const totalBps =
    delegations !== null
      ? delegations.reduce((a, d) => a + d.weightBps, 0)
      : null;
  const pending = rewards?.totalLyth ?? null;
  return (
    <div className="w-balance-grid">
      <Cell
        label="Public LYTH"
        value={
          isLoading && publicLyth === null
            ? "loading…"
            : publicLyth === null
              ? null
              : `${publicLyth.toFixed(4)} LYTH`
        }
      />
      <Cell
        label="Staked"
        value={
          totalBps === null
            ? null
            : totalBps === 0
              ? "0 LYTH"
              : `${totalBps} bps · ${delegations?.length ?? 0} cluster${(delegations?.length ?? 0) === 1 ? "" : "s"}`
        }
        mockReason={totalBps !== null && totalBps > 0 ? "absolute LYTH amount per delegation not on chain" : undefined}
      />
      <Cell
        label="Unbonding"
        value="0 LYTH"
        note="§23.2 — delegators have no unbonding period"
      />
      <Cell
        label="Pending rewards"
        value={pending === null ? null : `${pending.toFixed(4)} LYTH`}
        mockReason={pending === null ? "lyth_pendingRewards not yet on chain" : undefined}
      />
    </div>
  );
}

function Cell({
  label,
  value,
  note,
  mockReason,
}: {
  label: string;
  value: string | null;
  note?: string;
  mockReason?: string;
}) {
  return (
    <div className="w-live-cell">
      <div className="cap">
        {label}{" "}
        {mockReason ? (
          <span className="w-mock-tag" title={mockReason}>
            [mock]
          </span>
        ) : null}
      </div>
      <div className="mono">
        {value === null ? (
          <span className="w-mock-tag" title="data unavailable">
            —
          </span>
        ) : (
          value
        )}
      </div>
      {note ? <div className="row-help">{note}</div> : null}
    </div>
  );
}
