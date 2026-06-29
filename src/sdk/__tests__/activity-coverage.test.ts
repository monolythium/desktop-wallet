import { describe, expect, it } from "vitest";
import {
  emptyActivityCopy,
  normaliseActivityCoverageKind,
  type ActivityCoverageKind,
} from "../activity-coverage";

describe("normaliseActivityCoverageKind", () => {
  it("passes through every known kind", () => {
    for (const k of [
      "found",
      "not_found",
      "indexer_disabled",
      "pruned",
      "private",
    ] as const) {
      expect(normaliseActivityCoverageKind(k)).toBe(k);
    }
  });

  it("collapses any unrecognized node string to 'unknown'", () => {
    expect(normaliseActivityCoverageKind("brand_new_kind")).toBe("unknown");
    expect(normaliseActivityCoverageKind("")).toBe("unknown");
  });
});

describe("emptyActivityCopy", () => {
  it("gives a distinct reason per coverage kind", () => {
    expect(emptyActivityCopy("indexer_disabled").title).toBe(
      "Activity history is unavailable",
    );
    expect(emptyActivityCopy("pruned").title).toBe("Older activity has been pruned");
    expect(emptyActivityCopy("unknown").title).toBe("Activity history is unavailable");
  });

  it("treats found / not_found as the plain 'no activity yet' state", () => {
    expect(emptyActivityCopy("not_found").title).toBe("No activity yet");
    expect(emptyActivityCopy("found").title).toBe("No activity yet");
  });

  it("renders 'private' as a neutral unavailable state (no privacy surface)", () => {
    const copy = emptyActivityCopy("private");
    expect(copy.title).toBe("Activity history is unavailable");
    expect(`${copy.title} ${copy.body}`.toLowerCase()).not.toContain("private");
  });

  it("returns a non-empty title and body for every kind", () => {
    const kinds: ActivityCoverageKind[] = [
      "found",
      "not_found",
      "indexer_disabled",
      "pruned",
      "private",
      "unknown",
    ];
    for (const k of kinds) {
      const copy = emptyActivityCopy(k);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });
});
