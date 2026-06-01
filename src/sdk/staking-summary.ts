// Home staking-summary adapter.
//
// Folds the live staking reads (delegations + cluster directory + pending
// rewards) into the small set of facts the Home staking-summary card renders.
// Pure and side-effect-free so it can be unit tested directly.
//
// HONEST ABSENCE:
//  - `lyth_getDelegations` exposes per-cluster *weight* (basis points) only —
//    there is NO per-delegation principal LYTH read in the SDK. So "Staked" is
//    reported as total delegated weight, not a fabricated LYTH figure.
//  - There is no per-wallet "slot cap" read (`lyth_getDelegationCap` returns a
//    per-cluster *weight* cap, not a max number of delegations). So the slots
//    line is "N delegated of M active clusters" — both real reads — rather than
//    a fabricated allowance.
//  - There is no APR/yield oracle, so APR is rendered as an em-dash upstream.

import type { LiveStakeStatus } from "./live";

export interface StakeSummaryFacts {
  /** Number of clusters this wallet currently delegates to. */
  delegationCount: number;
  /** Sum of delegated weight across the wallet, in basis points. */
  totalWeightBps: number;
  /** Total delegated weight as a percent string (e.g. "12.50%"), or "—" when
   *  unavailable / not delegated. */
  totalWeightLabel: string;
  /** Count of active clusters on the network (the honest "of M" denominator). */
  activeClusterCount: number;
  /** True when the delegations read failed (the card shows the error). */
  delegationsFailed: boolean;
  /** Verbatim node error when the delegations read failed, else null. */
  delegationsError: string | null;
}

/** Format a basis-point weight as a percent string (100 bps = 1%). */
export function bpsToPercentLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Derive the Home staking-summary facts from a live stake status. Tolerant of
 * a null status (pre-load) and of failed sub-reads — never throws, never
 * fabricates a number.
 */
export function deriveStakeSummary(status: LiveStakeStatus | null): StakeSummaryFacts {
  const delegations = status?.delegations.ok ? status.delegations.value : null;
  const delegationsFailed = status?.delegations.ok === false;
  const delegationsError = delegationsFailed ? status?.delegations.error ?? "unavailable" : null;

  const active = status?.activeClusters.ok ? status.activeClusters.value ?? [] : [];

  const totalWeightBps = delegations?.totalBps ?? 0;
  const delegationCount = delegations?.rows.length ?? 0;

  return {
    delegationCount,
    totalWeightBps,
    totalWeightLabel:
      delegations && delegationCount > 0 ? bpsToPercentLabel(totalWeightBps) : "—",
    activeClusterCount: active.length,
    delegationsFailed,
    delegationsError,
  };
}
