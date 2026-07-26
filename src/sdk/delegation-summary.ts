// Home delegation-summary adapter.
//
// Folds the live delegation reads (delegations + cluster directory + pending
// rewards) into the small set of facts the Home delegation-summary card renders.
// Pure and side-effect-free so it can be unit tested directly.
//
// HONEST ABSENCE:
//  - `lyth_getDelegations` exposes per-cluster *weight* (basis points) only —
//    there is NO per-delegation principal LYTH read in the SDK. So "Delegated" is
//    reported as total delegated weight, not a fabricated LYTH figure.
//  - There is no per-wallet "slot cap" read (`lyth_getDelegationCap` returns a
//    per-cluster *weight* cap, not a max number of delegations). So the slots
//    line is "N delegated of M active clusters" — both real reads — rather than
//    a fabricated allowance.
//  - There is no APR/yield oracle, so APR is rendered as an em-dash upstream.

import type { LiveDelegationStatus } from "./live";

export interface DelegationSummaryFacts {
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
 * Derive the Home delegation-summary facts from a live delegation status.
 * Tolerant of a null status (pre-load) and of failed sub-reads — never throws,
 * never fabricates a number.
 */
export function deriveDelegationSummary(status: LiveDelegationStatus | null): DelegationSummaryFacts {
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

/**
 * The wallet's currently delegated LYTH, as an exact lythoshi integer string.
 *
 * Delegation on this chain is BY WEIGHT — basis points of the live balance,
 * non-custodial. So the delegated figure is the chain's own definition of the
 * wallet's current weighted contribution (`balance × bps / 10000`), not a
 * fabricated principal and not an escrowed amount: the LYTH stays spendable.
 *
 * This is a DIFFERENT quantity from the whole-LYTH-floored effective voting
 * weight shown on the Delegate page. The two must never be forced equal.
 *
 * Exact bigint math with floor semantics — no float, and the truncation can only
 * ever understate. `totalBps = 0` with a real balance is an honest `"0"`, not an
 * absence. A null balance, or a bps outside `0..10000` / non-integer, yields
 * null so the caller renders an honest absence. Pure.
 */
export function delegatedLythoshiFromBps(
  balanceLythoshi: string | null,
  totalBps: number | null,
): string | null {
  if (balanceLythoshi === null || balanceLythoshi.trim() === "") return null;
  if (
    totalBps === null ||
    !Number.isInteger(totalBps) ||
    totalBps < 0 ||
    totalBps > 10_000
  ) {
    return null;
  }
  let balance: bigint;
  try {
    balance = BigInt(balanceLythoshi.trim());
  } catch {
    return null;
  }
  return ((balance * BigInt(totalBps)) / 10_000n).toString();
}
