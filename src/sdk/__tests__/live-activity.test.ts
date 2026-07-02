import { describe, expect, it } from "vitest";
import {
  activityEntriesFrom,
  toActivityBaseRow,
  toBlockBigInt,
} from "../live";
import { mergeConfirmedRows } from "../activity-cache";

describe("activityEntriesFrom — tolerant of the node's response shape", () => {
  it("reads the activity array from the node's paginated envelope", () => {
    // The exact shape the live node returns (regression: this used to reach a
    // bare `.map` and throw "entries.map is not a function").
    const envelope = {
      activity: [{ blockHeight: 5 }, { blockHeight: 6 }],
      address: "mono1abc",
      limit: 30,
      nextCursor: null,
      schemaVersion: 1,
    };
    expect(activityEntriesFrom(envelope)).toHaveLength(2);
  });

  it("yields [] for an EMPTY envelope (the new-address / nothing-indexed case)", () => {
    expect(activityEntriesFrom({ activity: [], nextCursor: null })).toEqual([]);
  });

  it("also accepts a bare array and an {entries} envelope", () => {
    expect(activityEntriesFrom([{}, {}])).toHaveLength(2);
    expect(activityEntriesFrom({ entries: [{}] })).toHaveLength(1);
  });

  it("yields [] (never a non-array) for absent / unrecognized shapes", () => {
    expect(activityEntriesFrom(null)).toEqual([]);
    expect(activityEntriesFrom(undefined)).toEqual([]);
    expect(activityEntriesFrom({ foo: 1 })).toEqual([]);
    expect(activityEntriesFrom(42)).toEqual([]);
    expect(activityEntriesFrom("nope")).toEqual([]);
    expect(activityEntriesFrom({ activity: "not-an-array" })).toEqual([]);
  });
});

describe("toBlockBigInt — coerce node numerics", () => {
  it("parses number, decimal string, 0x-hex string, and bigint", () => {
    expect(toBlockBigInt(60_774)).toBe(60_774n);
    expect(toBlockBigInt("60774")).toBe(60_774n);
    expect(toBlockBigInt("0xed26")).toBe(60_710n);
    expect(toBlockBigInt(42n)).toBe(42n);
  });

  it("returns null for unparseable / empty values", () => {
    expect(toBlockBigInt(null)).toBeNull();
    expect(toBlockBigInt(undefined)).toBeNull();
    expect(toBlockBigInt("")).toBeNull();
    expect(toBlockBigInt("not-a-number")).toBeNull();
    expect(toBlockBigInt({})).toBeNull();
  });
});

describe("toActivityBaseRow — coerce one raw node entry", () => {
  it("coerces a raw entry and leaves enrichment fields null", () => {
    const r = toActivityBaseRow({
      blockHeight: "60774",
      txIndex: 1,
      logIndex: 0,
      kind: "transfer",
      direction: "in",
      counterparty: "mono1from",
      amount: "2",
      cluster: null,
    });
    expect(r).not.toBeNull();
    expect(r!.blockHeight).toBe(60_774n);
    expect(r!.txIndex).toBe(1);
    expect(r!.kind).toBe("transfer");
    expect(r!.blockTimestampSeconds).toBeNull();
    expect(r!.txHash).toBeNull();
    expect(r!.clusterName).toBeNull();
  });

  it("drops an entry with no usable block height (no throw)", () => {
    expect(toActivityBaseRow({ kind: "transfer" })).toBeNull();
    expect(toActivityBaseRow(null)).toBeNull();
    expect(toActivityBaseRow("nope")).toBeNull();
  });
});

describe("feed builds from empty inputs without throwing (the regression)", () => {
  it("an empty live envelope maps to [] and merges with an empty cache to []", () => {
    // Reproduces the failing path: the envelope's array → base rows → merge.
    const liveEntries = activityEntriesFrom({ activity: [], nextCursor: null });
    const liveRows = liveEntries
      .map(toActivityBaseRow)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    expect(liveRows).toEqual([]);
    // Absent cache (null → []) + empty live → empty feed, no throw.
    expect(mergeConfirmedRows([], liveRows)).toEqual([]);
  });

  it("a populated envelope + cached rows still merges (live wins, newest-first)", () => {
    const liveRows = activityEntriesFrom({
      activity: [
        { blockHeight: 9, txIndex: 0, logIndex: 0, kind: "transfer", direction: "in", amount: "NEW" },
      ],
    })
      .map(toActivityBaseRow)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const cached = activityEntriesFrom([
      { blockHeight: 9, txIndex: 0, logIndex: 0, kind: "transfer", direction: "in", amount: "OLD" },
      { blockHeight: 4, txIndex: 0, logIndex: 0, kind: "transfer", direction: "in", amount: "1" },
    ])
      .map(toActivityBaseRow)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const merged = mergeConfirmedRows(cached, liveRows);
    expect(merged.map((r) => Number(r.blockHeight))).toEqual([9, 4]);
    expect(merged.find((r) => r.blockHeight === 9n)?.amount).toBe("NEW");
  });
});
