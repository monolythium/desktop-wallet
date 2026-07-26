// Reading a cluster-directory page honestly — pure, React-free, unit-pinnable.
//
// A directory read lands in one of three states, and two of them used to render
// identically:
//
//   1. THE READ FAILED       — no knowledge of the directory at all.
//   2. THE CHAIN HAS NONE    — a true, honest absence.
//   3. WE ASKED WRONG        — the read succeeded and contradicted itself.
//
// State 3 is not an empty state. The response that prompted this module was
//
//     { "clusters": [], "limit": 20, "page": 1, "totalClusters": 4 }
//
// — zero rows against a total of four, because the caller asked for page 1 of a
// 0-indexed directory. The wallet had that contradiction in hand and rendered
// it as "no clusters", which is a faithful presentation of a false fact, under
// copy inviting the user to pick a cluster from the list that was not there.
//
// WHY THE INVARIANT IS NARROW. A page and a total are SUPPOSED to disagree
// whenever the directory is longer than one page: page 0 of thirty clusters at
// limit 25 legitimately carries 25 rows against a total of 30. Truncation is
// not a contradiction. Only an EMPTY page against a POSITIVE total is, because
// no page size and no page index can make "some clusters exist" and "this page
// has none" both true of a first page the caller believes it asked for.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not diagnose the cause and does not
// promise a retry. The wallet knows the response was inconsistent; it does not
// know whether the page index was wrong, the operator is serving a stale
// projection, or something else. Naming a cause it cannot observe would be the
// same class of error one level up.

import type { ClusterDirectoryEntryResponse } from "@monolythium/core-sdk";

/** A directory page as the transport returns it. Structurally the SDK's
 *  `ClusterDirectoryPageResponse`; declared locally so this module stays pure
 *  and testable without the client seam. */
export interface ClusterDirectoryPageLike {
  page: number;
  limit: number;
  totalClusters: number;
  clusters: ClusterDirectoryEntryResponse[];
}

/** What the wallet actually knows about the directory after one read. */
export type ClusterDirectoryReading =
  /** The read failed. No knowledge — never render this as an absence. */
  | { kind: "unavailable"; error: string }
  /** The directory is known and non-empty. */
  | { kind: "clusters"; rows: ClusterDirectoryEntryResponse[] }
  /** The chain genuinely has no clusters. A true absence. */
  | { kind: "none" }
  /** The read succeeded and contradicted itself — a query error, not an
   *  absence. `totalClusters` is the total claimed, or null when unreadable. */
  | { kind: "inconsistent"; totalClusters: number | null };

/** Shown for {@link ClusterDirectoryReading} `"inconsistent"`. States the
 *  contradiction and stops: no cause, no retry affordance, no invitation to
 *  act on a directory the wallet does not have. */
export const DIRECTORY_INCONSISTENT_MESSAGE =
  "The chain reports clusters but served none of them, so the cluster list cannot be shown.";

/** Fallback when a read failed without giving a reason. */
const DIRECTORY_UNAVAILABLE_FALLBACK = "directory unavailable";

/** Classify one directory read.
 *
 *  `page` is null when the read failed (the caller's catch); `error` is that
 *  failure's message. A non-null `page` is a response the transport accepted,
 *  which is exactly why its self-consistency has to be checked here. Pure. */
export function readClusterDirectoryPage(
  page: ClusterDirectoryPageLike | null,
  error: string | null,
): ClusterDirectoryReading {
  if (page === null) {
    return { kind: "unavailable", error: error ?? DIRECTORY_UNAVAILABLE_FALLBACK };
  }

  const rows = Array.isArray(page.clusters) ? page.clusters : [];
  // Any row at all means the directory answered. Whether it answered in full is
  // a paging question, not a truthfulness question.
  if (rows.length > 0) return { kind: "clusters", rows };

  const total = page.totalClusters;
  // An unreadable total is not evidence of an absence. Claiming one on it would
  // be the same false fact by another route, so it fails to the query error.
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    return { kind: "inconsistent", totalClusters: null };
  }
  if (total === 0) return { kind: "none" };
  return { kind: "inconsistent", totalClusters: total };
}
