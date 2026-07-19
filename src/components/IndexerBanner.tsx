// Indexer stale / schema-drift / archive advisories.
//
// Dismissal is PER-SESSION PER-CLASS and deliberately not persisted: indexer
// lag is a transient runtime condition, not a user preference, so a real
// degradation must re-surface on the next launch. The banner never blocks the
// feed — rows keep rendering under it.

import { useState } from "react";
import {
  activeBannerClasses,
  INDEXER_BANNER_DISMISS_LABEL,
  INDEXER_BANNER_TEXT,
  type IndexerBannerClass,
  type IndexerStatusView,
} from "../sdk/indexer-status";

export function IndexerBanner({ view }: { view: IndexerStatusView }) {
  const [dismissed, setDismissed] = useState<Set<IndexerBannerClass>>(new Set());

  const classes = activeBannerClasses(view).filter((c) => !dismissed.has(c));
  if (classes.length === 0) return null;

  return (
    <div data-testid="indexer-banner" style={{ marginBottom: 10, display: "grid", gap: 6 }}>
      {classes.map((cls) => (
        <div
          key={cls}
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--warn)",
            background: "rgba(var(--warn-glow), 0.08)",
            border: "1px solid rgba(var(--warn-glow), 0.4)",
          }}
        >
          <span style={{ flex: 1 }}>
            {/* The archive class renders the CHAIN-AUTHORED string verbatim —
                the wallet deliberately does not own that wording. */}
            {cls === "archive" ? view.archiveRedirect : INDEXER_BANNER_TEXT[cls]}
          </span>
          <button
            type="button"
            aria-label={INDEXER_BANNER_DISMISS_LABEL[cls]}
            onClick={() =>
              setDismissed((prev) => {
                const next = new Set(prev);
                next.add(cls);
                return next;
              })
            }
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
