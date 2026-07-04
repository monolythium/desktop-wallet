// Derived Delegate-page figures.
//
// The SDK exposes per-cluster / per-wallet delegation *weight* (basis points)
// only — there is NO per-delegation principal LYTH read. So every LYTH figure
// on the Delegate page is DERIVED from the live wallet balance:
//
//   effective weight (lythoshi) = floor(balanceLythoshi × weightBps / 10000)
//
// When the balance read is unavailable the LYTH figure is honestly absent
// (null) and the caller falls back to the bps-only percent — never a fabricated
// LYTH number. All pure; no chain lookup, no DOM.

import { bpsToPercentLabel } from "./delegation-summary";
import { formatLythDisplay } from "./lyth-display";

/** Derived effective-weight in raw lythoshi: floor(balance × weightBps / 10000).
 *  Returns null when the balance is absent / blank / undecodable / negative, or
 *  the bps is not a non-negative integer — the caller then shows the bps-only
 *  percent rather than a fabricated LYTH figure. Pure. */
export function effectiveWeightLythoshi(
  balanceLythoshi: string | null | undefined,
  weightBps: number,
): string | null {
  if (
    balanceLythoshi === null ||
    balanceLythoshi === undefined ||
    balanceLythoshi.trim() === ""
  ) {
    return null;
  }
  if (!Number.isInteger(weightBps) || weightBps < 0) return null;
  let balance: bigint;
  try {
    balance = BigInt(balanceLythoshi);
  } catch {
    return null;
  }
  if (balance < 0n) return null;
  // Integer division floors — the exact bigint derivation, never a float.
  return ((balance * BigInt(weightBps)) / 10_000n).toString();
}

/** Derived effective-weight formatted as display LYTH (default 4 dp, via the
 *  shared exact formatter), or null when the balance is unavailable — the caller
 *  then falls back to the bps-only percent. Pure. */
export function effectiveWeightLythDisplay(
  balanceLythoshi: string | null | undefined,
  weightBps: number,
  decimals = 4,
): string | null {
  const raw = effectiveWeightLythoshi(balanceLythoshi, weightBps);
  return raw === null ? null : formatLythDisplay(raw, decimals);
}

/** Summary of a wallet's active delegations: the count of clusters carrying
 *  weight, the total delegated basis points (the real `delegations.totalBps`
 *  read, passed in), and its percent label. Pure. */
export function activeDelegationsSummary(
  rows: ReadonlyArray<{ weightBps: number }>,
  totalBps: number,
): { count: number; totalBps: number; percentLabel: string } {
  const count = rows.filter((r) => r.weightBps > 0).length;
  return { count, totalBps, percentLabel: bpsToPercentLabel(totalBps) };
}
