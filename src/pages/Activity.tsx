// Activity page — denom-segregated tx list.
//
// Pending section (experimental): txs this wallet broadcast but that haven't
// reached a terminal receipt live in the durable tracked-tx store. They surface
// as a "Pending" section that clears itself as the app-level reconcile poller
// (`PendingTxReconciler`) carries each tx to confirmed/failed and removes it
// from the store — the store subscription (`usePendingTxs`) drives the
// re-render. This is the wallet's own tracked set, NOT the `lyth_mempoolPending`
// snapshot below (which is the node's view and can include txs from elsewhere).

import { useEffect, useMemo, useState } from "react";
import type { Denom } from "../data/types";
import { ActivityDetail, type DetailRow } from "../components/ActivityDetail";
import { TxRow } from "../components/TxRow";
import { getProvider } from "../sdk/client";
import { activityDirection, activityRowToTx } from "../sdk/activity-rows";
import { capture, loadLiveAddressActivity, type LiveAddressActivityRow, type RpcOutcome } from "../sdk/live";
import { isZeroAmount, pendingOpLabel } from "../sdk/notifications";
import type { PendingTx } from "../sdk/pending-tx";
import { usePendingTxs } from "../sdk/use-pending-tx";
import { useActiveWallet } from "../sdk/active-wallet";

// The node's `lyth_mempoolPending` row shape. Distinct from the durable
// tracked-tx `PendingTx` (imported above) that backs the "Pending" section:
// this is the node's mempool view, that is the wallet's own broadcast set.
interface MempoolPendingTx {
  txHash: string;
  nonce: bigint;
  class: number;
  wireBytesLen: number;
  ready: boolean;
}

interface Props {
  denom: Denom;
  experimentalEnabled: boolean;
}

