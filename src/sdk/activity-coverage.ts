// Indexer coverage for an address — turns an empty activity feed into a reason
// the user can act on (nothing indexed yet vs. the indexer being off vs. the
// history window having been pruned) rather than one generic "no activity".
//
// Pure: the RPC probe (`lyth_addressActivityKind`) lives in `live.ts`; this
// module owns only the closed kind set and the empty-feed copy, so both are
// unit-testable without a chain.

/** Normalised indexer coverage kind. Tracks the node's coverage kinds and
 *  collapses any forward-compatible node-supplied string to "unknown", so render
 *  code never has to handle an arbitrary value. */
export type ActivityCoverageKind =
  | "found"
  | "not_found"
  | "indexer_disabled"
  | "pruned"
  | "private"
  | "unknown";

/** Normalise an arbitrary node `kind` string into the closed set above. */
export function normaliseActivityCoverageKind(raw: string): ActivityCoverageKind {
  switch (raw) {
    case "found":
    case "not_found":
    case "indexer_disabled":
    case "pruned":
    case "private":
      return raw;
    default:
      return "unknown";
  }
}

/** Context-aware copy for an empty (unfiltered) feed. The reason the feed is
 *  empty drives the wording. Privacy is not a wallet surface here, so "private"
 *  reads as a neutral "unavailable" rather than introducing a privacy state, and
 *  "found"/"not_found" both fall to the plain "no activity yet" (a "found" kind
 *  with zero rows is a transient mismatch, not an error to surface). */
export function emptyActivityCopy(kind: ActivityCoverageKind): {
  title: string;
  body: string;
} {
  switch (kind) {
    case "indexer_disabled":
      return {
        title: "Activity history is unavailable",
        body: "This network's indexer is turned off, so past transactions can't be listed here. Your balance and new transfers are unaffected.",
      };
    case "pruned":
      return {
        title: "Older activity has been pruned",
        body: "The indexer no longer retains this address's older history. Only recent transactions can be shown.",
      };
    case "private":
    case "unknown":
      return {
        title: "Activity history is unavailable",
        body: "The indexer couldn't return history for this address right now. Your balance and new transfers are unaffected.",
      };
    case "found":
    case "not_found":
    default:
      return {
        title: "No activity yet",
        body: "The indexer has no transactions for this address. Sent and received transfers appear here once they confirm.",
      };
  }
}

/**
 * The label a feed owes the user when its rows came from the saved cache
 * because the live read did not land.
 *
 * PROVENANCE — why these rows may be shown at all. Every live read the feed
 * makes goes through the trust-gated provider, which refuses while the active
 * operator is untrusted, and the cache is written only after such a read
 * succeeds. So a degraded chain yields a FAILED read rather than rows from an
 * unverifiable operator, and everything the cache holds was verified when it was
 * fetched. Hiding it because the network is unreachable now would erase the
 * user's own verified past to no honest end.
 *
 * WHAT IT DOES NOT SAY. Not why the chain is degraded. The chain-health banner
 * already names untrusted / re-genesised / quarantined / offline and what to do
 * about each; a second telling here would be a second vocabulary for one
 * condition, and the two would drift. This states only what the ROWS are.
 *
 * The consequence clause is the load-bearing half: "saved" alone is a label a
 * user has no reason to act on, whereas "newer transactions may be missing"
 * says what it costs them.
 */
export const SAVED_HISTORY_NOTICE =
  "Showing saved history. The wallet couldn't refresh this list from the network just now, so newer transactions may be missing.";

/**
 * The pruned empty state's optional third line.
 *
 * Renders ONLY for the `pruned` kind with a known retention floor. A null value
 * renders nothing — an honest absence, never a fabricated block number, which
 * on this surface would read as a specific claim about what the indexer still
 * holds. Pure.
 */
export function prunedRetentionLine(
  kind: ActivityCoverageKind,
  earliestRetained: string | null,
): string | null {
  if (kind !== "pruned") return null;
  if (earliestRetained === null || earliestRetained.trim() === "") return null;
  return `Showing activity from block ${earliestRetained.trim()} onward.`;
}

/**
 * Tolerant coercion of the probe envelope's retention floor to a decimal string.
 * String / number / bigint are accepted; absent, malformed, or a null retention
 * yields null — the line is then simply omitted. Pure.
 */
export function earliestRetainedFrom(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const retention = (raw as Record<string, unknown>).retention;
  if (!retention || typeof retention !== "object") return null;
  const value = (retention as Record<string, unknown>).earliestRetained;
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string") {
    const t = value.trim();
    return /^[0-9]+$/.test(t) ? t : null;
  }
  return null;
}
