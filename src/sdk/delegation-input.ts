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
