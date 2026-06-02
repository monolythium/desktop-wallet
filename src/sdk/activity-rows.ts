// Live indexed-activity → tx-row adapter.
//
// Maps a `LiveAddressActivityRow` (from the enriched address-activity read)
// onto the `Tx` shape that the `TxRow` component renders. Pure and
// side-effect-free so it can be unit tested directly.
//
// HONEST ABSENCE: enrichment populates a real block timestamp, the canonical
// tx hash, and the cluster name only when the chain can resolve them — each is
// null otherwise (timestamp null for old/pruned blocks, tx hash null for rows
// that aren't the wallet's own tx, cluster name null for an unnamed cluster).
// When the timestamp is present the `when` field shows a real relative time;
// when null it falls back to the indexer block coordinate ("block N · tx I").
// The memo is always empty (the stream carries none — TxRow omits it), and the
// amount is `null` when the row carries none (TxRow renders an em-dash for a
// public row with no amount). Token labels are the raw indexer token id (no
// name registry exists); native rows show "LYTH".

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

/** Relative time from a block-header UNIX-second timestamp. Returns a human
 *  label ("just now", "12m ago", "2h ago", "yesterday", "3d ago") or null when
 *  no timestamp is available (old/pruned block) — callers fall back to the
 *  block coordinate rather than inventing a time. `nowMs` is injectable for
 *  deterministic tests. */
export function activityRelativeTime(
  blockTimestampSeconds: bigint | null,
  nowMs: number = Date.now(),
): string | null {
  if (blockTimestampSeconds === null) return null;
  const tsMs = Number(blockTimestampSeconds) * 1000;
  if (!Number.isFinite(tsMs)) return null;
  const delta = Math.max(0, nowMs - tsMs);
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  return `${day}d ago`;
}

/** The eyebrow timestamp slot. When enrichment resolved a real block timestamp
 *  we show a relative wall-clock time; otherwise we fall back to the indexer's
 *  block coordinate — honest, never a fabricated time. */
export function activityWhen(row: LiveAddressActivityRow, nowMs?: number): string {
  const rel = activityRelativeTime(row.blockTimestampSeconds, nowMs);
  if (rel !== null) return rel;
  return `block ${row.blockHeight.toString()} · tx ${row.txIndex}`;
}

/** Counterparty label. Prefers a resolved cluster name from enrichment, then
 *  the counterparty address, then a plain cluster identifier for
 *  delegation-style rows, else "—" (no fabrication). */
export function activityCounterparty(row: LiveAddressActivityRow): string {
  if (row.clusterName) return row.clusterName;
  if (row.counterparty) return row.counterparty;
  if (row.cluster !== null) return `Cluster #${row.cluster}`;
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
