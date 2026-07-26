// How a post's date reads on the news page.
//
// Two registers, because the reader's question changes with age. For something
// published this week the question is "have I seen this?", which an age answers
// — "2 days ago" lands without arithmetic. Past a couple of weeks the question
// becomes "when was this?", and an age stops helping: "51 days ago" is a sum the
// reader has to do to get back to a month they can place.
//
// The threshold is a fortnight. A blog publishing a few times a month keeps a
// post feeling current for roughly that long; beyond it the date is the more
// useful fact. Exported rather than buried as a literal so the choice is
// visible and arguable.
//
// Pure. `now` is injected so the behaviour is testable without a clock.

/** Days within which a post reads as an age rather than a date. */
export const FEED_RECENT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Render a feed item's publication date.
 *
 * An unparseable value comes back verbatim. That is deliberate: a date on a
 * news item is a claim about when something happened, and the feed's own string
 * — even a malformed one — is at least the publisher's claim rather than ours.
 *
 * A date in the future renders as a date, never as a negative age. Clock skew
 * between a reader and a publisher is ordinary; "-2 days ago" is not.
 */
export function formatFeedDate(published: string, now: number = Date.now()): string {
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return published;

  const elapsedDays = Math.floor((now - at) / DAY_MS);
  if (elapsedDays < 0) return absolute(at);
  if (elapsedDays === 0) return "Today";
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < FEED_RECENT_DAYS) return `${elapsedDays} days ago`;
  return absolute(at);
}

/** Day, full month, year — the year always present, so an old post can never be
 *  mistaken for a recent one at a glance. */
function absolute(at: number): string {
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
