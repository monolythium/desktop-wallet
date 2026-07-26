// The three states a cluster-directory read can be in, kept distinguishable.
//
// The response that started this carried its own contradiction:
//
//   { "clusters": [], "limit": 20, "page": 1, "totalClusters": 4 }
//
// Zero rows, a total of four. The wallet had the evidence in hand and did not
// look at it, so a query defect rendered as an honest absence — under copy
// inviting the user to pick a cluster from the list that was not there.
//
// A page and a total can disagree legitimately (page 0 of 30 clusters at
// limit 25 shows 25), so the invariant is deliberately narrow: an EMPTY page
// against a POSITIVE total. Truncation is not a contradiction.

import { describe, expect, it } from "vitest";
import {
  DIRECTORY_INCONSISTENT_MESSAGE,
  readClusterDirectoryPage,
} from "../cluster-directory";

function row(clusterId: number) {
  return {
    clusterId,
    size: 10,
    threshold: 7,
    aggregateHealth: "ok",
    regionDiversity: null,
    active: true,
  };
}

function page(clusters: ReturnType<typeof row>[], totalClusters: number, limit = 25) {
  return { page: 0, limit, totalClusters, clusters };
}

describe("readClusterDirectoryPage — the three states stay distinct", () => {
  it("state 1: the read failed — no knowledge of the directory", () => {
    const reading = readClusterDirectoryPage(null, "operator refused the request");
    expect(reading.kind).toBe("unavailable");
    if (reading.kind !== "unavailable") throw new Error("narrowing");
    expect(reading.error).toBe("operator refused the request");
  });

  it("state 2: the chain genuinely has no clusters — a true absence", () => {
    const reading = readClusterDirectoryPage(page([], 0), null);
    expect(reading.kind).toBe("none");
  });

  it("state 3: a positive total with an empty page is a query error", () => {
    // The exact live response the wallet used to render as "no clusters".
    const reading = readClusterDirectoryPage(page([], 4, 20), null);
    expect(reading.kind).toBe("inconsistent");
    if (reading.kind !== "inconsistent") throw new Error("narrowing");
    expect(reading.totalClusters).toBe(4);
  });

  it("distinguishes state 2 from state 3 — the total is the only difference", () => {
    expect(readClusterDirectoryPage(page([], 0), null).kind).toBe("none");
    expect(readClusterDirectoryPage(page([], 1), null).kind).toBe("inconsistent");
  });

  it("reads a populated page as clusters", () => {
    const reading = readClusterDirectoryPage(page([row(0), row(1)], 2), null);
    expect(reading.kind).toBe("clusters");
    if (reading.kind !== "clusters") throw new Error("narrowing");
    expect(reading.rows.map((r) => r.clusterId)).toEqual([0, 1]);
  });

  it("does NOT fire on legitimate truncation — a full page below the total", () => {
    // 25 rows of 30 is what pagination looks like, not a contradiction.
    const rows = Array.from({ length: 25 }, (_, i) => row(i));
    const reading = readClusterDirectoryPage(page(rows, 30), null);
    expect(reading.kind).toBe("clusters");
  });

  it("does NOT fire on a single row against a larger total", () => {
    const reading = readClusterDirectoryPage(page([row(0)], 4), null);
    expect(reading.kind).toBe("clusters");
  });

  it("treats a malformed total as a query error rather than an absence", () => {
    // A non-finite total is not evidence the chain has none, and claiming an
    // absence on it would be the same false fact by another route.
    const reading = readClusterDirectoryPage(
      { page: 0, limit: 25, totalClusters: Number.NaN, clusters: [] } as never,
      null,
    );
    expect(reading.kind).toBe("inconsistent");
  });

  it("states the contradiction without diagnosing a cause or promising a retry", () => {
    const m = DIRECTORY_INCONSISTENT_MESSAGE.toLowerCase();
    for (const forbidden of ["retry", "try again", "refresh", "because", "offline"]) {
      expect(m).not.toContain(forbidden);
    }
  });
});
