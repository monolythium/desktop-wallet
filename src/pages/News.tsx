// News page — live chain status plus the public Monolythium blog RSS feed.

import { useEffect, useState } from "react";
import type { NativeReceiptEvent } from "@monolythium/core-sdk";
import {
  BLOG_FEED_URL,
  loadBlogFeed,
  loadRecentNetworkEvents,
  type BlogFeedItem,
} from "../sdk/news";
import { formatOutcome, loadLiveNetworkStatus, type LiveNetworkStatus } from "../sdk/live";

export function News() {
  const [status, setStatus] = useState<LiveNetworkStatus | null>(null);
  const [feed, setFeed] = useState<BlogFeedItem[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [events, setEvents] = useState<NativeReceiptEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setFeedError(null);
    setEventsError(null);
    try {
      const [network, items, eventPage] = await Promise.all([
        loadLiveNetworkStatus(),
        loadBlogFeed().catch((cause: unknown) => {
          setFeedError((cause as Error)?.message ?? String(cause));
          return null;
        }),
        loadRecentNetworkEvents().catch((cause: unknown) => {
          setEventsError((cause as Error)?.message ?? String(cause));
          return null;
        }),
      ]);
      setStatus(network);
      if (items) setFeed(items);
      if (eventPage) setEvents(eventPage.events);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const precompiles = status?.activePrecompiles.ok ? status.activePrecompiles.value ?? [] : [];

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>News</h1>
        <div className="sub">Blog feed and live network status.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Blog feed</h3>
          <span className="w-live-pill">rss</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
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
                <a
                  key={item.link}
                  className="w-live-row"
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div>
                    <div className="row-label">{item.title}</div>
                    <div className="row-help">{item.summary}</div>
                    <div className="row-help mono">{formatDate(item.publishedAt)}</div>
                  </div>
                  {item.category ? <span className="w-live-pill is-muted">{item.category}</span> : null}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live network status</h3>
          <span className="w-live-pill">live</span>
        </div>
        <div className="w-card__body">
          <div className="w-live-grid">
            <LiveCell label="Chain" value={status ? formatOutcome(status.chainId, String) : "loading"} />
            <LiveCell label="Block" value={status ? formatOutcome(status.blockHeight, String) : "loading"} />
            <LiveCell label="Peers" value={status ? formatOutcome(status.peerCount, String) : "loading"} />
            <LiveCell label="Listening" value={status ? formatOutcome(status.listening, String) : "loading"} />
            <LiveCell label="Round" value={status ? formatOutcome(status.currentRound, (round) => round.height.toString()) : "loading"} />
            <LiveCell label="Latest" value={status ? formatOutcome(status.chainStats, (stats) => stats.latestHeight.toString()) : "loading"} />
            <LiveCell label="Precompiles" value={status ? formatOutcome(status.activePrecompiles, (rows) => rows.length.toString()) : "loading"} />
          </div>
          {status ? <div className="row-help">Endpoint: <span className="mono">{status.endpoint}</span></div> : null}
          {status?.chainStats.ok ? <div className="row-help">Genesis: <span className="mono">{status.chainStats.value?.genesisHash ?? "unknown"}</span></div> : null}
          {status?.chainStats.ok === false ? <div className="w-live-error">chainStats: {status.chainStats.error}</div> : null}
          {status?.clientVersion.ok ? <div className="row-help">Client: <span className="mono">{status.clientVersion.value}</span></div> : null}
          {status?.clientVersion.ok === false ? <div className="w-live-error">clientVersion: {status.clientVersion.error}</div> : null}
          {status?.mempoolStatus.ok ? <div className="row-help">Mempool: <span className="mono">{compact(status.mempoolStatus.value)}</span></div> : null}
          {status?.indexerStatus.ok ? <div className="row-help">Indexer: <span className="mono">{compact(status.indexerStatus.value)}</span></div> : null}
          {status?.syncStatus.ok ? <div className="row-help">DAG sync: <span className="mono">{compact(status.syncStatus.value)}</span></div> : null}
          {precompiles.length > 0 ? (
            <div className="w-live-list">
              {precompiles.slice(0, 8).map((precompile) => (
                <div className="w-live-row" key={`${precompile.address}:${precompile.name}`}>
                  <div>
                    <div className="row-label">{precompile.name}</div>
                    <div className="row-help mono">{precompile.address}</div>
                  </div>
                  <span className={`w-live-pill ${precompile.enabled ? "" : "is-muted"}`}>
                    {precompile.enabled ? "enabled" : precompile.gateable ? "gated" : "disabled"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {status?.activePrecompiles.ok === false ? <div className="w-live-error">activePrecompiles: {status.activePrecompiles.error}</div> : null}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Network events</h3>
          <span className="w-live-pill">live</span>
        </div>
        <div className="w-card__body">
          {eventsError ? <div className="w-live-error">{eventsError}</div> : null}
          {events === null && !eventsError ? <div className="row-help">Loading indexed native events…</div> : null}
          {events?.length === 0 ? (
            <div className="row-help">No indexed native events returned in the recent block window.</div>
          ) : null}
          {events && events.length > 0 ? (
            <div className="w-live-list">
              {events.map((event) => (
                <div className="w-live-row" key={`${event.blockHeight}:${event.txIndex}:${event.logIndex}`}>
                  <div>
                    <div className="row-label">{eventTitle(event)}</div>
                    <div className="row-help mono">
                      block {event.blockHeight} · tx {event.txIndex} · log {event.logIndex}
                    </div>
                    <div className="row-help mono">{eventSummary(event)}</div>
                  </div>
                  <span className="w-live-pill is-muted">{event.address}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LiveCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return "disabled";
  return JSON.stringify(value, (_key, inner) => (
    typeof inner === "bigint" ? inner.toString() : inner
  ));
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

function eventTitle(event: NativeReceiptEvent): string {
  const decoded = parseDecoded(event);
  const name = decoded?.eventName ?? decoded?.name ?? decoded?.kind;
  return typeof name === "string" && name.length > 0 ? name : event.eventTopic;
}

function eventSummary(event: NativeReceiptEvent): string {
  const decoded = parseDecoded(event);
  if (!decoded) return event.decodedJson || event.eventTopic;
  return compact(decoded);
}

function parseDecoded(event: NativeReceiptEvent): Record<string, unknown> | null {
  if (event.decoded && typeof event.decoded === "object") {
    return event.decoded as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(event.decodedJson);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
