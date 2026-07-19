// Activity page — single chronological feed.
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
import { scopeChainKey } from "../sdk/chains";
import { ActivityDetail, type DetailRow } from "../components/ActivityDetail";
import { NotificationDetail } from "../components/NotificationDetail";
import { TxRow } from "../components/TxRow";
import { useReverseNamesEager } from "../sdk/use-reverse-names";
import { preferredAddressLabel } from "../sdk/address-label";
import { addressbookLookup } from "../sdk/addressbook";
import {
  activityDirection,
  activityRowToTx,
  mergeActivityNewestFirst,
} from "../sdk/activity-rows";
import {
  loadAddressActivityKind,
  loadLiveActivityPage,
  loadOlderActivityPage,
  type LiveAddressActivityRow,
  type RpcOutcome,
} from "../sdk/live";
import {
  emptyActivityCopy,
  type ActivityCoverageKind,
} from "../sdk/activity-coverage";
import {
  activityCacheKey,
  applyCapturedClusterNames,
  compareConfirmedNewestFirst,
  confirmedRowKey,
  mergeConfirmedRows,
} from "../sdk/activity-cache";
import { isNativeLythTokenId, tokenUnitLabel } from "../sdk/lyth-display";
import { loadTokenMetaMap, type TokenMeta } from "../sdk/token-metadata";
import {
  readConfirmedCache,
  writeConfirmedCache,
} from "../sdk/activity-cache-store";
import {
  amountUnitLabel,
  isDelegationKind,
  isZeroAmount,
  notificationTitle,
  pendingOpLabel,
  type NotificationRecord,
} from "../sdk/notifications";
import { listForScope } from "../sdk/notifications-store";
import { removePendingTx } from "../sdk/pending-tx-store";
import { detectAndNotifyIncoming } from "../sdk/incoming-detect";
import { txTypeLabelForOpKind } from "../sdk/tx-type-label";
import { pendingLifecycleNote, scopePendingTxs, type PendingTx } from "../sdk/pending-tx";
import { usePendingTxs } from "../sdk/use-pending-tx";
import { useActiveWallet } from "../sdk/active-wallet";

