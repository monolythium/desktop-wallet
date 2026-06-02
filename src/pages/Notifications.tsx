// Notifications center.
//
// Ported from the browser-wallet's `Notifications.tsx`, adapted to the desktop
// design system (`.w-page` / `.w-card`, the `.btn` family, inline SVG glyphs in
// the Sidebar's visual language — there is no shared Icon component here).
//
// Global inbox: reads every notification scope's entries (merged newest-first
// by `listAllNotifications`) and renders one row per record. Unread rows carry
// a small accent dot. The header CTA flips every record to `read: true`, then
// re-fetches so the dots clear and the top-bar bell badge updates (the store's
// subscription drives the bell on its own).
//
// READ-ONLY against the notifications store — this page never creates a
// notification. Record creation stays in the OperationsDrawer terminal-
// transition hook. The page only lists + marks-read.

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { NotificationDetail } from "../components/NotificationDetail";
import { truncMiddle } from "../components/_detailModalParts";
import {
  isDelegationKind,
  isZeroAmount,
  notificationTitle,
  type NotificationRecord,
  type TxOpKind,
} from "../sdk/notifications";
import { txTypeLabelForOpKind } from "../sdk/tx-type-label";
import {
  listAllNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../sdk/notifications-store";

/** Relative timestamp with a coarse "yesterday" / "Nd ago" tail for the row
 *  meta line (the detail modal reuses the bounded `_detailModalParts` helper).
 *  Pure. */
function relativeMs(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 24 * 3_600_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  const days = Math.floor(delta / (24 * 3_600_000));
  return days === 1 ? "yesterday" : `${days}d ago`;
}

const ICON_SEND = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);
const ICON_STAKE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 11.2l7.6-3.8M8.2 12.8l7.6 3.8" />
  </svg>
);
const ICON_RECEIVE = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);
const ICON_SHIELD = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);
const ICON_SETTINGS = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </svg>
);
const ICON_CONTRACT = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6M9 13h6M9 17h6" />
  </svg>
);

/** Per-kind glyph for the row's leading badge. */
function iconForKind(kind: TxOpKind): ReactElement {
  switch (kind) {
    case "send":
      return ICON_SEND;
    case "delegate":
    case "undelegate":
    case "redelegate":
      return ICON_STAKE;
    case "claim":
      return ICON_RECEIVE;
    case "emergency-key":
      return ICON_SHIELD;
    case "agent-policy":
      return ICON_SETTINGS;
    case "contract_call":
    default:
      return ICON_CONTRACT;
  }
}

/** Status-tinted ring around the badge — confirmed green, failed red. */
function badgeRingColor(status: "confirmed" | "failed"): string {
  return status === "failed" ? "var(--err)" : "var(--ok)";
}

export function Notifications() {
  const [records, setRecords] = useState<NotificationRecord[] | null>(null);
  const [marking, setMarking] = useState(false);
  const [selected, setSelected] = useState<NotificationRecord | null>(null);

  const refresh = useCallback(async () => {
    const r = await listAllNotifications();
    setRecords(r);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleMarkAllRead = useCallback(async () => {
    setMarking(true);
    await markAllNotificationsRead();
    await refresh();
    setMarking(false);
  }, [refresh]);

  // Opening a record's detail also marks JUST that record read. We
  // optimistically clear the row's dot so it updates before the next refresh.
  const handleOpenRecord = useCallback((rec: NotificationRecord) => {
    setSelected(rec);
    if (rec.read) return;
    void (async () => {
      const r = await markNotificationRead(rec.id);
      if (r.flipped) {
        setRecords((prev) =>
          prev ? prev.map((x) => (x.id === rec.id ? { ...x, read: true } : x)) : prev,
        );
      }
    })();
  }, []);

  const hasUnread = (records ?? []).some((r) => !r.read);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Notifications</h1>
        <div className="sub">
          Confirmed and failed transactions from this wallet.
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Recent</h3>
          <span className="w-card__head__spacer" />
          {hasUnread ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void handleMarkAllRead()}
              disabled={marking}
            >
              {marking ? "Marking…" : "Mark all as read"}
            </button>
          ) : null}
        </div>
        <div className="w-card__body">
          {records === null ? (
            <div className="row-help">Loading notifications…</div>
          ) : records.length === 0 ? (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>
              No notifications yet.
            </div>
          ) : (
            <div className="w-live-list">
              {records.map((rec) => (
                <NotificationRow
                  key={rec.id}
                  record={rec}
                  onOpen={() => handleOpenRecord(rec)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selected !== null ? (
        <NotificationDetail record={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function NotificationRow({
  record,
  onOpen,
}: {
  record: NotificationRecord;
  onOpen: () => void;
}) {
  const title = notificationTitle(record.kind, record.status);
  const typeNoun = txTypeLabelForOpKind(record.kind);
  // Delegation rows name the cluster (real name, else "Cluster #<id>") in place
  // of the bare delegation-module address; fall back to the address when no
  // cluster info was captured (older records) — never blank, never fabricated.
  const clusterDisplay = isDelegationKind(record.kind)
    ? record.clusterName ??
      (record.clusterId !== undefined ? `Cluster #${record.clusterId}` : null)
    : null;
  const short = clusterDisplay ?? truncMiddle(record.counterparty);
  const showAmount = !isZeroAmount(record.amountDecimal);
  const ring = badgeRingColor(record.status);
  // Outgoing + confirmed records accent the glyph with the brand colour; the
  // status ring stays green/red. Failed (red) and pending are untouched.
  const isOutgoingConfirmed = record.status === "confirmed";
  const glyphColor = isOutgoingConfirmed ? "var(--gold)" : ring;

  return (
    <div
      className="w-live-row"
      style={{ position: "relative", cursor: "pointer" }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: "50%",
            border: `1px solid ${ring}`,
            color: glyphColor,
            background: "rgba(255,255,255,0.03)",
            flexShrink: 0,
          }}
        >
          {iconForKind(record.kind)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="row-label" style={{ fontWeight: 600 }}>
            {title}
            {!record.read ? <span style={unreadDot} aria-label="Unread" /> : null}
          </div>
          <div className="row-help mono" style={ellipsis}>
            {showAmount
              ? `${typeNoun} · ${record.amountDecimal} LYTH · ${short}`
              : `${typeNoun} · ${short}`}
          </div>
        </div>
      </div>
      <span className="w-live-pill is-muted" style={{ flexShrink: 0 }}>
        {relativeMs(record.createdAtMs)}
      </span>
    </div>
  );
}

const unreadDot: CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--w-blue)",
  marginLeft: 8,
  verticalAlign: "middle",
};

const ellipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
