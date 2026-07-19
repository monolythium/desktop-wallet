// Activity pagination plumbing: the opaque cursor parser and the cache field.
//
// The cursor is round-tripped verbatim and never parsed — the wallet must not
// grow an opinion about a keyset encoding the node owns. Tolerance matters more
// than strictness here: an unrecognised cursor degrades to today's single-page
// behaviour rather than paging into nonsense.

import { describe, expect, it } from "vitest";
import { activityCursorFrom, ACTIVITY_PAGE_SIZE } from "../live";
import { parseConfirmedCacheEntry, type ConfirmedCacheEntry } from "../activity-cache";

const CURSOR = "0xabc123";

describe("activityCursorFrom", () => {
  it("reads the cursor from a full envelope", () => {
    expect(activityCursorFrom({ schemaVersion: 1, activity: [], nextCursor: CURSOR })).toBe(CURSOR);
  });

  it("returns null for an explicit null cursor (the last page)", () => {
    expect(activityCursorFrom({ activity: [], nextCursor: null })).toBeNull();
  });

  it("returns null when the field is absent", () => {
    expect(activityCursorFrom({ activity: [] })).toBeNull();
  });

  it("returns null for a bare-array legacy response", () => {
    expect(activityCursorFrom([])).toBeNull();
    expect(activityCursorFrom([{ blockHeight: 1 }])).toBeNull();
  });

  it("rejects a non-string cursor", () => {
    for (const bad of [7, true, {}, [], { toString: () => "0xabc" }]) {
      expect(activityCursorFrom({ nextCursor: bad })).toBeNull();
    }
  });

  it("rejects a cursor that is not 0x-prefixed", () => {
    expect(activityCursorFrom({ nextCursor: "abc123" })).toBeNull();
    expect(activityCursorFrom({ nextCursor: "" })).toBeNull();
    expect(activityCursorFrom({ nextCursor: "   " })).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(activityCursorFrom({ nextCursor: `  ${CURSOR}  ` })).toBe(CURSOR);
  });

  it("never throws on junk input", () => {
    for (const bad of [null, undefined, 7, "x", NaN]) {
      expect(activityCursorFrom(bad)).toBeNull();
    }
  });
});

describe("the page-size constant", () => {
  it("is 30 — one constant for the initial read and every older page", () => {
    expect(ACTIVITY_PAGE_SIZE).toBe(30);
  });
});

describe("ConfirmedCacheEntry.nextCursor — additive both ways (G5)", () => {
  const base = {
    schemaVersion: 0,
    confirmed: [],
    lastFetchedAtMs: 1_000,
  };

  it("a LEGACY entry (no cursor) parses, with the field absent", () => {
    const parsed = parseConfirmedCacheEntry(base);
    expect(parsed).not.toBeNull();
    expect(parsed!.nextCursor).toBeUndefined();
    expect(parsed!.confirmed).toEqual([]);
  });

  it("round-trips a real cursor", () => {
    const parsed = parseConfirmedCacheEntry({ ...base, nextCursor: CURSOR });
    expect(parsed!.nextCursor).toBe(CURSOR);
  });

  it("round-trips an explicit null (a known last page)", () => {
    const parsed = parseConfirmedCacheEntry({ ...base, nextCursor: null });
    expect(parsed!.nextCursor).toBeNull();
  });

  it("drops a MALFORMED cursor to absent rather than persisting it", () => {
    // A bad value must never be handed back to the node on the next page read.
    for (const bad of [7, true, "not-hex", "", {}]) {
      const parsed = parseConfirmedCacheEntry({ ...base, nextCursor: bad });
      expect(parsed!.nextCursor).toBeUndefined();
    }
  });

  it("a NEW entry read by a field-blind consumer still yields its rows", () => {
    // The reverse direction: an older parser ignoring `nextCursor` keeps working.
    const entry: ConfirmedCacheEntry = { ...base, nextCursor: CURSOR };
    const { schemaVersion, confirmed, lastFetchedAtMs } = entry;
    expect({ schemaVersion, confirmed, lastFetchedAtMs }).toEqual(base);
  });
});
