// Per-notification detail modal.
//
// Ported from the browser-wallet's `NotificationDetail.tsx`, adapted to the
// desktop design tokens: the same `.w-card` overlay shell as `ActivityDetail`,
// a stack of `DRow`s for the structured fields, and the shared
// `MonoscanTxButton` CTA when the record carries a tx hash.
//
// Honest absence: rows for fields that have nothing to show (amount on a
// zero-LYTH claim, block on the `lyth_txStatus="found"` fast-path that didn't
// surface a block) are simply omitted — no "—" / "N/A" placeholders.

import { useEffect } from "react";

import {
  CopyableAddress,
  DRow,
  MonoscanTxButton,
  relativeMs,
  truncMiddle,
} from "./_detailModalParts";
import {
  isDelegationKind,
  isZeroAmount,
  notificationTitle,
  type NotificationRecord,
} from "../sdk/notifications";

export interface NotificationDetailProps {
  record: NotificationRecord;
  onClose: () => void;
}

function statusLabel(status: "confirmed" | "failed"): string {
  return status === "confirmed" ? "Confirmed" : "Failed";
}

export function NotificationDetail({ record, onClose }: NotificationDetailProps) {
  const title = notificationTitle(record.kind, record.status);
  const showAmount = !isZeroAmount(record.amountDecimal);
  const showBlock = record.blockNumber !== null;
  // Delegation records name the target cluster in place of the "To" module
  // address; null when no cluster info was captured (older records) → fall back
  // to the address "To" row.
  const clusterLabel = isDelegationKind(record.kind)
    ? record.clusterName ??
      (record.clusterId !== undefined ? `Cluster #${record.clusterId}` : null)
    : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        zIndex: 30,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 440, width: "100%" }}
      >
        <div className="w-card__head">
          <h3>{title}</h3>
          <span className="w-card__head__spacer" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="w-card__body">
          <DRow label="Status" value={statusLabel(record.status)} />
          {showAmount ? (
            <DRow label="Amount" value={`${record.amountDecimal} LYTH`} />
          ) : null}
          {clusterLabel !== null ? (
            <DRow label="Cluster" value={clusterLabel} />
          ) : (
            <DRow
              label={record.kind === "receive" ? "From" : "To"}
              value={<CopyableAddress addr={record.counterparty} />}
            />
          )}
          {showBlock ? (
            <DRow
              label="Block"
              value={`#${record.blockNumber!.toLocaleString("en-US")}`}
            />
          ) : null}
          {/* Real on-chain hashes link out; the synthetic incoming id
              (`in:<block>.<txIndex>.<logIndex>`) is never shown or linked. */}
          {record.txHash.startsWith("0x") ? (
            <>
              <DRow
                label="Tx hash"
                value={
                  <span style={{ fontFamily: "var(--f-mono)" }} title={record.txHash}>
                    {truncMiddle(record.txHash)}
                  </span>
                }
              />
              <DRow label="When" value={relativeMs(record.createdAtMs)} />
              <MonoscanTxButton hash={record.txHash} />
            </>
          ) : (
            <DRow label="When" value={relativeMs(record.createdAtMs)} />
          )}
        </div>
      </div>
    </div>
  );
}