export function Activity() {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  // The confirmed rows actually rendered: seeded instantly from the persisted
  // cache, then replaced by the cache⊕live merge. Sourcing the feed from this
  // (rather than the raw live outcome) gives an instant first paint, keeps the
  // last-known rows visible through an indexer blip, and is the durable surface
  // later lifecycle work threads captured fields through.
  const [confirmedRows, setConfirmedRows] = useState<LiveAddressActivityRow[]>([]);
  const [failed, setFailed] = useState<NotificationRecord[]>([]);
  // Indexer coverage for the empty-feed message — only probed (and only used)
  // when the confirmed feed comes back empty, so the user learns WHY it's empty.
  const [coverage, setCoverage] = useState<ActivityCoverageKind | null>(null);
  const [busy, setBusy] = useState(false);
  // Two detail modals: ActivityDetail for pending/confirmed rows, and the
  // shared NotificationDetail for a failed record (it has the right shape).
  const [selected, setSelected] = useState<DetailRow | null>(null);
  const [selectedFailed, setSelectedFailed] = useState<NotificationRecord | null>(null);
  // Cached MRC metadata (decimals/symbol) for the MRC-20 tokens in the feed, so
  // token amounts render at their real decimals rather than raw base units.
  const [tokenMeta, setTokenMeta] = useState<Map<string, TokenMeta>>(new Map());

  // Durable tracked-tx store — the wallet's own in-flight broadcasts. The store
  // is shared across every vault, so scope it to the active wallet before it
  // touches the feed: another vault's in-flight tx must never render, seed a
  // sticky cluster name, or be retired against this wallet's confirmed rows.
  const allTracked = usePendingTxs();
  const tracked = useMemo(
    () => scopePendingTxs(allTracked, walletAddress.toLowerCase()),
    [allTracked, walletAddress],
  );
  // Tracked-pending + failed rows are a default-on part of the feed. The stores
  // are empty until the wallet broadcasts a tx, so a fresh feed is exactly the
  // indexed confirmed rows and these interleave once there's in-flight/failed
  // history.
  const showExtra = true;

  // Client-side filters over the indexed (confirmed) rows.
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [tokenFilter, setTokenFilter] = useState<string>("all");

  // ── Pagination ────────────────────────────────────────────────────────────
  // Older pages live OUTSIDE the confirmed cache: the cache stays the
  // newest-window snapshot, so paging back through history never inflates it
  // and never feeds incoming detection.
  const [pageOneCursor, setPageOneCursor] = useState<string | null>(null);
  const [olderRows, setOlderRows] = useState<LiveAddressActivityRow[]>([]);
  // `undefined` = the user has not paged yet (follow page 1); `null` = paged to
  // the end; a string = the next page's cursor.
  const [moreCursor, setMoreCursor] = useState<string | null | undefined>(undefined);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);

  // Once a page has loaded, the advancing cursor is INSULATED from refresh
  // churn — a manual Refresh or the cache⊕live merge must not clobber the
  // user's paging position.
  const activeCursor = moreCursor === undefined ? pageOneCursor : moreCursor;

  // All paging state resets on a scope change (G4).
  const activeScopeKey = `${walletAddress.toLowerCase()}:${scopeChainKey()}`;
  useEffect(() => {
    setOlderRows([]);
    setMoreCursor(undefined);
    setMoreError(null);
    setMoreBusy(false);
    setPageOneCursor(null);
  }, [activeScopeKey]);

  const onLoadMore = async () => {
    if (activeCursor === null || moreBusy) return;
    setMoreBusy(true);
    setMoreError(null);
    try {
      const page = await loadOlderActivityPage(walletAddress, activeCursor);
      if (!page.ok) {
        // The cursor is NOT advanced — a retry re-uses it. An error is never
        // masked as "no more pages", which would silently truncate history.
        setMoreError(page.error ?? "unavailable");
        return;
      }
      const incoming = page.value?.rows ?? [];
      setOlderRows((prev) => {
        const seen = new Set([...confirmedRows, ...prev].map(confirmedRowKey));
        return [...prev, ...incoming.filter((r) => !seen.has(confirmedRowKey(r)))];
      });
      setMoreCursor(page.value?.nextCursor ?? null);
    } finally {
      setMoreBusy(false);
    }
  };

  const activityRows = useMemo(
    () => [...confirmedRows, ...olderRows].sort(compareConfirmedNewestFirst),
    [confirmedRows, olderRows],
  );

  // Counterparty labels for the visible rows. Only USER addresses participate —
  // delegation rows already name their cluster, and a precompile is not a
  // counterparty anyone labels.
  const counterpartyAddresses = useMemo(
    () =>
      confirmedRows
        .map((r) => r.counterparty)
        .filter((a): a is string => typeof a === "string" && a.startsWith("mono1")),
    [confirmedRows],
  );
  // Eager tier: warm entries render at once, then a BOUNDED set resolves.
  const reverseNames = useReverseNamesEager(counterpartyAddresses);
  const [contactNames, setContactNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void addressbookLookup()
      .then((rows) => {
        if (cancelled) return;
        setContactNames(new Map(rows.map((r) => [r.address.toLowerCase(), r.name])));
      })
      .catch(() => {
        // Display-only — an unreadable book just leaves rows unlabelled.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** One precedence, same as every other surface: registered name, then
   *  contact label, then nothing (the row keeps its existing rendering). */
  const labelFor = (address: string | null | undefined): string | null => {
    if (typeof address !== "string" || address === "") return null;
    const key = address.toLowerCase();
    return preferredAddressLabel(reverseNames.get(key) ?? null, contactNames.get(key) ?? null)
      ?.label ?? null;
  };

  // Native rows carry the zero-address token id, so normalize to the display
  // unit ("LYTH" for native, else the token id) — the filter lists LYTH, never
  // the bare zero-address.
  const tokenOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of activityRows) set.add(tokenUnitLabel(row.tokenId));
    return Array.from(set).sort();
  }, [activityRows]);

  const filteredRows = useMemo(
    () =>
      activityRows.filter((row) => {
        if (dirFilter !== "all" && activityDirection(row.direction) !== dirFilter) {
          return false;
        }
        if (tokenFilter !== "all" && tokenUnitLabel(row.tokenId) !== tokenFilter) {
          return false;
        }
        return true;
      }),
    [activityRows, dirFilter, tokenFilter],
  );

  const filtersActive = dirFilter !== "all" || tokenFilter !== "all";

  // Fetch cached MRC metadata for the distinct MRC-20 tokens in the feed so
  // their amounts render at real decimals. Keyed on the id set (content-stable),
  // so it refetches only when a new token appears — not on every render.
  const tokenIdKey = [
    ...new Set(confirmedRows.filter((r) => !isNativeLythTokenId(r.tokenId)).map((r) => r.tokenId!)),
  ].join(",");
  useEffect(() => {
    if (!tokenIdKey) return;
    let cancelled = false;
    void loadTokenMetaMap(tokenIdKey.split(",")).then((m) => {
      if (!cancelled) setTokenMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [tokenIdKey]);

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
      setCoverage(null);
      setConfirmedRows([]);
      return;
    }
    setBusy(true);
    const addrLower = walletAddress.toLowerCase();
    // Scope every per-(address, chain) read to the ACTIVE chain — on a custom
    // chain this keys away from the builtin so nothing leaks across a switch (H3).
    const chainIdHex = scopeChainKey();
    const scopeKey = activityCacheKey(addrLower, chainIdHex);
    try {
      // 1. Instant paint from the persisted cache (also replaces a prior wallet's
      //    rows when switching accounts; null cache ⇒ empty until the live read).
      const cached = await readConfirmedCache(scopeKey);
      setConfirmedRows(cached?.rows ?? []);
      // 2. Live read + scoped failed records.
      const [activityOutcome, scopedNotifications] = await Promise.all([
        loadLiveActivityPage(walletAddress),
        // Active-vault scope only — another vault's failed rows must never
        // appear here (records are owned by the address they were recorded
        // under, which matches the active wallet's lowercased address).
        listForScope(addrLower),
      ]);
      // The rest of the page still speaks rows; the cursor rides alongside.
      setActivity(
        activityOutcome.ok
          ? { ok: true, value: activityOutcome.value?.rows ?? [] }
          : { ok: false, error: activityOutcome.error },
      );
      setPageOneCursor(activityOutcome.ok ? activityOutcome.value?.nextCursor ?? null : null);
      setFailed(scopedNotifications.filter((r) => r.status === "failed"));
      // 3. Merge live into the cache (live wins; older cached rows retained),
      //    render the merged set, and persist. On a live error we keep the cached
      //    rows visible (the error band still surfaces above).
      let mergedConfirmed = cached?.rows ?? [];
      if (activityOutcome.ok) {
        // Merge live into the cache, then keep captured cluster names sticky
        // across the flip / rebuild (the indexer's name read can lag or fail).
        mergedConfirmed = applyCapturedClusterNames(
          mergeConfirmedRows(cached?.rows ?? [], activityOutcome.value?.rows ?? []),
          cached?.rows ?? [],
          tracked,
        );
        setConfirmedRows(mergedConfirmed);
        await writeConfirmedCache(
          scopeKey,
          mergedConfirmed,
          Date.now(),
          activityOutcome.value?.nextCursor ?? null,
        );
      }
      // Only when the merged confirmed feed is empty do we probe the indexer's
      // coverage so the empty state can explain the reason.
      if (activityOutcome.ok && mergedConfirmed.length === 0) {
        setCoverage(await loadAddressActivityKind(walletAddress));
      } else {
        setCoverage(null);
      }
      // Announce newly-arrived incoming native LYTH (records + toasts once) from
      // the LIVE rows, not the merged cache. Open, focused surface only; gated by
      // the experimental flag like the rest of the notifications layer.
      if (showExtra && activityOutcome.ok) {
        // PAGE-1 LIVE ROWS ONLY — older pages never reach detection, or paging
        // back through history would re-announce ancient transfers.
        void detectAndNotifyIncoming(
          addrLower,
          chainIdHex,
          activityOutcome.value?.rows ?? [],
        );
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [walletAddress]);

  // Retire bridged pending rows whose canonical confirmed row has surfaced (the
  // merge already suppresses them visually; this drops them from the durable
  // store so it doesn't accumulate confirmed rows). Runs whenever either side
  // changes; a removal re-renders and converges.
  useEffect(() => {
    const anchors = new Set(
      confirmedRows.map((r) => `${Number(r.blockHeight)}.${r.txIndex}`),
    );
    for (const tx of tracked) {
      if (
        tx.confirmedBlockHeight !== undefined &&
        tx.confirmedTxIndex !== undefined &&
        anchors.has(`${tx.confirmedBlockHeight}.${tx.confirmedTxIndex}`)
      ) {
        void removePendingTx(tx.chainIdHex, tx.txHash);
      }
    }
  }, [confirmedRows, tracked]);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Activity</h1>
        <div className="sub">Transactions on this wallet.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Recent activity</h3>
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
                const lifecycle = tx.lifecycle ?? "pending";
                // Bridged: a real receipt confirmed it ahead of the indexer, so
                // render it confirmed (a green check + the terminal title) at
                // chain speed. Otherwise a still-trackable tx (pending/slow) keeps
                // the spinner; one aged into a visible terminal state ("status
                // unknown") swaps it for a muted clock.
                const bridged = tx.confirmedBlockHeight !== undefined;
                const stalled =
                  !bridged && (lifecycle === "expired" || lifecycle === "dropped");
                return (
                  <div
                    className="w-tx"
                    role="button"
                    key={`p:${tx.chainIdHex}:${tx.txHash}`}
                    onClick={() => setSelected(trackedRowToDetail(tx))}
                    style={{ cursor: "pointer" }}
                  >
                    <div
                      className="w-tx__dir"
                      aria-hidden
                      style={
                        bridged
                          ? { color: "var(--ok)" }
                          : stalled
                            ? { color: "var(--w-text-3)" }
                            : undefined
                      }
                    >
                      {bridged ? (
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
                          <path d="m5 12 5 5L20 7" />
                        </svg>
                      ) : stalled ? (
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
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                      ) : (
                        <span className="w-spin" style={{ width: 14, height: 14, margin: 0 }} />
                      )}
                    </div>
                    <div className="w-tx__info">
                      <div className="eyebrow">
                        <span>
                          {bridged
                            ? notificationTitle(tx.opKind, "confirmed")
                            : pendingOpLabel(tx.opKind)}
                        </span>
                        <span className="sep" />
                        <span>{bridged ? "Confirmed" : pendingLifecycleNote(lifecycle)}</span>
                      </div>
                      <div className="label mono">{pendingRowLabel(tx)}</div>
                    </div>
                    <div className="w-tx__right">
                      {showAmount ? (
                        <div className="w-tx__amt">
                          {tx.amountDecimal}
                          <span className="tok">{amountUnitLabel(tx.unit)}</span>
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
                          <span className="tok">{amountUnitLabel(rec.unit)}</span>
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
                  tx={activityRowToTx(row, tokenMeta)}
                  counterpartyLabel={labelFor(row.counterparty)}
                  onClick={() => setSelected(indexedRowToDetail(row))}
                />
              );
            })
          ) : null}

          {/* Older pages. Visible only once at least one confirmed row rendered
              AND there is either a page to fetch or an error to retry — the
              error band owns the never-loaded state, the empty state owns the
              empty feed. */}
          {activityRows.length > 0 && (activeCursor !== null || moreError !== null) ? (
            <LoadMoreFooter
              busy={moreBusy}
              error={moreError}
              onClick={() => void onLoadMore()}
            />
          ) : null}

          {merged.length === 0 && activity?.ok ? (
            <div className="w-empty">
              {(() => {
                // Filtered: the rows exist but none match — keep the filter copy.
                // Unfiltered: the feed is genuinely empty, so explain the reason
                // from the indexer-coverage probe (falls back to "no activity yet").
                const copy = filtersActive
                  ? {
                      title: "No matching activity",
                      body: "No rows match the current filter. Clear it to see every transaction for this address.",
                    }
                  : emptyActivityCopy(coverage ?? "not_found");
                return (
                  <>
                    <h4>{copy.title}</h4>
                    <p>{copy.body}</p>
                  </>
                );
              })()}
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
          ) : null}

          {merged.length === 0 && !activity?.ok ? (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>
              {walletAddress ? "Loading indexed activity…" : "No active wallet address."}
            </div>
          ) : null}
        </div>
      </div>

      {selected ? (
        <ActivityDetail
          row={selected}
          walletAddr={walletAddress}
          tokenMeta={tokenMeta}
          onClose={() => setSelected(null)}
        />
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
    unit: tx.unit,
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

// Pending-row label: name the cluster for delegation kinds (captured real name,
// else "Cluster #<id>") instead of the bare delegation-module precompile,
// otherwise the truncated counterparty (or tx hash). Never fabricated.
function pendingRowLabel(tx: PendingTx): string {
  if (isDelegationKind(tx.opKind)) {
    return (
      tx.clusterName ??
      (tx.clusterId !== undefined
        ? `Cluster #${tx.clusterId}`
        : truncCounterparty(tx.counterparty))
    );
  }
  return tx.counterparty.length > 0
    ? truncCounterparty(tx.counterparty)
    : truncCounterparty(tx.txHash);
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

/** Older-page footer. Three states, all copy verbatim per the spec.
 *
 *  The error state is deliberately distinct from "no more pages": a transient
 *  failure that silently hid the button would look identical to reaching the
 *  end of history, and the user would never know rows were missing. */
function LoadMoreFooter({
  busy,
  error,
  onClick,
}: {
  busy: boolean;
  error: string | null;
  onClick: () => void;
}) {
  const label = busy ? "Loading…" : error !== null ? "Couldn't load more. Tap to retry." : "Load more";
  return (
    <button
      type="button"
      data-testid="load-more"
      className="btn btn--sm btn--ghost"
      onClick={busy ? undefined : onClick}
      disabled={busy}
      style={{
        width: "100%",
        marginTop: 10,
        ...(error !== null && !busy ? { color: "var(--err)" } : {}),
      }}
    >
      {label}
    </button>
  );
}
