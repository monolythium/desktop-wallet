// Activity-detail modal — a compact summary popup opened by clicking a row
// in the Activity list (gated behind the experimental flag). Ported from the
// browser-wallet's `ActivityDetail.tsx`, adapted to the desktop row shapes
// and design tokens.
//
// Honest absence: a "View on Monoscan" link only appears when the row carries
// a canonical tx hash. On desktop that is the pending-mempool row (it streams
// its `txHash` directly), the tracked-tx row (the durable store keys on the
// broadcast hash), and any indexed row the enrichment read resolved a hash for
// (the wallet's own txs). Indexed rows whose hash couldn't be resolved — older
// rows, or rows that aren't the wallet's own tx at that index — still omit the
// Monoscan button rather than synthesizing a link.
//
// Address rendering is defensive: counterparties arrive as bech32m (`mono…`)
// and the wallet's own address is bech32m too, so `CopyableAddress` takes the
// string as-is and never throws on a malformed value.

import { useEffect, useState } from "react";

import { activityRelativeTime } from "../sdk/activity-rows";
import { loadLiveTxConfirmations } from "../sdk/live";
import { isZeroAmount, pendingOpLabel, type TxOpKind } from "../sdk/notifications";
import { txTypeLabelForActivity } from "../sdk/tx-type-label";
import { CopyableAddress, DRow, MonoscanTxButton, truncMiddle } from "./_detailModalParts";

/** Pending-mempool row — carries the canonical tx hash, so it links out. */
export interface PendingDetailRow {
  kind: "pending";
  txHash: string;
  nonce: bigint;
  txClass: number;
  wireBytesLen: number;
  ready: boolean;
}

/** Tracked-tx row from the durable store — a tx this wallet broadcast that is
 *  still awaiting its terminal receipt. Carries the canonical broadcast hash,
 *  so it links out; counterparty is typed bech32m. No fabricated mempool fields
 *  (nonce / class / wire size) — the durable store doesn't carry them. */
export interface TrackedDetailRow {
  kind: "tracked";
  txHash: string;
  opKind: TxOpKind;
  amountDecimal: string;
  counterparty: string;
}

/** Indexed activity row (from the enriched address-activity read). Enrichment
 *  may resolve a real block timestamp, the canonical tx hash, and a cluster
 *  name; each is null when the chain couldn't resolve it. */
export interface IndexedDetailRow {
  kind: "indexed";
  activityKind: string;
  subKind: string | null;
  direction: string | null;
  counterparty: string | null;
  amount: string | null;
  tokenId: string | null;
  cluster: number | null;
  weightBps: number | null;
  blockHeight: bigint;
  txIndex: number;
  logIndex: number;
  blockTimestampSeconds: bigint | null;
  txHash: string | null;
  clusterName: string | null;
}

export type DetailRow =
  | PendingDetailRow
  | TrackedDetailRow
  | IndexedDetailRow;

export interface ActivityDetailProps {
  row: DetailRow;
  /** The active wallet's own bech32m address (the From of sends). */
  walletAddr: string;
  onClose: () => void;
}

function clusterName(id: number): string {
  return `Cluster #${id}`;
}

function modalTitle(row: DetailRow): string {
  if (row.kind === "pending") return "Pending transaction";
  if (row.kind === "tracked") return pendingOpLabel(row.opKind);
  // Indexed — the neutral type-noun for the row's kind/subKind/direction.
  return txTypeLabelForActivity({
    kind: row.activityKind,
    subKind: row.subKind,
    direction: row.direction,
  });
}

/** Best-effort confirmation depth for an indexed row that resolved a tx hash.
 *  Attempts `lyth_txConfirmations` on mount and renders the depth only when the
 *  chain reports it; renders nothing on not-found / error so the row's existing
 *  "Confirmed" status stands (no fabricated depth). */
function IndexedTxConfirmations({ txHash }: { txHash: string }) {
  const [confirmations, setConfirmations] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadLiveTxConfirmations(txHash).then((depth) => {
      if (!cancelled) setConfirmations(depth);
    });
    return () => {
      cancelled = true;
    };
  }, [txHash]);
  if (confirmations === null) return null;
  return (
    <DRow
      label="Confirmations"
      value={confirmations.toLocaleString("en-US")}
    />
  );
}

