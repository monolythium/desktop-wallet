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

import type { Tx, TxBucket } from "../data/types";
import type { LiveAddressActivityRow } from "./live";
import { confirmedRowKey } from "./activity-cache";
import {
  activityDirectionOf,
  activityKindIsUnsigned,
  activityKindOf,
  type ActivityDirection,
  type ActivityKind,
} from "./activity-kind";
import {
  formatLythDisplay,
  isNativeLythTokenId,
  tokenUnitLabel,
} from "./lyth-display";
import type { NotificationRecord } from "./notifications";
import type { PendingTx } from "./pending-tx";
import { bpsToPercentLabel } from "./delegation-summary";
import { txTypeLabelForActivity } from "./tx-type-label";
import { tokenAmountDisplay, type TokenMeta } from "./token-metadata";

/** Indexer kind → the coarse icon/category bucket.
 *
 *  DERIVED, not a second classifier: it collapses the real {@link ActivityKind}
 *  onto the three-value bucket some older call sites still want. The taxonomy
 *  and its match operands live in `activity-kind.ts`; this only widens them.
 *  Kept because the bucket is genuinely what a categorical caller wants — but
 *  new code should read the kind, which distinguishes the three delegation
 *  operations this bucket flattens together. */
export function activityKindToTxKind(kind: string): TxBucket {
  return txBucketOf(activityKindOf({ kind }));
}

/** Collapse a classified kind onto the coarse bucket. Exhaustive, no default. */
export function txBucketOf(kind: ActivityKind): TxBucket {
  switch (kind) {
    case "claim":
      return "reward";
    case "delegate":
    case "undelegate":
    case "redelegate":
      return "delegate";
    case "tx_send":
    case "tx_receive":
    case "token_transfer":
    case "unclassified":
      return "transfer";
  }
}

/** Direction for an indexed row — classified, then derived from the kind.
 *
 *  Replaces the old field-reading helper that defaulted an ABSENT direction to
 *  "out". That default was the wallet asserting a fund movement the chain never
 *  stated; a row with no reported movement now renders directionless. */
