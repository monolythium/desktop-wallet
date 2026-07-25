// Notifications center.
//
// Built on this wallet's design system (`.w-page` / `.w-card`, the `.btn`
// family, inline SVG glyphs in the Sidebar's visual language — there is no
// shared Icon component here).
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
import type { CSSProperties } from "react";
import { NotificationDetail } from "../components/NotificationDetail";
import { badgeRingColor, GlyphBadge, iconForKind } from "../components/activity-icons";
import { truncMiddle } from "../components/_detailModalParts";
import {
  isDelegationKind,
  notificationAmountLabel,
  notificationTitle,
  type NotificationRecord,
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
  // A reward claim shows its decoded settled amount ("+<amt> LYTH"); null ⇒ omit.
  const amountLabel = notificationAmountLabel(record);
  const ring = badgeRingColor(record.status);
  // Outgoing + confirmed records accent the glyph with the brand colour; the
  // status ring stays green/red. Failed (red) and pending are untouched.
  const isOutgoingConfirmed =
    record.status === "confirmed" && record.kind !== "receive";
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
          <GlyphBadge glyph={iconForKind(record.kind)} status={record.status} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="row-label" style={{ fontWeight: 600 }}>
            {title}
            {!record.read ? <span style={unreadDot} aria-label="Unread" /> : null}
          </div>
          {/* Compact row, so the counterparty is middle-truncated — permitted
              ONLY as an expand affordance. The full string is reachable here
              via the title, and the row's detail modal renders it in full with
              a copy that writes the whole address. */}
          <div className="row-help mono" style={ellipsis} title={record.counterparty}>
            {amountLabel !== null
              ? `${typeNoun} · ${amountLabel} · ${short}`
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
