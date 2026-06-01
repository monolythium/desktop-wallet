// Live indexed-activity → tx-row adapter.
//
// Maps a `LiveAddressActivityRow` (from `lyth_getAddressActivity`) onto the
// `Tx` shape that the `TxRow` component renders. Pure and side-effect-free so
// it can be unit tested directly.
//
// HONEST ABSENCE: the indexer activity stream carries no canonical tx hash,
// no wall-clock timestamp, and no memo. The `when` field therefore shows the
// indexer's block coordinate (real data — "block N · tx I"), the memo is left
// empty (TxRow omits it), and the amount is `null` when the row carries none
// (TxRow renders an em-dash for a public row with no amount). Token labels are
// the raw indexer token id (no name registry exists); native rows show "LYTH".

import type { Denom, Tx } from "../data/types";
import type { LiveAddressActivityRow } from "./live";

/** Indexer kind → the `TxRow` icon/category bucket. Conservative: only the
 *  clearly-recognisable families map to reward/stake; everything else is a
 *  generic transfer (the eyebrow still shows the precise indexer kind). */
export function activityKindToTxKind(kind: string): Tx["kind"] {
  const k = kind.toLowerCase();
  if (k.includes("reward")) return "reward";
  if (k.includes("delegat") || k.includes("stake") || k.includes("undeleg")) return "stake";
  return "transfer";
}

/** Direction from the indexer row, defaulting to "out" when absent (the icon
 *  has only two states; the eyebrow carries the precise kind regardless). */
export function activityDirection(direction: string | null): Tx["direction"] {
  return direction === "in" ? "in" : "out";
}

/** Parse a decimal amount string into a number, or `null` when the row carries
 *  no amount (e.g. a weight-only delegation). Non-numeric values collapse to
 *  `null` rather than 0 so TxRow renders an em-dash rather than a fake "0". */
export function parseActivityAmount(amount: string | null): number | null {
  if (amount === null) return null;
  const cleaned = amount.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The eyebrow timestamp slot. The indexer exposes block coordinates, not a
 *  wall-clock time, so that is what we show — honest, not fabricated. */
export function activityWhen(row: LiveAddressActivityRow): string {
  return `block ${row.blockHeight.toString()} · tx ${row.txIndex}`;
}

/** Counterparty label. Falls back to the cluster name for delegation-style
 *  rows that carry a cluster instead of an address, else "—" (no fabrication). */
export function activityCounterparty(row: LiveAddressActivityRow): string {
  if (row.counterparty) return row.counterparty;
  if (row.cluster !== null) return `C-${String(row.cluster + 1).padStart(3, "0")}.cluster.mono`;
  return "—";
}

/**
 * Map one indexed activity row onto a `Tx` for `TxRow`. `denom` is the page's
 * active denomination (public/private), threaded through so TxRow can pick the
 * honest empty-amount label.
 */
export function activityRowToTx(row: LiveAddressActivityRow, denom: Denom): Tx {
  return {
    id: `${row.blockHeight}-${row.txIndex}-${row.logIndex}`,
    when: activityWhen(row),
    amount: parseActivityAmount(row.amount),
    token: row.tokenId ?? "LYTH",
    direction: activityDirection(row.direction),
    counterparty: activityCounterparty(row),
    // The indexer stream carries no memo — left empty so TxRow omits it.
    memo: "",
    kind: activityKindToTxKind(row.subKind ? `${row.kind} ${row.subKind}` : row.kind),
    denom,
  };
}