export function activityRowDirection(row: {
  kind: string;
  subKind?: string | null;
  direction?: string | null;
  tokenId?: string | null;
}): ActivityDirection {
  return activityDirectionOf(activityKindOf(row), row.direction ?? null);
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
 * Map one indexed activity row onto a `Tx` for `TxRow`.
 *
 * Per-kind amount/unit resolution:
 *  - delegation rows carry weight (basis points), not a LYTH amount —
 *    render it as an unsigned percent with a "weight" unit (matching the
 *    delegation summary), or an em-dash when the row carries no weight;
 *  - native value + reward amounts are raw lythoshi converted to display LYTH;
 *  - an MRC-20 amount stays in its base units with the token id as the unit
 *    (there is no on-chain symbol registry).
 */
export function activityRowToTx(
  row: LiveAddressActivityRow,
  tokenMeta?: Map<string, TokenMeta>,
): Tx {
  // Classified ONCE, here. The bucket, the sign and (from the next commit) the
  // direction are all derived from this value rather than re-decided per site.
  const kind = activityKindOf(row);
  const bucket = txBucketOf(kind);
  let amountText: string | null;
  let unit: string;
  if (bucket === "delegate") {
    amountText = row.weightBps != null ? bpsToPercentLabel(row.weightBps) : null;
    unit = "weight";
  } else if (isNativeLythTokenId(row.tokenId)) {
    amountText = formatLythDisplay(row.amount);
    unit = "LYTH";
  } else {
    // MRC-20: scale the base-units amount by the token's real decimals when its
    // metadata is loaded; unknown scale → null (TxRow shows "—"), never the raw
    // base-units integer as a human figure. Prefer the real symbol as the unit.
    const meta = tokenMeta?.get(row.tokenId!);
    amountText = tokenAmountDisplay(row.amount, meta);
    unit = meta?.symbol?.trim() || tokenUnitLabel(row.tokenId);
  }
  return {
    // The (block, txIndex, logIndex) anchor is NOT unique. Native transfers all
    // carry the same log-index sentinel, so the two legs the chain serves for a
    // self-transfer share it entirely and differ only in direction. The cache
    // already folds direction (and kind, and cluster) into its row identity for
    // exactly this reason — reuse that one rule rather than keeping a second,
    // weaker answer here.
    id: confirmedRowKey(row),
    when: activityWhen(row),
    amountText,
    unit,
    // A delegation figure is a WEIGHT, not a token amount — it renders unsigned,
    // because a sign there would claim a fund movement the row does not carry.
    signed: !activityKindIsUnsigned(kind),
    direction: activityDirectionOf(kind, row.direction),
    kind,
    bucket,
    counterparty: activityCounterparty(row),
    // The indexer stream carries no memo — left empty so TxRow omits it.
    memo: "",
    typeLabel: txTypeLabelForActivity(row),
  };
}

/** A merged activity-feed item, tagged by source. Pending (in-flight) rows
 *  carry no block and float to the top; confirmed and failed rows interleave by
 *  block height then time. */
export type MergedActivityItem =
  | { tag: "pending"; tx: PendingTx }
  | { tag: "confirmed"; row: LiveAddressActivityRow }
  | { tag: "failed"; record: NotificationRecord };

interface RankedActivityItem {
  item: MergedActivityItem;
  /** Block height; `Infinity` for an item with no block yet (floats to top). */
  block: number;
  /** Epoch-ms tie-breaker within a block (or among unanchored items). */
  ms: number;
}

/** Merge tracked-pending + indexed-confirmed + failed records into ONE
 *  newest-first list. Recency = block height desc (absent/unanchored block →
 *  top), then epoch-ms desc. Pure and stable; never NaNs — `Infinity` blocks
 *  are compared by identity, not subtraction. Failed rows interleave by
 *  recency rather than being pinned. */
export function mergeActivityNewestFirst(
  pending: ReadonlyArray<PendingTx>,
  confirmed: ReadonlyArray<LiveAddressActivityRow>,
  failed: ReadonlyArray<NotificationRecord>,
): MergedActivityItem[] {
  // Confirmed inclusion slots. A BRIDGED pending row (confirmed via receipt
  // ahead of the indexer) whose canonical row has now surfaced is SUPPRESSED
  // here — so a confirmed tx is never shown twice (no duplicate). A bridged row
  // still ahead of the indexer stays visible, rendered confirmed (no drop).
  const confirmedAnchors = new Set(
    confirmed.map((row) => `${Number(row.blockHeight)}.${row.txIndex}`),
  );
  const ranked: RankedActivityItem[] = [];
  for (const tx of pending) {
    const bridged =
      tx.confirmedBlockHeight !== undefined && tx.confirmedTxIndex !== undefined;
    if (
      bridged &&
      confirmedAnchors.has(`${tx.confirmedBlockHeight}.${tx.confirmedTxIndex}`)
    ) {
      continue; // the indexer's canonical row represents it now
    }
    ranked.push({
      item: { tag: "pending", tx },
      // A bridged row interleaves at its real inclusion block; an un-bridged
      // (still in-flight) row floats to the top.
      block: bridged ? tx.confirmedBlockHeight! : Infinity,
      ms: tx.submittedAt,
    });
  }
  for (const row of confirmed) {
    ranked.push({
      item: { tag: "confirmed", row },
      block: Number(row.blockHeight),
      ms:
        row.blockTimestampSeconds !== null
          ? Number(row.blockTimestampSeconds) * 1000
          : 0,
    });
  }
  for (const record of failed) {
    ranked.push({
      item: { tag: "failed", record },
      block: record.blockNumber ?? Infinity,
      ms: record.createdAtMs,
    });
  }
  ranked.sort((a, b) => {
    if (a.block !== b.block) return a.block > b.block ? -1 : 1;
    return b.ms - a.ms;
  });
  return ranked.map((r) => r.item);
}
