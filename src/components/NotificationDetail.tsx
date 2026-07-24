// Per-notification detail modal.
//
// Uses this wallet's design tokens: the same `.w-card` overlay shell as
// `ActivityDetail`, a stack of `DRow`s for the structured fields, and the
// shared `MonoscanTxButton` CTA when the record carries a tx hash.
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
  humanizeReason,
  isDelegationKind,
  notificationAmountLabel,
  notificationTitle,
  REASON_UNAVAILABLE,
  type NotificationRecord,
} from "../sdk/notifications";
import { formatFeeLythDisplay } from "../sdk/lyth-display";

export interface NotificationDetailProps {
  record: NotificationRecord;
  onClose: () => void;
}

function statusLabel(status: "confirmed" | "failed"): string {
  return status === "confirmed" ? "Confirmed" : "Failed";
}

/** An on-chain revert code (0x02NN family, non-negative) as hex; a JSON-RPC
 *  admission code (negative) as its decimal. */
function formatReasonCode(code: number): string {
  return code >= 0 ? `0x${code.toString(16).padStart(4, "0")}` : String(code);
}

export function NotificationDetail({ record, onClose }: NotificationDetailProps) {
  const title = notificationTitle(record.kind, record.status);
  // A reward claim shows its decoded settled amount ("+<amt> LYTH"); other kinds
  // show the plain amount. Null ⇒ omit the row (zero/absent — honest absence).
  const amountLabel = notificationAmountLabel(record);
  const showBlock = record.blockNumber !== null;
  // A failed record with no inclusion block was refused before it ever landed —
  // an ATTEMPT the network declined, not chain history. Its canonical hash is
  // real (the wallet signed the tx) but the chain never saw it, so it is shown
  // as a local reference, never linked to the explorer.
  const neverIncluded = record.status === "failed" && record.blockNumber === null;
  // Network fee decoded at the confirmed terminal. Uses the FEE precision rule,
  // not the balance one: at 4 dp a floor-priced fee (~0.000042 LYTH) truncates
  // to the string "0", and this row rendered "0 LYTH" — a wallet stating it
  // charged nothing for a charge it had decoded. Null ⇒ omit the row (genuinely
  // zero / undecodable / older record — honest absence, never a fake 0).
  const feeLabel = formatFeeLythDisplay(record.feeLythoshi);
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
          {/* A failed record's reason: a classified label, or "Unavailable" when
              the failure IS a revert whose on-chain reason the node reader does
              not expose. A record with no reason field simply omits this row —
              so "unavailable" never reads the same as "no reason". */}
          {record.status === "failed" && record.reason ? (
            <DRow
              label="Reason"
              value={
                record.reason === REASON_UNAVAILABLE
                  ? "Unavailable"
                  : humanizeReason(record.reason) ?? "Unavailable"
              }
            />
          ) : null}
          {/* F4 — the chain's own revert reason (bounded, sanitised) and its
              revert code, when the reverted receipt carried them. */}
          {record.status === "failed" && record.reasonDetail ? (
            <DRow label="Details" value={record.reasonDetail} />
          ) : null}
          {record.status === "failed" && record.reasonCode !== undefined ? (
            <DRow label="Code" value={formatReasonCode(record.reasonCode)} />
          ) : null}
          {amountLabel !== null ? (
            <DRow
              label={record.kind === "claim" ? "Reward" : "Amount"}
              value={amountLabel}
            />
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
          {feeLabel !== null ? (
            <DRow label="Network fee" value={`${feeLabel} LYTH`} />
          ) : null}
          {/* Real on-chain hashes link out; the synthetic incoming id
              (`in:<block>.<txIndex>.<logIndex>:<cp>:<amount>:<seq>`) starts with
              `in:`, never `0x`, so it is never shown or linked. */}
          {neverIncluded ? (
            <div className="row-help" style={{ marginTop: 6 }}>
              Rejected before inclusion — this transaction never reached the
              chain. Nothing was transferred.
            </div>
          ) : null}
          {record.txHash.startsWith("0x") ? (
            <>
              <DRow
                label={neverIncluded ? "Attempt hash" : "Tx hash"}
                value={
                  <span style={{ fontFamily: "var(--f-mono)" }} title={record.txHash}>
                    {truncMiddle(record.txHash)}
                  </span>
                }
              />
              <DRow label="When" value={relativeMs(record.createdAtMs)} />
              {/* No explorer link for a refused attempt: its hash is not on chain. */}
              {neverIncluded ? null : <MonoscanTxButton hash={record.txHash} />}
            </>
          ) : (
            <DRow label="When" value={relativeMs(record.createdAtMs)} />
          )}
        </div>
      </div>
    </div>
  );
}
