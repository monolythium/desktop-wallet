// Activity-detail modal — a compact summary popup opened by clicking a row in
// the Activity list. Built around this wallet's row shapes and design tokens.
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
import { bpsToPercentLabel } from "../sdk/delegation-summary";
import { decodeTxFeeLythoshi, loadLiveTxConfirmations } from "../sdk/live";
import {
  formatFeeLythDisplay,
  formatLythDisplay,
  isNativeLythTokenId,
  tokenUnitLabel,
} from "../sdk/lyth-display";
import {
  amountUnitLabel,
  isZeroAmount,
  pendingOpLabel,
  suppressesSubmitTimeAmount,
  type TxOpKind,
} from "../sdk/notifications";
import type { PendingLifecycle } from "../sdk/pending-tx";
import { txTypeLabelForActivity } from "../sdk/tx-type-label";
import { activityRowDirection } from "../sdk/activity-rows";
import { tokenAmountDisplay, type TokenMeta } from "../sdk/token-metadata";
import { CopyableAddress, DRow, MonoscanTxButton, NamedAddress, truncMiddle } from "./_detailModalParts";

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
  /** Amount unit — the token symbol for an MRC-20 send; absent ⇒ LYTH. */
  unit?: string;
  counterparty: string;
  /** Carried so the modal can offer Dismiss for a TERMINAL row only. */
  chainIdHex?: string;
  lifecycle?: PendingLifecycle;
  /** Receipt-confirmed ahead of the indexer — never dismissable. */
  bridged?: boolean;
}

/** A tracked row may be dismissed only when it is genuinely terminal:
 *  `dropped` / `expired` and not bridged. Anything else might still be moving,
 *  and dismissing it would remove the user's only visibility into it. Pure. */
export function isDismissableTracked(row: {
  lifecycle?: PendingLifecycle;
  bridged?: boolean;
}): boolean {
  if (row.bridged === true) return false;
  return row.lifecycle === "dropped" || row.lifecycle === "expired";
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
  /** Cached per-token MRC metadata (decimals/symbol), keyed by token id, so an
   *  MRC-20 amount renders at its real decimals. Absent → the amount shows an
   *  honest "—" rather than raw base units. */
  tokenMeta?: Map<string, TokenMeta>;
  /** Offered only for a genuinely terminal tracked row (see
   *  {@link isDismissableTracked}). */
  onDismiss?: () => void;
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
    tokenId: row.tokenId,
  });
}

/** Is this indexed row a transaction THIS wallet paid the fee for? Only then may
 *  a fee line render — a fee is the sender's debit, and showing someone else's
 *  on an inbound row would assert a charge the user never paid.
 *
 *  Self-paid: an outgoing transfer, and the delegation-family / claim rows
 *  (whose sender is this wallet by construction — they are precompile calls the
 *  wallet itself signs). An inbound row NEVER is. Pure. */
export function isSelfPaidIndexedRow(row: {
  activityKind: string;
  subKind: string | null;
  direction: string | null;
}): boolean {
  if (row.direction === "in") return false;
  const label = txTypeLabelForActivity({
    kind: row.activityKind,
    subKind: row.subKind,
    direction: row.direction,
  });
  if (
    label === "Delegate" ||
    label === "Undelegate" ||
    label === "Redelegate" ||
    label === "Claim rewards"
  ) {
    return true;
  }
  return row.direction === "out";
}

/** Best-effort network fee for a self-paid indexed row. Shows the CHARGED total
 *  the chain decoded — never a reservation or an estimate — and renders nothing
 *  at all until it resolves (no skeleton, no dash: an absent fee is an honest
 *  absence, and a zero/undecodable fee omits the row entirely).
 *
 *  Formatted through `formatFeeLythDisplay` — the FEE precision rule, which the
 *  notification detail's fee row also uses, so one fee reads identically on both
 *  surfaces. A fee below the balance convention's 4 dp shows its exact value
 *  rather than the "0" that convention would print for a charge the chain
 *  reported as strictly positive. */
function IndexedTxFee({ txHash }: { txHash: string }) {
  const [feeLythoshi, setFeeLythoshi] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void decodeTxFeeLythoshi(txHash).then((fee) => {
      if (!cancelled) setFeeLythoshi(fee);
    });
    return () => {
      cancelled = true;
    };
  }, [txHash]);
  if (feeLythoshi === null) return null;
  // A fee has its own precision rule: at the balance's 4 dp a floor-priced fee
  // renders as "0", which claims the wallet charged nothing for a charge it
  // decoded. `formatFeeLythDisplay` shows the exact value instead, and returns
  // null for a genuinely zero one so the row is omitted.
  const display = formatFeeLythDisplay(feeLythoshi);
  if (display === null) return null;
  return <DRow label="Network fee" value={`${display} LYTH`} />;
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

