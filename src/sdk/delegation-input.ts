// Input parsing for the fund-relevant delegation fields — pure, React-free,
// unit-pinnable.
//
// Why this exists rather than `parseInt(raw, 10)` at each call site:
//
// `parseInt` reads a numeric PREFIX and stops at the first character it does not
// understand. It never reports that it stopped early, so a value the user typed
// and a value the wallet signs can differ silently. On these fields that
// difference is a different transaction:
//
//   parseInt("1e1", 10)   === 1      cluster 10 → cluster 1
//   parseInt("1e3", 10)   === 1      1000 bps (10%) → 1 bps (0.01%)
//   parseInt("12.9", 10)  === 12
//   parseInt("50abc", 10) === 50
//
// The exponent forms are not contrived: the delegation inputs are
// `type="number"`, for which `1e1` is a browser-legal value handed through
// verbatim. There is no <form> on the page, so native constraint validation
// never runs and this test is the only gate between the keystroke and the
// encoder.
//
// The rule is therefore FULL-STRING: the trimmed field must be nothing but
// digits, and must survive the round trip to a number exactly. Anything else is
// refused and explained, never quietly reinterpreted.

import { effectiveWeightWholeLyth, isInertDelegation } from "./delegation-derive";

/** The anchored full-string parse for a non-negative integer field.
 *
 *  Returns the value only when the entire trimmed input is digits and the result
 *  is an exact safe integer; `null` for every other input, including a numeric
 *  prefix followed by anything else. Callers surface a bounded refusal — no
 *  caller may fall back to a looser parse.
 *
 *  Non-negative because every field it guards is: cluster ids start at 0 and
 *  weights at 1. Pure. */
export function parseExactNonNegativeInteger(
  raw: string | null | undefined,
): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Anchored: digits and nothing else. Refuses "1e1", "12.9", "50abc", "-1",
  // "+1", "" and " " alike.
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  // Past the safe-integer range the parsed value no longer equals what was
  // typed, which is the very failure this function exists to prevent.
  return Number.isSafeInteger(value) ? value : null;
}

/** The widest weight any delegation field may carry (100%). */
const MAX_WEIGHT_BPS = 10_000;

/**
 * The custom autovote allocations a user has typed, split into what could be
 * read and what could not.
 *
 * An entry that cannot be read is reported rather than dropped. Dropping it
 * would quietly shrink the plan — the same silent reinterpretation the anchored
 * parse exists to end, one level up. An empty field is genuinely absent (it is
 * how a cluster is removed from the plan), and an explicit `0` allocates
 * nothing, so neither is an error. Pure.
 */
export function customAllocationsFrom(
  entries: Iterable<[number, string]>,
): {
  allocations: Array<{ clusterId: number; weightBps: number }>;
  invalid: number[];
} {
  const allocations: Array<{ clusterId: number; weightBps: number }> = [];
  const invalid: number[] = [];
  for (const [clusterId, raw] of entries) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const weightBps = parseExactNonNegativeInteger(raw);
    if (weightBps === null) {
      invalid.push(clusterId);
      continue;
    }
    if (weightBps > 0) allocations.push({ clusterId, weightBps });
  }
  return { allocations, invalid };
}

/** The typed autovote weight budget in basis points, or null when the field
 *  cannot be read or falls outside 1–10000.
 *
 *  Out of range is a refusal, not a clamp: silently lowering a typed 50000 to
 *  100% would build a plan against a budget the user never set. Pure. */
export function autovoteBudgetBps(raw: string | null | undefined): number | null {
  const value = parseExactNonNegativeInteger(raw);
  if (value === null || value <= 0 || value > MAX_WEIGHT_BPS) return null;
  return value;
}

/**
 * What the typed weight actually means, echoed live beneath the field.
 *
 * The forms take integer basis points while every cap beside them is stated in
 * percent, so a user who reads "50%" and types 50 signs 0.50%. Renaming the
 * field is necessary but not sufficient — someone who has learned to type 50
 * keeps typing it. This is the control that makes the label checkable, because
 * it shows the meaning of the number while it is still being typed.
 *
 * NEVER FABRICATES. The percentage is pure arithmetic on the typed value and is
 * always available; the credited amount needs the balance, and when that cannot
 * be read the clause is omitted rather than shown as zero (A6 — unknown is not
 * zero, and the distinction is protected in the arithmetic precisely so it can
 * survive into the display).
 *
 * NEVER CLAMPS (A5). A typed 50000 echoes as 500.00%, because hiding the mistake
 * behind a tidy 100.00% would defeat the one job this line has. The refusal
 * explains; the echo reports.
 *
 * Returns null when nothing readable was typed — there is nothing to say yet.
 * Pure.
 */