function DetailBody({ row, walletAddr }: { row: DetailRow; walletAddr: string }) {
  if (row.kind === "pending") {
    return (
      <div>
        <DRow label="Status" value={row.ready ? "Ready" : "Pending"} />
        <DRow label="From" value={<CopyableAddress addr={walletAddr} />} />
        <DRow label="Nonce" value={row.nonce.toString()} />
        <DRow label="Class" value={String(row.txClass)} />
        <DRow label="Wire size" value={`${row.wireBytesLen} bytes`} />
        <DRow
          label="Tx hash"
          value={
            <span style={{ fontFamily: "var(--f-mono)" }} title={row.txHash}>
              {truncMiddle(row.txHash)}
            </span>
          }
        />
        <MonoscanTxButton hash={row.txHash} />
      </div>
    );
  }

  if (row.kind === "tracked") {
    const showAmount = !isZeroAmount(row.amountDecimal);
    const showCp = row.counterparty.length > 0;
    return (
      <div>
        <DRow label="Status" value="Awaiting confirmation" />
        {showAmount ? (
          <DRow label="Amount" value={`${row.amountDecimal} LYTH`} />
        ) : null}
        <DRow label="From" value={<CopyableAddress addr={walletAddr} />} />
        {showCp ? (
          <DRow label="To" value={<CopyableAddress addr={row.counterparty} />} />
        ) : null}
        <DRow
          label="Tx hash"
          value={
            <span style={{ fontFamily: "var(--f-mono)" }} title={row.txHash}>
              {truncMiddle(row.txHash)}
            </span>
          }
        />
        <MonoscanTxButton hash={row.txHash} />
      </div>
    );
  }

  // Indexed activity row.
  const isIn = row.direction === "in";
  const cp = row.counterparty;
  // Enrichment may resolve a real block timestamp; show a relative time only
  // when it did, never a fabricated one (the Block row is always present).
  const relativeTime = activityRelativeTime(row.blockTimestampSeconds);
  // Prefer the resolved cluster name; fall back to the synthetic label.
  const clusterLabel =
    row.cluster !== null
      ? row.clusterName
        ? `${row.clusterName} · #${row.cluster}`
        : `${clusterName(row.cluster)} · #${row.cluster}`
      : null;
  return (
    <div>
      <DRow label="Status" value="Confirmed" />
      <DRow label="Type" value={row.subKind ? `${row.activityKind} · ${row.subKind}` : row.activityKind} />
      {relativeTime !== null ? <DRow label="Time" value={relativeTime} /> : null}
      {row.amount !== null ? (
        <DRow
          label="Amount"
          value={`${row.direction === "out" ? "−" : row.direction === "in" ? "+" : ""}${row.amount}${
            row.tokenId ? ` ${row.tokenId}` : " LYTH"
          }`}
        />
      ) : null}
      {row.weightBps !== null ? <DRow label="Weight" value={`${row.weightBps} bps`} /> : null}
      {clusterLabel !== null ? (
        <DRow label="Cluster" value={clusterLabel} />
      ) : null}
      {cp ? (
        isIn ? (
          <>
            <DRow label="From" value={<CopyableAddress addr={cp} />} />
            <DRow label="To" value={<CopyableAddress addr={walletAddr} />} />
          </>
        ) : (
          <>
            <DRow label="From" value={<CopyableAddress addr={walletAddr} />} />
            <DRow label="To" value={<CopyableAddress addr={cp} />} />
          </>
        )
      ) : null}
      <DRow label="Block" value={row.blockHeight.toLocaleString("en-US")} />
      <DRow label="Tx index" value={String(row.txIndex)} />
      <DRow label="Log index" value={String(row.logIndex)} />
      {/* Enrichment resolves the canonical tx hash only for the wallet's own
          txs — link out when present, omit otherwise (never synthesize one). */}
      {row.txHash ? (
        <>
          <DRow
            label="Tx hash"
            value={
              <span style={{ fontFamily: "var(--f-mono)" }} title={row.txHash}>
                {truncMiddle(row.txHash)}
              </span>
            }
          />
          {/* Best-effort: shows the live confirmation depth when the chain
              reports it, otherwise stays silent (status already "Confirmed"). */}
          <IndexedTxConfirmations txHash={row.txHash} />
          <MonoscanTxButton hash={row.txHash} />
        </>
      ) : null}
    </div>
  );
}

export function ActivityDetail({ row, walletAddr, onClose }: ActivityDetailProps) {
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
        aria-label={modalTitle(row)}
        onClick={(e) => e.stopPropagation()}
        className="w-card"
        style={{ maxWidth: 440, width: "100%" }}
      >
        <div className="w-card__head">
          <h3>{modalTitle(row)}</h3>
          <span className="w-card__head__spacer" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="w-card__body">
          <DetailBody row={row} walletAddr={walletAddr} />
        </div>
      </div>
    </div>
  );
}
