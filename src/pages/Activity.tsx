// Activity page — denom-segregated, single chronological feed.
//
// One newest-first feed merges the wallet's three activity sources:
//   1. durable tracked-pending txs (in-flight, no block yet — float to the top),
//   2. indexed confirmed activity rows, and
//   3. recorded failed transactions,
// interleaved by block height then time (failed rows are NOT pinned). The node
// `lyth_mempoolPending` view is not shown — the durable tracked set is the
// wallet's own single source of pending.
//
// Tracked-pending + failed rows are notification-layer features: the stores
// that back them are only written while the experimental flag is on, so with it
// off they are empty and the feed is exactly the indexed confirmed rows.

import { useEffect, useMemo, useState } from "react";
import type { Denom } from "../data/types";
import { ActivityDetail, type DetailRow } from "../components/ActivityDetail";
import { NotificationDetail } from "../components/NotificationDetail";
import { TxRow } from "../components/TxRow";
import {
  activityDirection,
  activityRowToTx,
  mergeActivityNewestFirst,
} from "../sdk/activity-rows";
import {
  loadLiveAddressActivity,
  type LiveAddressActivityRow,
  type RpcOutcome,
} from "../sdk/live";
import {
  isDelegationKind,
  isZeroAmount,
  pendingOpLabel,
  type NotificationRecord,
} from "../sdk/notifications";
import { listAllNotifications } from "../sdk/notifications-store";
import { txTypeLabelForOpKind } from "../sdk/tx-type-label";
import type { PendingTx } from "../sdk/pending-tx";
import { usePendingTxs } from "../sdk/use-pending-tx";
import { useActiveWallet } from "../sdk/active-wallet";

interface Props {
  denom: Denom;
  experimentalEnabled: boolean;
}

