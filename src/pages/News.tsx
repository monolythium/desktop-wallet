// News page — the public Monolythium blog feed.
//
// Live chain status used to share this page with the feed. It has its own
// surface now (Network status), because the two answer unrelated questions and
// a reader arriving for one had to scroll past the other. What moved: the live
// status card, the network-events list, and the precompile catalogue. What
// stayed: the feed, unchanged.

import { useEffect, useState } from "react";
import {
  BLOG_FEED_URL,
  loadBlogFeed,
  type BlogFeedItem,
} from "../sdk/news";
import { ExternalLink } from "../components/ExternalLink";
import { RefreshButton } from "../components/RefreshButton";

export function News() {
  const [feed, setFeed] = useState<BlogFeedItem[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setFeedError(null);
    try {
      const items = await loadBlogFeed().catch((cause: unknown) => {
        setFeedError((cause as Error)?.message ?? String(cause));
        return null;
      });
      if (items) setFeed(items);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>News</h1>
        <div className="sub">Posts from the Monolythium blog.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Blog feed</h3>
          <span className="w-live-pill">rss</span>
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={refresh} />
        </div>
        <div className="w-card__body">
          <div className="row-help">
            Source: <span className="mono">{BLOG_FEED_URL}</span>
          </div>
          {feedError ? <div className="w-live-error">{feedError}</div> : null}
          {feed === null && !feedError ? <div className="row-help">Loading blog feed…</div> : null}
          {feed?.length === 0 ? <div className="row-help">No published posts returned by the feed.</div> : null}
          {feed && feed.length > 0 ? (
            <div className="w-live-list" style={{ marginTop: 12 }}>
              {feed.slice(0, 8).map((item) => (
                <ExternalLink
                  key={item.link}
                  className="w-live-row"
                  href={item.link}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  {/* `flex: 1` so the pill and the glyph stay hard right whether
                      or not this item carries a category. */}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="row-label" style={{ display: "block" }}>{item.title}</span>
                    <span className="row-help" style={{ display: "block" }}>{item.summary}</span>
                    <span className="row-help mono" style={{ display: "block" }}>{formatDate(item.publishedAt)}</span>
                  </span>
                  {item.category ? (
                    <span className="w-live-pill is-muted" style={{ marginLeft: "auto" }}>
                      {item.category}
                    </span>
                  ) : null}
                </ExternalLink>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return value;
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
