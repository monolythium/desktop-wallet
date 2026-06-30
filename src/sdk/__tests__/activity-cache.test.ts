import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ROLLING_WINDOW,
  activityCacheKey,
  applyCapturedClusterNames,
  compareConfirmedNewestFirst,
  confirmedRowKey,
  fromCachedRow,
  mergeConfirmedRows,
  parseConfirmedCacheEntry,
  toCachedRow,
  validateCachedRow,
} from "../activity-cache";
import type { LiveAddressActivityRow } from "../live";
import type { PendingTx } from "../pending-tx";

function row(over: Partial<LiveAddressActivityRow> = {}): LiveAddressActivityRow {
  return {
    blockHeight: 100n,
    txIndex: 0,
    logIndex: 0,
    kind: "transfer",
    direction: "in",
    counterparty: "mono1from",
    tokenId: null,
    amount: "2",
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: 1_700_000_000n,
    txHash: "0xabc",
    clusterName: null,
    ...over,
  };
}

describe("activityCacheKey", () => {
  it("is per (address, chain) and versioned", () => {
    expect(activityCacheKey("mono1abc", "0x10f2c")).toBe("mono.activity.mono1abc.0x10f2c.v1");
  });
});

describe("toCachedRow / fromCachedRow", () => {
  it("round-trips, converting bigint block fields to number and back", () => {
    const r = row({ blockHeight: 60_774n, blockTimestampSeconds: 1_700_000_123n });
    const cached = toCachedRow(r);
    expect(typeof cached.blockHeight).toBe("number");
    expect(cached.blockHeight).toBe(60_774);
    expect(typeof cached.blockTimestampSeconds).toBe("number");
    expect(cached.blockTimestampSeconds).toBe(1_700_000_123);
    const back = fromCachedRow(cached);
    expect(back.blockHeight).toBe(60_774n);
    expect(back.blockTimestampSeconds).toBe(1_700_000_123n);
    expect(back).toEqual(r);
  });

  it("preserves a null timestamp through the round-trip", () => {
    const cached = toCachedRow(row({ blockTimestampSeconds: null }));
    expect(cached.blockTimestampSeconds).toBeNull();
    expect(fromCachedRow(cached).blockTimestampSeconds).toBeNull();
  });
});

describe("confirmedRowKey", () => {
  it("is stable for the same row and distinct across kind/cluster/direction", () => {
    const a = row({ blockHeight: 5n, txIndex: 0, logIndex: 0, kind: "delegation", cluster: 1 });
    const b = row({ blockHeight: 5n, txIndex: 0, logIndex: 0, kind: "delegation", cluster: 2 });
    const c = row({ blockHeight: 5n, txIndex: 0, logIndex: 0, kind: "transfer", direction: "out" });
    expect(confirmedRowKey(a)).toBe(confirmedRowKey(row({ blockHeight: 5n, kind: "delegation", cluster: 1 })));
    expect(confirmedRowKey(a)).not.toBe(confirmedRowKey(b)); // same anchor, different cluster
    expect(confirmedRowKey(a)).not.toBe(confirmedRowKey(c)); // different kind/direction
  });
});

describe("compareConfirmedNewestFirst", () => {
  it("orders by block desc, then txIndex desc, then logIndex desc", () => {
    const rows = [
      row({ blockHeight: 5n, txIndex: 0, logIndex: 0 }),
      row({ blockHeight: 9n, txIndex: 0, logIndex: 0 }),
      row({ blockHeight: 9n, txIndex: 2, logIndex: 0 }),
      row({ blockHeight: 9n, txIndex: 2, logIndex: 1 }),
    ];
    const sorted = [...rows].sort(compareConfirmedNewestFirst);
    expect(sorted.map((r) => [Number(r.blockHeight), r.txIndex, r.logIndex])).toEqual([
      [9, 2, 1],
      [9, 2, 0],
      [9, 0, 0],
      [5, 0, 0],
    ]);
  });
});

describe("mergeConfirmedRows", () => {
  it("lets the live copy win for an overlapping key and retains older cached rows", () => {
    const prevA = row({ blockHeight: 5n, amount: "OLD", clusterName: "stale" });
    const prevOld = row({ blockHeight: 1n, txIndex: 0, logIndex: 0, amount: "1" });
    const liveA = row({ blockHeight: 5n, amount: "NEW" });
    const merged = mergeConfirmedRows([prevA, prevOld], [liveA]);
    // Same key → live wins (NEW), and the older cached-only row is kept.
    const at5 = merged.find((r) => r.blockHeight === 5n);
    expect(at5?.amount).toBe("NEW");
    expect(merged.some((r) => r.blockHeight === 1n)).toBe(true);
    // Newest-first.
    expect(merged.map((r) => Number(r.blockHeight))).toEqual([5, 1]);
  });

  it("caps to the rolling window, dropping the oldest", () => {
    const live = Array.from({ length: ACTIVITY_ROLLING_WINDOW + 10 }, (_, i) =>
      row({ blockHeight: BigInt(i + 1), txIndex: 0, logIndex: 0, kind: `k${i}` }),
    );
    const merged = mergeConfirmedRows([], live);
    expect(merged.length).toBe(ACTIVITY_ROLLING_WINDOW);
    // Newest kept (highest block), oldest dropped.
    expect(Number(merged[0]!.blockHeight)).toBe(ACTIVITY_ROLLING_WINDOW + 10);
    expect(merged.some((r) => r.blockHeight === 1n)).toBe(false);
  });
});

