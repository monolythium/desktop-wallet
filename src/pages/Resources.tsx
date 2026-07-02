// Resources — the canonical Monolythium external links. Each row opens the
// target in the system browser via a plain external anchor (the registered
// Tauri opener plugin intercepts target="_blank"), the same pattern the Home
// page's Buy link uses. No live data — this is static chain-level content.

import { EXTERNAL_LINKS, stripUrlScheme, type ExternalLink } from "../sdk/chain-content";

export function Resources() {
  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Resources</h1>
        <div className="sub">Official Monolythium sites, docs, and source.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Links</h3>
        </div>
        <div className="w-card__body">
          <div className="w-live-list">
            {EXTERNAL_LINKS.map((link) => (
              <LinkRow key={link.url} link={link} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkRow({ link }: { link: ExternalLink }) {
  return (
    <a
      className="w-live-row"
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{ color: link.brandColor ?? "var(--fg-300)", display: "inline-flex" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
        </span>
        <div className="row-label">{link.label}</div>
      </div>
      <span className="row-help mono">{stripUrlScheme(link.url)}</span>
    </a>
  );
}
