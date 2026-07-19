// The pruned empty state's retention line.
//
// A block number on this surface is a specific claim about what the indexer
// still holds, so an unknown floor renders nothing rather than a guess.

import { describe, expect, it } from "vitest";
import { earliestRetainedFrom, prunedRetentionLine } from "../activity-coverage";

describe("prunedRetentionLine", () => {
  it("renders the verbatim line for pruned with a known floor", () => {
    expect(prunedRetentionLine("pruned", "1234567")).toBe(
      "Showing activity from block 1234567 onward.",
    );
  });

  it("renders NOTHING for pruned with an unknown floor", () => {
    expect(prunedRetentionLine("pruned", null)).toBeNull();
    expect(prunedRetentionLine("pruned", "   ")).toBeNull();
  });

  it("renders nothing for every other kind, even with a floor", () => {
    for (const kind of ["found", "not_found", "indexer_disabled", "private", "unknown"] as const) {
      expect(prunedRetentionLine(kind, "1234567")).toBeNull();
    }
  });
});

describe("earliestRetainedFrom — tolerant coercion", () => {
  const wrap = (v: unknown) => ({ kind: "pruned", retention: { earliestRetained: v } });

  it("accepts a decimal string", () => {
    expect(earliestRetainedFrom(wrap("1234567"))).toBe("1234567");
    expect(earliestRetainedFrom(wrap("  42  "))).toBe("42");
  });

  it("accepts an integer number", () => {
    expect(earliestRetainedFrom(wrap(1234567))).toBe("1234567");
    expect(earliestRetainedFrom(wrap(0))).toBe("0");
  });

  it("accepts a bigint", () => {
    expect(earliestRetainedFrom(wrap(1234567n))).toBe("1234567");
  });

  it("rejects a non-integer or negative number", () => {
    expect(earliestRetainedFrom(wrap(12.5))).toBeNull();
    expect(earliestRetainedFrom(wrap(-1))).toBeNull();
    expect(earliestRetainedFrom(wrap(Number.NaN))).toBeNull();
    expect(earliestRetainedFrom(wrap(Number.POSITIVE_INFINITY))).toBeNull();
  });

  it("rejects a non-numeric string", () => {
    expect(earliestRetainedFrom(wrap("0x1234"))).toBeNull();
    expect(earliestRetainedFrom(wrap("soon"))).toBeNull();
    expect(earliestRetainedFrom(wrap(""))).toBeNull();
  });

  it("returns null when retention is absent or null", () => {
    expect(earliestRetainedFrom({ kind: "pruned" })).toBeNull();
    expect(earliestRetainedFrom({ kind: "pruned", retention: null })).toBeNull();
    expect(earliestRetainedFrom({ kind: "pruned", retention: {} })).toBeNull();
  });

  it("never throws on junk", () => {
    for (const bad of [null, undefined, 7, "x", []]) {
      expect(earliestRetainedFrom(bad)).toBeNull();
    }
  });
});
