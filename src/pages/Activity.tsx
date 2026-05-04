// Activity page — denom-segregated tx list.

import { useEffect, useState } from "react";
import { TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import { IDENTITY } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import { TxRow } from "../components/TxRow";
import { getProvider } from "../sdk/client";
import { capture, loadLiveAddressActivity, type LiveAddressActivityRow, type RpcOutcome } from "../sdk/live";

interface Props {
  denom: Denom;
}

export function Activity({ denom }: Props) {
  const list = denom === "public" ? TXS_PUBLIC : TXS_PRIVATE;
  const [pending, setPending] = useState<RpcOutcome<Array<{ txHash: string; nonce: bigint; class: number; wireBytesLen: number; ready: boolean }>> | null>(null);
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [busy, setBusy] = useState(false);

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
              {pending.value.map((tx) => (
                <div className="w-live-row" key={tx.txHash}>
                  <div>
                    <div className="row-label mono">{tx.txHash}</div>
                    <div className="row-help">nonce {tx.nonce.toString()} · class {tx.class} · {tx.wireBytesLen} bytes</div>
                  </div>
                  <span className={`w-live-pill ${tx.ready ? "" : "is-muted"}`}>{tx.ready ? "ready" : "pending"}</span>
                </div>
              ))}
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
              {activity.value.map((row) => (
                <div className="w-live-row" key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}>
                  <div>
                    <div className="row-label mono">{formatActivityTitle(row)}</div>
                    <div className="row-help">
                      block {row.blockHeight.toString()} · tx {row.txIndex} · log {row.logIndex}
                    </div>
                  </div>
                  <span className="w-live-pill">{formatActivityAmount(row)}</span>
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>No activity yet.</div>
          ) : (
            list.map((tx) => <TxRow key={tx.id} tx={tx} />)
          )}
        </div>
      </div>
    </div>
  );
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
