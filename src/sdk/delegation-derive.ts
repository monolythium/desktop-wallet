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

/** The chain-exact effective weight, as a whole-LYTH decimal string.
 *
 *  The chain stores and votes with `floor(balance × bps / 10000 / 10^18)` — a
 *  WHOLE-LYTH counter. A fractional remainder earns nothing and casts no vote,
 *  so displaying "530.1 LYTH" where the chain credits 530 overstates the
 *  position by exactly the part that does not count.
 *
 *  This is a different quantity from {@link effectiveWeightLythoshi}, which is
 *  the precise delegated amount. The wallet never forces them equal and never
 *  labels the precise figure "effective weight".
 *
 *  Null on an absent/undecodable balance or an invalid bps — the caller then
 *  keeps the bps-only percent rather than a fabricated LYTH figure. Pure. */
export function effectiveWeightWholeLyth(
  balanceLythoshi: string | null | undefined,
  weightBps: number,
): string | null {
  const raw = effectiveWeightLythoshi(balanceLythoshi, weightBps);
  if (raw === null) return null;
  // Second floor, onto the whole-LYTH grid the chain actually counts.
  return (BigInt(raw) / 10n ** 18n).toString();
}

/** Derived effective-weight formatted as display LYTH (default 4 dp, via the
 *  shared exact formatter), or null when the balance is unavailable — the caller
 *  then falls back to the bps-only percent. Pure.
 *
 *  NOTE: this is the PRECISE delegated amount, not the voting weight. Weight
 *  labels use {@link effectiveWeightWholeLyth}. */
export function effectiveWeightLythDisplay(
  balanceLythoshi: string | null | undefined,
  weightBps: number,
  decimals = 4,
): string | null {
  const raw = effectiveWeightLythoshi(balanceLythoshi, weightBps);
  return raw === null ? null : formatLythDisplay(raw, decimals);
}

/** The balance as an exact bigint, or null when it is absent / undecodable /
 *  negative — the same tolerance {@link effectiveWeightLythoshi} applies, so the
 *  inert test and the weight figures can never disagree about what is readable. */
function balanceOrNull(balanceLythoshi: string | null | undefined): bigint | null {
  if (
    balanceLythoshi === null ||
    balanceLythoshi === undefined ||
    balanceLythoshi.trim() === ""
  ) {
    return null;
  }
  try {
    const balance = BigInt(balanceLythoshi);
    return balance < 0n ? null : balance;
  } catch {
    return null;
  }
}

/**
 * Would this weight credit nothing at all?
 *
 * The chain counts effective weight on a WHOLE-LYTH grid, so a weight whose
 * effective value floors to zero is accepted, earns nothing, casts no vote, and
 * still costs a fee. Every cap check passes it — it is well inside every cap —
 * which is why this is a separate question from whether the delegation is
 * allowed.
 *
 * FAILS OPEN, and deliberately. An unknown balance yields null from the
 * arithmetic (A6) and this returns FALSE: null means *cannot test*, not *inert*,
 * and a guard that cannot evaluate its own condition must not refuse on
 * suspicion. That is the cap re-read's reasoning, not the destination check's —
 * a false pass here costs a fee on a delegation that earns nothing, while a
 * false block would deny a perfectly good delegation on a failed balance read.
 *
 * A zero balance is likewise not inert: there is nothing to round down, and the
 * zero-weight guard already covers it. Pure.
 */
export function isInertDelegation(
  balanceLythoshi: string | null | undefined,
  weightBps: number,
): boolean {
  if (!Number.isInteger(weightBps) || weightBps < 1) return false;
  const balance = balanceOrNull(balanceLythoshi);
  if (balance === null || balance <= 0n) return false;
  return effectiveWeightWholeLyth(balanceLythoshi, weightBps) === "0";
}

/** The smallest weight that credits one whole LYTH at this balance, or null when
 *  there is none to quote — an unknown balance, a zero balance, or a balance
 *  below one whole LYTH, where no weight up to 100% can reach one.
 *
 *  Rounds UP (integer ceil), because the floor of the quoted weight must itself
 *  still reach a whole LYTH. Out of range returns null rather than being clamped
 *  to 10000 (A5) — quoting an unreachable minimum as if it were reachable would
 *  send the user to a weight that is still inert. Pure. */
export function minNonInertBps(
  balanceLythoshi: string | null | undefined,
): number | null {
  const balance = balanceOrNull(balanceLythoshi);
  if (balance === null || balance <= 0n) return null;
  const numerator = 10_000n * 10n ** 18n;
  const ceilBps = (numerator + balance - 1n) / balance;
  return ceilBps > 10_000n ? null : Number(ceilBps);
}

/** The refusal shown for an inert delegation.
 *
 *  Says what is actually wrong — this weight credits nothing at this balance —
 *  and quotes the minimum in BASIS POINTS, the unit the forms actually take, so
 *  the user is not left converting a percentage. When no weight can reach one
 *  whole LYTH it says that instead of quoting an impossible number.
 *
 *  Carries no wording the drawer's error classifier would read as a chain
 *  revert, which would replace the whole body with a generic sentence. Pure. */
export function inertDelegationMessage(
  balanceLythoshi: string | null | undefined,
  bindingCapBps?: number,
): string {
  const head =
    "This weight credits 0 LYTH at your balance — it would earn nothing and cast no vote.";
  const minBps = minNonInertBps(balanceLythoshi);
  if (minBps === null) {
    return `${head} No weight reaches a whole LYTH until your balance grows.`;
  }
  // At a low enough balance the smallest useful weight sits ABOVE the
  // per-cluster cap. Quoting it would send the user to a weight the cap then
  // refuses — advice that cannot be followed, on a fund control.
  if (bindingCapBps !== undefined && minBps > bindingCapBps) {
    return `${head} It would take ${minBps} bps to reach a whole LYTH, which is over the ${(bindingCapBps / 100).toFixed(0)}% per-cluster cap — no allowed weight works at this balance.`;
  }
  return `${head} Use at least ${minBps} bps (${(minBps / 100).toFixed(2)}%).`;
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