export function Activity({ denom, experimentalEnabled }: Props) {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [pending, setPending] = useState<RpcOutcome<MempoolPendingTx[]> | null>(null);
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [busy, setBusy] = useState(false);
  // Clicking a row opens the tx-detail modal (default-on — every build has
  // clickable rows). `null` when the modal is closed.
  const [selected, setSelected] = useState<DetailRow | null>(null);
  // Durable tracked-tx store — txs this wallet broadcast that are still in
  // flight. The hook hydrates on mount and returns [] until then and whenever
  // nothing is outstanding; gated on the same flag, so OFF renders identically
  // to master. Rows clear as the reconcile poller removes each resolved tx.
  const tracked = usePendingTxs();
  const showPending = experimentalEnabled && tracked.length > 0;

  // Client-side filters over the already-loaded indexed-activity rows. The
  // direction filter maps onto the row's normalised in/out direction; the
  // token filter is the raw indexer token id (native rows are "LYTH").
  const [dirFilter, setDirFilter] = useState<"all" | "in" | "out">("all");
  const [tokenFilter, setTokenFilter] = useState<string>("all");

  const activityRows = activity?.ok ? activity.value ?? [] : [];

  // Distinct token options drawn from the loaded rows (native = "LYTH").
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

  const refreshPending = async () => {
    if (!walletAddress) {
      setPending(null);
      setActivity(null);
      return;
    }
    setBusy(true);
    try {
      const [pendingRows, activityRows] = await Promise.all([
        capture(() => getProvider().rpcClient.lythMempoolPending(walletAddress)),
        loadLiveAddressActivity(walletAddress),
      ]);
      setPending(pendingRows);
      setActivity(activityRows);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshPending();
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

      {showPending ? (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Pending</h3>
            <span className="w-card__head__spacer" />
            <span className="w-live-pill is-muted">{tracked.length} in flight</span>
          </div>
          <div className="w-card__body">
            <div className="w-live-list">
              {tracked.map((tx) => {
                const onOpen = () => setSelected(trackedRowToDetail(tx));
                const showAmount = !isZeroAmount(tx.amountDecimal);
                return (
                  <div
                    className="w-live-row"
                    key={`${tx.chainIdHex}:${tx.txHash}`}
                    onClick={onOpen}
                    role="button"
                    style={{ cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span className="w-spin" style={{ width: 14, height: 14, margin: 0, flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div className="row-label">{pendingOpLabel(tx.opKind)}</div>
                        <div className="row-help mono" style={{ overflowWrap: "anywhere" }}>
                          {tx.counterparty.length > 0 ? truncCounterparty(tx.counterparty) : truncCounterparty(tx.txHash)}
                        </div>
                      </div>
                    </div>
                    {showAmount ? (
                      <span className="w-live-pill is-muted">{tx.amountDecimal} LYTH</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="row-help" style={{ marginTop: 10 }}>
              Awaiting on-chain confirmation. Resolves automatically — clears
              when each transaction confirms or fails.
            </div>
          </div>
        </div>
      ) : null}

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live pending activity</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refreshPending} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {pending === null ? <div className="row-help">{walletAddress ? "Loading lyth_mempoolPending…" : "No active wallet address."}</div> : null}
          {pending?.ok === false ? <div className="w-live-error">{pending.error}</div> : null}
          {pending?.ok && pending.value?.length === 0 ? <div className="row-help">No pending transactions for <span className="mono">{walletAddress}</span>.</div> : null}
          {pending?.ok && pending.value && pending.value.length > 0 ? (
            <div className="w-live-list">
              {pending.value.map((tx) => {
                const onOpen = () => setSelected(pendingRowToDetail(tx));
                return (
                  <div
                    className="w-live-row"
                    key={tx.txHash}
                    onClick={onOpen}
                    role="button"
                    style={{ cursor: "pointer" }}
                  >
                    <div>
                      <div className="row-label mono">{tx.txHash}</div>
                      <div className="row-help">nonce {tx.nonce.toString()} · class {tx.class} · {tx.wireBytesLen} bytes</div>
                    </div>
                    <span className={`w-live-pill ${tx.ready ? "" : "is-muted"}`}>{tx.ready ? "ready" : "pending"}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>{activityRows.length > 0 ? "Live indexed activity" : denom === "public" ? "Recent" : "Private envelopes"}</h3>
          {activityRows.length > 0 ? (
            <>
              <span className="w-card__head__spacer" />
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
            </>
          ) : null}
        </div>
        <div className="w-card__body">
          {activity?.ok === false ? <div className="w-live-error">address activity: {activity.error}</div> : null}
          {activityRows.length > 0 ? (
            filteredRows.length > 0 ? (
              filteredRows.map((row) => (
                <TxRow
                  key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                  tx={activityRowToTx(row, denom)}
                  onClick={() => setSelected(indexedRowToDetail(row))}
                />
              ))
            ) : (
              <div className="w-empty">
                <h4>No matching activity</h4>
                <p>
                  No rows match the current filter. Clear it to see every
                  indexed transaction for this address.
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
            )
          ) : activity?.ok ? (
            <div className="w-empty">
              <h4>No activity yet</h4>
              <p>
                {denom === "private"
                  ? "Private-denomination activity is not exposed as public indexed rows."
                  : "The indexer has no transactions for this address. Sent and received transfers appear here once they confirm."}
              </p>
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
    </div>
  );
}

// ── Row → DetailRow adapters ──
// Each maps one of the three Activity-list row shapes onto the modal's
// discriminated union. Only fields that exist on the source row are passed;
// none are synthesized.

function pendingRowToDetail(tx: MempoolPendingTx): DetailRow {
  return {
    kind: "pending",
    txHash: tx.txHash,
    nonce: tx.nonce,
    txClass: tx.class,
    wireBytesLen: tx.wireBytesLen,
    ready: tx.ready,
  };
}

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
// Pending-row subtitle. Pure slicing — never throws on a malformed value.
function truncCounterparty(s: string): string {
  return s.length > 17 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;
}
