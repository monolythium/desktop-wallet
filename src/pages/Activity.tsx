// Activity page — denom-segregated tx list.

import { useEffect, useState } from "react";
import { TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import { IDENTITY } from "../data/fixtures";
import type { Denom, Tx } from "../data/fixtures";
import { TxRow } from "../components/TxRow";
import { ActivityDetail, type DetailRow } from "../components/ActivityDetail";
import { getProvider } from "../sdk/client";
import { capture, loadLiveAddressActivity, type LiveAddressActivityRow, type RpcOutcome } from "../sdk/live";

interface PendingTx {
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
  const list = denom === "public" ? TXS_PUBLIC : TXS_PRIVATE;
  const [pending, setPending] = useState<RpcOutcome<PendingTx[]> | null>(null);
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [busy, setBusy] = useState(false);
  // Experimental: clicking a row opens the detail modal. `null` when closed
  // or when the flag is off (no row ever becomes selectable).
  const [selected, setSelected] = useState<DetailRow | null>(null);

  const refreshPending = async () => {
    setBusy(true);
    try {
      const [pendingRows, activityRows] = await Promise.all([
        capture(() => getProvider().rpcClient.lythMempoolPending(IDENTITY.address)),
        loadLiveAddressActivity(IDENTITY.address),
      ]);
      setPending(pendingRows);
      setActivity(activityRows);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshPending();
  }, []);

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
          <h3>Live pending activity</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refreshPending} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {pending === null ? <div className="row-help">Loading lyth_mempoolPending…</div> : null}
          {pending?.ok === false ? <div className="w-live-error">{pending.error}</div> : null}
          {pending?.ok && pending.value?.length === 0 ? <div className="row-help">No pending transactions for <span className="mono">{IDENTITY.address}</span>.</div> : null}
          {pending?.ok && pending.value && pending.value.length > 0 ? (
            <div className="w-live-list">
              {pending.value.map((tx) => {
                const onOpen = experimentalEnabled ? () => setSelected(pendingRowToDetail(tx)) : undefined;
                return (
                  <div
                    className="w-live-row"
                    key={tx.txHash}
                    onClick={onOpen}
                    role={onOpen ? "button" : undefined}
                    style={onOpen ? { cursor: "pointer" } : undefined}
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
          <h3>{activity?.ok && activity.value && activity.value.length > 0 ? "Live indexed activity" : denom === "public" ? "Recent" : "Private envelopes"}</h3>
        </div>
        <div className="w-card__body">
          {activity?.ok === false ? <div className="w-live-error">address activity: {activity.error}</div> : null}
          {activity?.ok && activity.value && activity.value.length > 0 ? (
            <div className="w-live-list">
              {activity.value.map((row) => {
                const onOpen = experimentalEnabled ? () => setSelected(indexedRowToDetail(row)) : undefined;
                return (
                  <div
                    className="w-live-row"
                    key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                    onClick={onOpen}
                    role={onOpen ? "button" : undefined}
                    style={onOpen ? { cursor: "pointer" } : undefined}
                  >
                    <div>
                      <div className="row-label mono">{formatActivityTitle(row)}</div>
                      <div className="row-help">
                        block {row.blockHeight.toString()} · tx {row.txIndex} · log {row.logIndex}
                      </div>
                    </div>
                    <span className="w-live-pill">{formatActivityAmount(row)}</span>
                  </div>
                );
              })}
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>No activity yet.</div>
          ) : (
            list.map((tx) => (
              <TxRow
                key={tx.id}
                tx={tx}
                onClick={experimentalEnabled ? () => setSelected(demoRowToDetail(tx)) : undefined}
              />
            ))
          )}
        </div>
      </div>

      {selected ? (
        <ActivityDetail row={selected} walletAddr={IDENTITY.address} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

// ── Row → DetailRow adapters ──
// Each maps one of the three Activity-list row shapes onto the modal's
// discriminated union. Only fields that exist on the source row are passed;
// none are synthesized.

function pendingRowToDetail(tx: PendingTx): DetailRow {
  return {
    kind: "pending",
    txHash: tx.txHash,
    nonce: tx.nonce,
    txClass: tx.class,
    wireBytesLen: tx.wireBytesLen,
    ready: tx.ready,
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
  };
}

function demoRowToDetail(tx: Tx): DetailRow {
  return {
    kind: "demo",
    txKind: tx.kind,
    direction: tx.direction,
    amount: tx.amount,
    token: tx.token || "LYTH",
    counterparty: tx.counterparty,
    memo: tx.memo,
    when: tx.when,
  };
}

function formatActivityTitle(row: LiveAddressActivityRow): string {
  const kind = row.subKind ? `${row.kind} · ${row.subKind}` : row.kind;
  if (row.counterparty) return `${kind} · ${row.counterparty}`;
  if (row.cluster !== null) return `${kind} · C-${String(row.cluster + 1).padStart(3, "0")}`;
  return kind;
}

function formatActivityAmount(row: LiveAddressActivityRow): string {
  if (row.amount) return `${row.direction === "out" ? "-" : "+"}${row.amount}`;
  if (row.weightBps !== null) return `${row.weightBps} bps`;
  return "indexed";
}