describe("validateCachedRow", () => {
  it("accepts a well-formed row and defaults nullable fields", () => {
    const v = validateCachedRow({ blockHeight: 5, txIndex: 0, logIndex: 0, kind: "transfer" });
    expect(v).not.toBeNull();
    expect(v!.counterparty).toBeNull();
    expect(v!.cluster).toBeNull();
  });

  it("rejects rows missing required anchor fields", () => {
    expect(validateCachedRow({ txIndex: 0, logIndex: 0, kind: "x" })).toBeNull(); // no blockHeight
    expect(validateCachedRow({ blockHeight: 5, txIndex: 0, logIndex: 0 })).toBeNull(); // no kind
    expect(validateCachedRow(null)).toBeNull();
    expect(validateCachedRow("nope")).toBeNull();
  });
});

function pend(over: Partial<PendingTx> = {}): PendingTx {
  return {
    txHash: "0xp",
    chainIdHex: "0x10f2c",
    addressLower: "mono1self",
    opKind: "delegate",
    amountDecimal: "0",
    counterparty: "mono1module",
    submittedAt: 1,
    ...over,
  };
}

describe("applyCapturedClusterNames", () => {
  it("fills a missing name from a prior cached row at the same slot + cluster", () => {
    const prev = [row({ blockHeight: 5n, txIndex: 0, cluster: 7, clusterName: "atlas" })];
    const live = [row({ blockHeight: 5n, txIndex: 0, cluster: 7, clusterName: null })];
    expect(applyCapturedClusterNames(live, prev, [])[0]!.clusterName).toBe("atlas");
  });

  it("fills from a bridged pending row that captured the name at submit", () => {
    const live = [row({ blockHeight: 9n, txIndex: 2, cluster: 3, clusterName: null })];
    const pending = [
      pend({ clusterId: 3, clusterName: "nova", confirmedBlockHeight: 9, confirmedTxIndex: 2 }),
    ];
    expect(applyCapturedClusterNames(live, [], pending)[0]!.clusterName).toBe("nova");
  });

  it("prefers a prior cached name over a pending one", () => {
    const live = [row({ blockHeight: 5n, txIndex: 0, cluster: 7, clusterName: null })];
    const prev = [row({ blockHeight: 5n, txIndex: 0, cluster: 7, clusterName: "fromCache" })];
    const pending = [
      pend({ clusterId: 7, clusterName: "fromPending", confirmedBlockHeight: 5, confirmedTxIndex: 0 }),
    ];
    expect(applyCapturedClusterNames(live, prev, pending)[0]!.clusterName).toBe("fromCache");
  });

  it("never overwrites a name the row already has (no flicker to a stale value)", () => {
    const live = [row({ blockHeight: 5n, txIndex: 0, cluster: 7, clusterName: "real" })];
    const prev = [row({ blockHeight: 5n, txIndex: 0, cluster: 7, clusterName: "stale" })];
    expect(applyCapturedClusterNames(live, prev, [])[0]!.clusterName).toBe("real");
  });

  it("leaves non-cluster rows and unmatched rows untouched", () => {
    const live = [
      row({ blockHeight: 5n, txIndex: 0, cluster: null, clusterName: null }),
      row({ blockHeight: 6n, txIndex: 0, cluster: 9, clusterName: null }),
    ];
    const out = applyCapturedClusterNames(live, [], []);
    expect(out[0]!.clusterName).toBeNull();
    expect(out[1]!.clusterName).toBeNull();
  });

  it("does not match a pending row at a different cluster on the same slot", () => {
    const live = [row({ blockHeight: 9n, txIndex: 0, cluster: 3, clusterName: null })];
    const pending = [
      pend({ clusterId: 4, clusterName: "other", confirmedBlockHeight: 9, confirmedTxIndex: 0 }),
    ];
    expect(applyCapturedClusterNames(live, [], pending)[0]!.clusterName).toBeNull();
  });
});

describe("parseConfirmedCacheEntry", () => {
  it("round-trips a valid entry and drops malformed rows", () => {
    const entry = parseConfirmedCacheEntry({
      schemaVersion: 0,
      lastFetchedAtMs: 123,
      confirmed: [
        toCachedRow(row({ blockHeight: 5n })),
        { blockHeight: "bad" }, // malformed → dropped
      ],
    });
    expect(entry).not.toBeNull();
    expect(entry!.confirmed).toHaveLength(1);
    expect(entry!.lastFetchedAtMs).toBe(123);
  });

  it("rejects a wrong schema or non-object, and defaults a missing timestamp", () => {
    expect(parseConfirmedCacheEntry({ schemaVersion: 1, confirmed: [] })).toBeNull();
    expect(parseConfirmedCacheEntry(null)).toBeNull();
    expect(parseConfirmedCacheEntry({ schemaVersion: 0 })).toBeNull(); // confirmed not array
    const noTs = parseConfirmedCacheEntry({ schemaVersion: 0, confirmed: [] });
    expect(noTs!.lastFetchedAtMs).toBe(0);
  });
});
