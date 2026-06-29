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