export function weightEchoLine(
  raw: string | null | undefined,
  balanceLythoshi: string | null | undefined,
): string | null {
  const bps = parseExactNonNegativeInteger(raw);
  if (bps === null || bps <= 0) return null;
  const head = `${bps} bps = ${(bps / 100).toFixed(2)}% of balance`;
  const credited = effectiveWeightWholeLyth(balanceLythoshi, bps);
  // Unknown balance → no credit clause at all. A zero here would read as a fact.
  return credited === null ? head : `${head} · credits ${credited} LYTH`;
}

/** Whether the action may be attempted, and if not, what to do about it. */
export type WeightActionGate = { ok: true } | { ok: false; label: string };

/**
 * Should the action button be disabled, and what should it say?
 *
 * ONLY DEFINITE CONDITIONS GATE. Disabling because a cap is definitively
 * exceeded is honest — pressing could only fail. Disabling because a READ DID
 * NOT RESOLVE would be a false block, the same failure this project's
 * fail-direction ledger has rejected at every previous guard, arriving through a
 * new door. So:
 *
 *   - an unreadable balance does NOT gate: the inert test cannot run, and a
 *     guard that cannot evaluate its condition must not disable the action;
 *   - `capViolated` must only ever be passed `true` when the delegation read
 *     actually resolved. Absent or false means unknown-or-fine, and both leave
 *     the button enabled for the review handler — which re-reads fresh state —
 *     to decide, where a refusal comes with an explanation.
 *
 * Labels name the remedy rather than the refusal, so a disabled control still
 * tells the user what to do. Ordered most-fundamental first: an unreadable field
 * is not a cap problem, whatever the cap says. Pure — enforces nothing, and every
 * condition here is one the review handlers already evaluate.
 */
export function weightActionGate(args: {
  raw: string | null | undefined;
  /** 10000 for a delegate, the source weight for a redelegate. */
  maxBps: number;
  balanceLythoshi: string | null | undefined;
  /** A cap breach established against a RESOLVED read. Never pass true on doubt. */
  capViolated?: boolean;
}): WeightActionGate {
  const bps = parseExactNonNegativeInteger(args.raw);
  if (bps === null || bps <= 0) return { ok: false, label: "Enter a weight" };
  if (bps > args.maxBps) return { ok: false, label: "Reduce the weight" };
  // Definite by construction: false whenever the balance could not be read.
  if (isInertDelegation(args.balanceLythoshi, bps)) {
    return { ok: false, label: "Too small to credit" };
  }
  if (args.capViolated === true) return { ok: false, label: "Reduce to the cap" };
  return { ok: true };
}

/** The outcome of resolving a typed redelegate destination. */
export type RedelegateDestinationVerdict =
  | { ok: true; clusterId: number }
  | { ok: false; message: string };

/** Copy for a destination that names no cluster the wallet knows about. */
export function unknownDestinationMessage(clusterId: number): string {
  return `No cluster #${clusterId} in the directory — pick one of the listed clusters.`;
}

/** Copy for a destination that exists but is not in the active set. */
export function ineligibleDestinationMessage(clusterId: number): string {
  return `Cluster #${clusterId} is not in the active set — choose an active cluster.`;
}

/** Copy for the case where there is no cluster set to check a destination against. */
export const DESTINATION_UNVERIFIABLE_MESSAGE =
  "Cluster directory unavailable — refresh before redelegating so the destination can be checked.";

