// How a post's date reads.
//
// Recent posts read better as an age — "2 days ago" tells you at a glance
// whether you have already seen it. Older ones read better as a date, because
// past a couple of weeks "51 days ago" is arithmetic the reader has to do to
// get back to a month they can place. The threshold is a fortnight.

import { describe, expect, it } from "vitest";
import { FEED_RECENT_DAYS, formatFeedDate } from "../feed-date";

const NOW = Date.parse("2026-07-25T12:00:00Z");
const at = (iso: string) => formatFeedDate(iso, NOW);

describe("formatFeedDate — recent posts read as an age", () => {
  it("says today for something published hours ago", () => {
    expect(at("2026-07-25T09:00:00Z")).toBe("Today");
  });

  it("says yesterday, not 1 day ago", () => {
    expect(at("2026-07-24T09:00:00Z")).toBe("Yesterday");
  });

  it("counts days inside the recent window", () => {
    expect(at("2026-07-22T12:00:00Z")).toBe("3 days ago");
    expect(at("2026-07-13T12:00:00Z")).toBe("12 days ago");
  });
});

describe("formatFeedDate — older posts read as a date", () => {
  it("switches to a date at the threshold", () => {
    // 14 days is the first day that reads as a date rather than an age.
    expect(at("2026-07-11T12:00:00Z")).toBe("11 July 2026");
  });

  it("renders the live feed's only post as a date", () => {
    // Thu, 04 Jun 2026 — 51 days before NOW. "51 days ago" is arithmetic.
    expect(at("Thu, 04 Jun 2026 00:00:00 GMT")).toBe("4 June 2026");
  });

  it("keeps the year, so an old post is never mistaken for a recent one", () => {
    expect(at("2024-01-09T12:00:00Z")).toBe("9 January 2024");
  });
});

describe("formatFeedDate — what it will not do", () => {
  it("returns an unparseable date verbatim rather than inventing one", () => {
    // The feed's own string is the honest fallback: a made-up date on a news
    // item is a claim about when something happened.
    expect(at("not a date")).toBe("not a date");
    expect(at("")).toBe("");
  });

  it("does not render a future date as a negative age", () => {
    // Clock skew between the reader and the publisher is ordinary; "-2 days
    // ago" is not.
    expect(at("2026-07-27T12:00:00Z")).toBe("27 July 2026");
  });

  it("exposes its threshold rather than hiding it in a literal", () => {
    expect(FEED_RECENT_DAYS).toBe(14);
  });
});