/** The Amount row for an indexed activity entry. Native amounts are raw lythoshi
 *  → display LYTH (unchanged); an MRC-20 amount is scaled by the token's real
 *  decimals when its metadata is loaded, else an honest "—" — never the raw
 *  base-units integer. The unit is LYTH for native, the token's real symbol when
 *  known, else the raw token id. */
function IndexedAmountRow({
  row,
  tokenMeta,
}: {
  row: IndexedDetailRow;
  tokenMeta?: Map<string, TokenMeta>;
}) {
  const native = isNativeLythTokenId(row.tokenId);
  const meta = native ? undefined : tokenMeta?.get(row.tokenId ?? "");
  const display = native
    ? formatLythDisplay(row.amount) ?? row.amount
    : tokenAmountDisplay(row.amount, meta);
  const unit = native ? "LYTH" : meta?.symbol?.trim() || tokenUnitLabel(row.tokenId);
  // Sign only when there's a real figure — an unknown MRC-20 scale shows a bare
  // "—" (never "+—").
  //
  // Derived from the SAME classified direction the feed row draws its arrow
  // from, rather than re-read from the raw field: a claim reports no direction
  // on the wire but IS incoming, so reading the field here showed "12.5" in the
  // detail beside a "+12.5" in the row. A directionless row signs nothing.
  //
  // The minus is ASCII U+002D, not U+2212 — see the codepoint test.
  const direction = activityRowDirection({
    kind: row.activityKind,
    subKind: row.subKind,
    direction: row.direction,
    tokenId: row.tokenId,
  });
  const sign =
    display === null ? "" : direction === "out" ? "-" : direction === "in" ? "+" : "";
  return <DRow label="Amount" value={`${sign}${display ?? "—"} ${unit}`} />;
}

function DetailBody({
  row,
  walletAddr,
  tokenMeta,
}: {
  row: DetailRow;
  walletAddr: string;
  tokenMeta?: Map<string, TokenMeta>;
}) {
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
    // A claim's figure comes only from the decoded Claimed log, which does not
    // exist yet on an in-flight row — the stored amount is the submit-time
    // claimable, a different quantity.
    const showAmount =
      !suppressesSubmitTimeAmount(row.opKind) && !isZeroAmount(row.amountDecimal);
    const showCp = row.counterparty.length > 0;
    return (
      <div>
        <DRow label="Status" value="Awaiting confirmation" />
        {showAmount ? (
          <DRow label="Amount" value={`${row.amountDecimal} ${amountUnitLabel(row.unit)}`} />
        ) : null}
        <DRow label="From" value={<CopyableAddress addr={walletAddr} />} />
        {showCp ? (
          <DRow label="To" value={<NamedAddress addr={row.counterparty} />} />
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
        <IndexedAmountRow row={row} tokenMeta={tokenMeta} />
      ) : null}
      {/* Weight is user-facing, so it reads as a percent — raw bps belongs to
          Developer-Mode surfaces only. */}
      {row.weightBps !== null ? (
        <DRow label="Weight" value={bpsToPercentLabel(row.weightBps)} />
      ) : null}
      {clusterLabel !== null ? (
        <DRow label="Cluster" value={clusterLabel} />
      ) : null}
      {cp ? (
        isIn ? (
          <>
            <DRow label="From" value={<NamedAddress addr={cp} />} />
            <DRow label="To" value={<CopyableAddress addr={walletAddr} />} />
          </>
        ) : (
          <>
            <DRow label="From" value={<CopyableAddress addr={walletAddr} />} />
            <DRow label="To" value={<NamedAddress addr={cp} />} />
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
          {/* Only for a tx this wallet paid for — an inbound row never fetches
              a fee at all, let alone renders one. */}
          {isSelfPaidIndexedRow(row) ? <IndexedTxFee txHash={row.txHash} /> : null}
          <MonoscanTxButton hash={row.txHash} />
        </>
      ) : null}
    </div>
  );
}

export function ActivityDetail({ row, walletAddr, tokenMeta, onDismiss, onClose }: ActivityDetailProps) {
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
          <DetailBody row={row} walletAddr={walletAddr} tokenMeta={tokenMeta} />
          {/* Terminal tracked rows only — a row that might still be live can
              never be dismissed away from here either. */}
          {row.kind === "tracked" && isDismissableTracked(row) && onDismiss ? (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                data-testid="dismiss-tracked-detail"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  onDismiss();
                  onClose();
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