/**
 * Resolve a typed redelegate destination to a cluster the wallet has actually
 * seen, and that is eligible to receive weight.
 *
 * WHY THIS FAILS CLOSED, ALONE IN THIS FLOW. Every other delegation refusal
 * guards against a chain rejection: a false pass there costs nothing, because
 * the transaction carries value = 0 and is refused at admission before it can
 * move anything. That asymmetry is why the rest of the flow prefers to proceed
 * on a doubtful read rather than deny a legitimate action.
 *
 * A destination is different in kind. An id that happens to name some OTHER real
 * cluster produces a perfectly valid transaction, which the chain ACCEPTS, that
 * moves real voting weight somewhere the user never named. No admission refusal
 * catches it and no later step can undo it. So when the wallet cannot establish
 * membership it refuses, and says why — the cost is one refresh, against an
 * unrecoverable misdirection.
 *
 * ELIGIBILITY FOLLOWS THE DIRECTORY. A cluster outside the active set is
 * refused, which is the same answer the directory already gives on the other
 * path: it badges the row INACTIVE and disables its action. A flag that is not
 * strictly `true` is treated as ineligible, exactly as `!active` does there, so
 * the two surfaces cannot disagree about which clusters may receive weight.
 *
 * Pure — no chain access, no DOM.
 */
export function resolveRedelegateDestination(args: {
  raw: string | null | undefined;
  sourceClusterId: number;
  /** The known cluster set. Empty means the wallet has nothing to verify
   *  against — it never means "no cluster qualifies". */
  clusters: ReadonlyArray<{ clusterId: number; active: boolean }>;
}): RedelegateDestinationVerdict {
  const clusterId = parseExactNonNegativeInteger(args.raw);
  if (clusterId === null) {
    return { ok: false, message: "Enter a valid destination cluster id." };
  }
  if (clusterId === args.sourceClusterId) {
    return { ok: false, message: "Destination must differ from the source cluster." };
  }
  const eligible = clusterEligibility(clusterId, args.clusters);
  if (!eligible.ok) return eligible;
  return { ok: true, clusterId };
}

/**
 * May this cluster receive delegation weight?
 *
 * THE single eligibility rule. Both the typed redelegate destination and every
 * allocation in a custom autovote batch resolve through it, so a cluster the
 * wallet refuses to redelegate to is also one it refuses to include in a plan.
 * Two copies of this decision would eventually disagree, and the disagreement
 * would be invisible until a signature.
 *
 * Fails closed on an empty set — see {@link resolveRedelegateDestination} for
 * why this one decision does, when the rest of the flow does not. Pure.
 */
export function clusterEligibility(
  clusterId: number,
  clusters: ReadonlyArray<{ clusterId: number; active: boolean }>,
): { ok: true } | { ok: false; message: string } {
  // No set to check against — refuse rather than act on an unverified cluster.
  if (clusters.length === 0) {
    return { ok: false, message: DESTINATION_UNVERIFIABLE_MESSAGE };
  }
  const match = clusters.find((c) => c.clusterId === clusterId);
  if (match === undefined) {
    return { ok: false, message: unknownDestinationMessage(clusterId) };
  }
  // Not strictly `true` is ineligible, matching the directory's own `!active`.
  if (match.active !== true) {
    return { ok: false, message: ineligibleDestinationMessage(clusterId) };
  }
  return { ok: true };
}

/** The clusters that may be offered a weight field, in directory order.
 *
 *  Uses the same `active === true` test {@link clusterEligibility} applies, so
 *  the panel cannot offer an input for a cluster review would then refuse — an
 *  input a user can fill and then be turned away from is worse than one that was
 *  never there. An empty set offers nothing, which is the honest answer when
 *  there is nothing to verify against. Pure. */
export function eligibleClusters<T extends { clusterId: number; active: boolean }>(
  clusters: ReadonlyArray<T>,
): T[] {
  return clusters.filter((c) => c.active === true);
}

/**
 * Eligibility for a whole custom autovote plan, checked BEFORE the cap
 * pre-flight signs anything.
 *
 * The custom inputs render from the unfiltered directory and the batch
 * pre-flight reasons only about caps and row count, so without this an
 * allocation could name a cluster that may not receive weight and the plan would
 * reach the encoder. Blocks on the FIRST offending allocation and names it, the
 * same shape the cap pre-flight uses. Pure.
 */
export function allocationsEligibilityVerdict(args: {
  allocations: ReadonlyArray<{ clusterId: number }>;
  clusters: ReadonlyArray<{ clusterId: number; active: boolean }>;
}): { ok: true } | { ok: false; message: string } {
  // An empty plan is the caller's own refusal to make, not an eligibility fault.
  if (args.allocations.length === 0) return { ok: true };
  for (const allocation of args.allocations) {
    const eligible = clusterEligibility(allocation.clusterId, args.clusters);
    if (!eligible.ok) return eligible;
  }
  return { ok: true };
}