export function Activity({ denom, experimentalEnabled }: Props) {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [failed, setFailed] = useState<NotificationRecord[]>([]);
  const [busy, setBusy] = useState(false);
  // Two detail modals: ActivityDetail for pending/confirmed rows, and the
  // shared NotificationDetail for a failed record (it has the right shape).
  const [selected, setSelected] = useState<DetailRow | null>(null);
  const [selectedFailed, setSelectedFailed] = useState<NotificationRecord | null>(null);

  // Durable tracked-tx store — the wallet's own in-flight broadcasts.
  const tracked = usePendingTxs();
  // Tracked-pending + failed are notification-layer features; their backing
  // stores are only written when the experimental flag is on, so with it off
  // they're empty and the feed renders exactly the indexed confirmed rows.
  const showExtra = experimentalEnabled;

  // Client-side filters over the indexed (confirmed) rows.
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [tokenFilter, setTokenFilter] = useState<string>("all");

  const activityRows = activity?.ok ? activity.value ?? [] : [];

  const tokenOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of activityRows) set.add(row.tokenId ?? "LYTH");
    return Array.from(set).sort();
  }, [activityRows]);

  const filteredRows = useMemo(
    () =>
      activityRows.filter((row) => {
        if (dirFilter !== "all" && activityDirection(row.direction) !== dirFilter) {
          return false;
        }
        if (tokenFilter !== "all" && (row.tokenId ?? "LYTH") !== tokenFilter) {
          return false;
        }
        return true;
      }),
    [activityRows, dirFilter, tokenFilter],
  );

  const filtersActive = dirFilter !== "all" || tokenFilter !== "all";

  // The single feed. A filter narrows to the confirmed rows only; unfiltered,
  // the wallet's own pending + failed rows interleave by recency.
  const merged = useMemo(() => {
    const p = !filtersActive && showExtra ? tracked : [];
    const f = !filtersActive && showExtra ? failed : [];
    return mergeActivityNewestFirst(p, filteredRows, f);
  }, [tracked, failed, filteredRows, filtersActive, showExtra]);

  const refresh = async () => {
    if (!walletAddress) {
      setActivity(null);
      setFailed([]);
      return;
    }
    setBusy(true);
    try {
      const [activityOutcome, allNotifications] = await Promise.all([
        loadLiveAddressActivity(walletAddress),
        listAllNotifications(),
      ]);
      setActivity(activityOutcome);
      setFailed(allNotifications.filter((r) => r.status === "failed"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [walletAddress]);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Activity</h1>
        <div className="sub">
          {denom === "public"
            ? "Public-denomination transactions on this wallet."
            : "Private-denomination envelopes — counterparties and amounts are protocol-hidden."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>{denom === "public" ? "Recent activity" : "Private envelopes"}</h3>
          <span className="w-card__head__spacer" />
          {activityRows.length > 0 ? (
            <div className="w-chip-group">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "in", label: "Received" },
                  { id: "out", label: "Sent" },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`w-chip ${dirFilter === o.id ? "is-on" : ""}`}
                  onClick={() => setDirFilter(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}
          {tokenOptions.length > 1 ? (
            <div className="w-chip-group">
              <button
                type="button"
                className={`w-chip ${tokenFilter === "all" ? "is-on" : ""}`}
                onClick={() => setTokenFilter("all")}
              >
                All tokens
              </button>
              {tokenOptions.map((tok) => (
                <button
                  key={tok}
                  type="button"
                  className={`w-chip ${tokenFilter === tok ? "is-on" : ""}`}
                  onClick={() => setTokenFilter(tok)}
                >
                  {tok}
                </button>
              ))}
            </div>
          ) : null}
          <button className="btn btn--sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {activity?.ok === false ? (
            <div className="w-live-error">address activity: {activity.error}</div>
          ) : null}
          {merged.length > 0 ? (
            merged.map((item) => {
              if (item.tag === "pending") {
                const tx = item.tx;
                const showAmount = !isZeroAmount(tx.amountDecimal);
                return (
                  <div
                    className="w-tx"
                    role="button"
                    key={`p:${tx.chainIdHex}:${tx.txHash}`}
                    onClick={() => setSelected(trackedRowToDetail(tx))}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="w-tx__dir" aria-hidden>
                      <span className="w-spin" style={{ width: 14, height: 14, margin: 0 }} />
                    </div>
                    <div className="w-tx__info">
                      <div className="eyebrow">
                        <span>{pendingOpLabel(tx.opKind)}</span>
                        <span className="sep" />
                        <span>in flight</span>
                      </div>
                      <div className="label mono">
                        {tx.counterparty.length > 0
                          ? truncCounterparty(tx.counterparty)
                          : truncCounterparty(tx.txHash)}
                      </div>
                    </div>
                    <div className="w-tx__right">
                      {showAmount ? (
                        <div className="w-tx__amt">
                          {tx.amountDecimal}
                          <span className="tok">LYTH</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }
              if (item.tag === "failed") {
                const rec = item.record;
                const showAmount = !isZeroAmount(rec.amountDecimal);
                return (
                  <div
                    className="w-tx"
                    role="button"
                    key={`f:${rec.id}`}
                    onClick={() => setSelectedFailed(rec)}
                    style={{ cursor: "pointer" }}
                  >
                    <div className="w-tx__dir" style={{ color: "var(--err)" }} aria-hidden>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </div>
                    <div className="w-tx__info">
                      <div className="eyebrow">
                        <span>{txTypeLabelForOpKind(rec.kind)}</span>
                        <span className="sep" />
                        <span style={{ color: "var(--err)" }}>Failed</span>
                      </div>
                      <div className="label">{failedCounterparty(rec)}</div>
                    </div>
                    <div className="w-tx__right">
                      {showAmount ? (
                        <div className="w-tx__amt" style={{ color: "var(--err)" }}>
                          {rec.amountDecimal}
                          <span className="tok">LYTH</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }
              const row = item.row;
              return (
                <TxRow
                  key={`c:${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                  tx={activityRowToTx(row, denom)}
                  onClick={() => setSelected(indexedRowToDetail(row))}
                />
              );
            })
          ) : activity?.ok ? (
            <div className="w-empty">
              <h4>{filtersActive ? "No matching activity" : "No activity yet"}</h4>
              <p>
                {filtersActive
                  ? "No rows match the current filter. Clear it to see every transaction for this address."
                  : denom === "private"
                    ? "Private-denomination activity is not exposed as public indexed rows."
                    : "The indexer has no transactions for this address. Sent and received transfers appear here once they confirm."}
              </p>
              {filtersActive ? (
                <button
                  className="btn btn--sm"
                  style={{ marginTop: 12 }}
                  onClick={() => {
                    setDirFilter("all");
                    setTokenFilter("all");
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>
              {walletAddress
                ? denom === "private"
                  ? "Private-denomination activity is not exposed as public indexed rows."
                  : "Loading indexed activity…"
                : "No active wallet address."}
            </div>
          )}
        </div>
      </div>

      {selected ? (
        <ActivityDetail row={selected} walletAddr={walletAddress} onClose={() => setSelected(null)} />
      ) : null}
      {selectedFailed ? (
        <NotificationDetail record={selectedFailed} onClose={() => setSelectedFailed(null)} />
      ) : null}
    </div>
  );
}

// ── Row → DetailRow adapters ──
// Each maps a feed row onto the modal's discriminated union. Only fields that
// exist on the source row are passed; none are synthesized.

// Durable tracked-tx → detail-modal row. The store keys on the broadcast hash,
// so the modal can link out to Monoscan; counterparty is already typed bech32m.
function trackedRowToDetail(tx: PendingTx): DetailRow {
  return {
    kind: "tracked",
    txHash: tx.txHash,
    opKind: tx.opKind,
    amountDecimal: tx.amountDecimal,
    counterparty: tx.counterparty,
  };
}

function indexedRowToDetail(row: LiveAddressActivityRow): DetailRow {
  return {
    kind: "indexed",
    activityKind: row.kind,
    subKind: row.subKind,
    direction: row.direction,
    counterparty: row.counterparty,
    amount: row.amount,
    tokenId: row.tokenId,
    cluster: row.cluster,
    weightBps: row.weightBps,
    blockHeight: row.blockHeight,
    txIndex: row.txIndex,
    logIndex: row.logIndex,
    blockTimestampSeconds: row.blockTimestampSeconds,
    txHash: row.txHash,
    clusterName: row.clusterName,
  };
}

// Middle-truncate a bech32m counterparty (or tx hash fallback) for the compact
// row subtitle. Pure slicing — never throws on a malformed value.
function truncCounterparty(s: string): string {
  return s.length > 17 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}

// Failed-row label: name the cluster for delegation kinds (real name, else
// "Cluster #<id>"), otherwise the truncated counterparty — never fabricated.
function failedCounterparty(rec: NotificationRecord): string {
  if (isDelegationKind(rec.kind)) {
    return (
      rec.clusterName ??
      (rec.clusterId !== undefined
        ? `Cluster #${rec.clusterId}`
        : truncCounterparty(rec.counterparty))
    );
  }
  return truncCounterparty(rec.counterparty);
}
