// Activity-detail modal — a compact summary popup opened by clicking a row
// in the Activity list (gated behind the experimental flag). Ported from the
// browser-wallet's `ActivityDetail.tsx`, adapted to the desktop row shapes
// and design tokens.
//
// Honest absence: a "View on Monoscan" link only appears when the row carries
// a canonical tx hash. On desktop that is the pending-mempool row (it streams
// its `txHash` directly) and the tracked-tx row (the durable store keys on the
// broadcast hash). Indexed and demo rows expose no canonical hash — the indexer
// activity stream carries (block, txIndex) coordinates but no hash, and there
// is no desktop RPC that turns those back into a hash — so those rows simply
// omit the Monoscan button rather than synthesizing a link. This mirrors the
// browser, which links a tx only when it knows the hash.
//
// Address rendering is defensive: counterparties arrive as bech32m (`mono…`)
// and the wallet's own address is bech32m too, so `CopyableAddress` takes the
// string as-is and never throws on a malformed value.

import { useEffect } from "react";

import { isZeroAmount, pendingOpLabel, type TxOpKind } from "../sdk/notifications";
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

/** Indexed activity row (from `lyth_getAddressActivity`). No tx hash. */
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
}

/** Demo/fixture row (offline contract). No tx hash, no on-chain coordinate. */
export interface DemoDetailRow {
  kind: "demo";
  txKind: "transfer" | "reward" | "stake";
  direction: "in" | "out";
  amount: number | null;
  token: string;
  counterparty: string;
  memo: string;
  when: string;
}

export type DetailRow =
  | PendingDetailRow
  | TrackedDetailRow
  | IndexedDetailRow
  | DemoDetailRow;

export interface ActivityDetailProps {
  row: DetailRow;
  /** The active wallet's own bech32m address (the From of sends). */
  walletAddr: string;
  onClose: () => void;
}

function clusterName(id: number): string {
  return `C-${String(id + 1).padStart(3, "0")}.cluster.mono`;
}

function modalTitle(row: DetailRow): string {
  if (row.kind === "pending") return "Pending transaction";
  if (row.kind === "tracked") return pendingOpLabel(row.opKind);
  if (row.kind === "demo") {
    if (row.txKind === "reward") return "Reward";
    if (row.txKind === "stake") return "Stake";
    return row.direction === "in" ? "Received" : "Sent";
  }
  // Indexed — title off the indexer kind, capitalised.
  const k = row.activityKind;
  return k.charAt(0).toUpperCase() + k.slice(1);
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

  if (row.kind === "demo") {
    const isIn = row.direction === "in";
    const cp = row.counterparty;
    return (
      <div>
        <DRow label="Status" value="Confirmed" />
        <DRow
          label="Amount"
          value={row.amount !== null ? `${row.amount} ${row.token}` : "Private"}
        />
        {isIn ? (
          <>
            <DRow label="From" value={cp ? <CopyableAddress addr={cp} /> : "unknown"} />
            <DRow label="To" value={<CopyableAddress addr={walletAddr} />} />
          </>
        ) : (
          <>
            <DRow label="From" value={<CopyableAddress addr={walletAddr} />} />
            <DRow label="To" value={cp ? <CopyableAddress addr={cp} /> : "unknown"} />
          </>
        )}
        {row.memo ? <DRow label="Memo" value={row.memo} /> : null}
        <DRow label="When" value={row.when} />
        {/* No canonical tx hash on demo rows → no Monoscan link. */}
      </div>
    );
  }

  // Indexed activity row.
  const isIn = row.direction === "in";
  const cp = row.counterparty;
  return (
    <div>
      <DRow label="Status" value="Confirmed" />
      <DRow label="Type" value={row.subKind ? `${row.activityKind} · ${row.subKind}` : row.activityKind} />
      {row.amount !== null ? (
        <DRow
          label="Amount"
          value={`${row.direction === "out" ? "−" : row.direction === "in" ? "+" : ""}${row.amount}${
            row.tokenId ? ` ${row.tokenId}` : " LYTH"
          }`}
        />
      ) : null}
      {row.weightBps !== null ? <DRow label="Weight" value={`${row.weightBps} bps`} /> : null}
      {row.cluster !== null ? (
        <DRow label="Cluster" value={`${clusterName(row.cluster)} · #${row.cluster}`} />
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
      {/* The indexer stream carries no canonical tx hash → no Monoscan link. */}
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
