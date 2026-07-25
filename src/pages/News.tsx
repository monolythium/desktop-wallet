// News — the Monolythium blog feed.
//
// Designed from the payload, not from what a feed of this kind usually has.
// Read live before any of this was written, the feed carries: a title, a link,
// a publication date, an author-written description, and SIX category elements
// per post. It carries no author, no body, and no images — those elements are
// absent from the document entirely, not empty.
//
// So the texture of a row is its TAXONOMY. That is the one real design choice
// here: the obvious shape for a feed list is a card with a thumbnail, and
// without images a card is just a box. What this feed actually publishes richly
// is its tags — Engineering, post-quantum cryptography, ML-DSA-65 — which are
// genuinely characteristic of a cryptography blog and tell a reader at a glance
// whether a post is for them. Five of the six used to be discarded. Leading
// with them instead of imagery is the risk, and the payload is the argument.
//
// Everything else is restraint: an editorial list with rules between items
// rather than cards, one accent on hover, and no motion beyond a colour change.
//
// NO REMOTE IMAGES, and nothing here is one step from adding them. The content
// policy permits app-local and inline data only, so a feed-referenced image
// would be blocked before it painted and would ship a broken frame to every
// user. The feed carries none today, so the question is moot in practice —
// recorded so it is not rediscovered as a missing feature.

import { useEffect, useState } from "react";
import { BLOG_FEED_URL, loadBlogFeed, type BlogFeedItem } from "../sdk/news";
import { formatFeedDate } from "../sdk/feed-date";
import { ExternalLink } from "../components/ExternalLink";
import { RefreshButton } from "../components/RefreshButton";

/**
 * How many posts the page lists.
 *
 * The status card used to share this page and took roughly half its height;
 * with that gone there is room for more than the eight shown before. Twelve is
 * about a quarter's publishing for a blog that posts a few times a month —
 * enough to be worth scrolling, short of being an archive, which is what the
 * blog itself is for. When the feed carries more, the page SAYS so rather than
 * letting the list imply it is complete.
 */
const MAX_ITEMS = 12;

export function News() {
  const [feed, setFeed] = useState<{ description: string | null; items: BlogFeedItem[] } | null>(
    null,
  );
  const [feedError, setFeedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setFeedError(null);
    try {
      const loaded = await loadBlogFeed().catch((cause: unknown) => {
        setFeedError((cause as Error)?.message ?? String(cause));
        return null;
      });
      if (loaded) setFeed(loaded);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const items = feed?.items ?? [];
  const shown = items.slice(0, MAX_ITEMS);
  const hidden = items.length - shown.length;

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>News</h1>
        {/* The feed's own description of itself when it publishes one — the
            publisher's words beat ours. */}
        <div className="sub">{feed?.description ?? "Posts from the Monolythium blog."}</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Blog</h3>
          <span className="w-live-pill">rss</span>
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={refresh} />
        </div>
        <div className="w-card__body">
          {feedError ? (
            <div className="w-news-state">
              <div className="w-news-state__title">Couldn't load the blog feed</div>
              <div className="w-news-state__body">{feedError}</div>
              <div className="w-news-state__body">
                The feed is published at <span className="mono">{BLOG_FEED_URL}</span>. Refresh to
                try again.
              </div>
            </div>
          ) : null}

          {feed === null && !feedError ? (
            <div className="w-news-state">
              <div className="w-news-state__body">Loading the blog feed…</div>
            </div>
          ) : null}

          {feed !== null && items.length === 0 ? (
            <div className="w-news-state">
              <div className="w-news-state__title">No posts yet</div>
              <div className="w-news-state__body">
                The feed is live but has published nothing so far. New posts appear here.
              </div>
            </div>
          ) : null}

          {shown.length > 0 ? (
            <div className="w-news-list">
              {shown.map((item) => (
                <ExternalLink
                  key={item.link}
                  className="w-news-item"
                  href={item.link}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="w-news-item__head">
                    <span className="w-news-item__title">{item.title}</span>
                    <span className="w-news-item__date">{formatFeedDate(item.publishedAt)}</span>
                  </div>
                  {/* Only when the feed published one. Nothing is cut from a
                      body — there is no body, and a machine-cut opening reads
                      like one. */}
                  {item.summary !== null ? (
                    <p className="w-news-item__summary">{item.summary}</p>
                  ) : null}
                  {item.categories.length > 0 ? (
                    <div className="w-news-item__tags">
                      {item.categories.map((tag, i) => (
                        <span key={tag}>
                          {i > 0 ? <span className="w-news-item__sep"> · </span> : null}
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </ExternalLink>
              ))}
            </div>
          ) : null}

          {/* The list is a selection, and says so when it is one. */}
          {hidden > 0 ? (
            <div className="w-news-more">
              {`Showing the latest ${shown.length} of ${items.length}. `}
              <ExternalLink href="https://monolythium.com/blog/">
                Read the rest on the blog
              </ExternalLink>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
