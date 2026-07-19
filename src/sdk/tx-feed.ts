// Indexer-off fallback feed.
//
// When the per-address index is disabled, operators still serve `lyth_txFeed` —
// a GLOBAL block-scan-backed feed. Filtered to this wallet it gives an honest
// PARTIAL view of native LYTH transfers.
//
// The partiality is the whole design problem: a feed showing only transfers,
// with no disclosure, silently asserts that no delegations ever happened. So the
// mapper is deliberately conservative — anything it cannot represent faithfully
// is DROPPED rather than mislabelled — and the caller is required to render the
// disclosure line naming what is structurally absent.
//
// Read-only and additive by contract: no cache write, no reconcile, no
// notification write, no incoming detection, no watermark movement.

import { addressToTypedBech32, typedBech32ToAddress } from "@monolythium/core-sdk";
import { getProvider } from "./client";
import { capture, type LiveAddressActivityRow, type RpcOutcome } from "./live";
import type { ActivityCoverageKind } from "./activity-coverage";

/** Entries requested per fallback read (the chain caps a request at 200). */
export const TXFEED_FALLBACK_LIMIT = 50;

/** The chain's native-transfer sentinel, so dedupe keys stay consistent with
 *  indexer rows (which carry a real log index). */
export const NATIVE_TRANSFER_LOG_INDEX = 4_294_967_295;

/** The verbatim disclosure that MUST accompany fallback rows. It names what is
 *  absent; without it the partial view reads as a complete history. */
export const TXFEED_DISCLOSURE =
  "Indexer off — showing native LYTH transfers from the public transaction feed. Delegations, claims, and token activity can't be listed here.";

/** One raw feed entry, read structurally rather than by trusting a type. */
interface RawFeedEntry {
  txHash?: unknown;
  blockNumber?: unknown;
  blockTimestamp?: unknown;
  txIndex?: unknown;
  from?: unknown;
  to?: unknown;
  value?: unknown;
  input?: unknown;
}

/** True when the entry carries no calldata. Tolerant of every shape the node
 *  might use for "empty": absent, `"0x"`, `""`, or an empty array. */
export function hasEmptyCalldata(input: unknown): boolean {
  if (input === undefined || input === null) return true;
  if (Array.isArray(input)) return input.length === 0;
  if (typeof input !== "string") return false;
  const t = input.trim().toLowerCase();
  return t === "" || t === "0x";
}

/** A positive native value, read from a decimal or `0x` string / number /
 *  bigint. Anything unreadable is NOT positive (fail-safe → the row drops). */
export function isPositiveValue(value: unknown): boolean {
  try {
    if (typeof value === "bigint") return value > 0n;
    if (typeof value === "number") return Number.isFinite(value) && value > 0;
    if (typeof value !== "string") return false;
    const t = value.trim();
    if (t === "") return false;
    return BigInt(t) > 0n;
  } catch {
    return false;
  }
}

/**
 * Canonicalise an address that may arrive as raw `0x` hex OR typed bech32m into
 * the typed bech32m form. The live feed renders `from` as bech32m and `to` as
 * raw hex, so both shapes must be handled.
 *
 * Returns null when the value cannot be canonicalised — the caller DROPS the
 * row rather than rendering something it could not verify.
 */
export function canonicalTypedAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t === "") return null;
  try {
    if (t.startsWith("0x") || t.startsWith("0X")) {
      return addressToTypedBech32("user", t.toLowerCase());
    }
    // Already typed — round-trip it so a malformed bech32m is rejected here
    // rather than rendered.
    typedBech32ToAddress(t.toLowerCase(), "user");
    return t.toLowerCase();
  } catch {
    return null;
  }
}

/** A finite non-negative integer, else null. */
function intOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "bigint") return value >= 0n ? Number(value) : null;
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Map raw feed entries to activity rows, conservatively.
 *
 * Kept ONLY: native LYTH value transfers (empty calldata AND value > 0) that
 * involve this wallet. Contract calls, zero-value txs and third-party txs are
 * dropped — never mislabelled — which is precisely why delegations, claims and
 * token transfers are structurally absent from this view.
 *
 * A self-send maps to a SINGLE "out" leg. Never throws: a malformed entry drops.
 */
export function mapTxFeedToRows(
  transactions: unknown,
  walletAddressLower: string,
): LiveAddressActivityRow[] {
  if (!Array.isArray(transactions)) return [];
  const wallet = canonicalTypedAddress(walletAddressLower);
  if (wallet === null) return [];

  const rows: LiveAddressActivityRow[] = [];
  for (const raw of transactions) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as RawFeedEntry;
    try {
      if (!hasEmptyCalldata(e.input)) continue; // a contract call is not a transfer
      if (!isPositiveValue(e.value)) continue; // zero-value txs carry no amount

      const from = canonicalTypedAddress(e.from);
      const to = canonicalTypedAddress(e.to);
      // An address we cannot canonicalise is never rendered.
      if (from === null && to === null) continue;

      const isOut = from === wallet;
      const isIn = to === wallet;
      if (!isOut && !isIn) continue; // a third party's tx

      // A self-send is ONE leg, not two.
      const direction = isOut ? "out" : "in";
      const counterparty = isOut ? to : from;
      if (counterparty === null) continue;

      const blockHeight = intOrNull(e.blockNumber);
      const txIndex = intOrNull(e.txIndex);
      if (blockHeight === null || txIndex === null) continue;

      const txHash = typeof e.txHash === "string" && e.txHash.trim() !== "" ? e.txHash.trim() : null;
      const ts = intOrNull(e.blockTimestamp);

      rows.push({
        blockHeight: BigInt(blockHeight),
        txIndex,
        logIndex: NATIVE_TRANSFER_LOG_INDEX,
        kind: "transfer",
        subKind: null,
        direction,
        counterparty,
        tokenId: null,
        amount: String(e.value),
        cluster: null,
        weightBps: null,
        blockTimestampSeconds: ts === null ? null : BigInt(ts),
        // A real chain-served hash — never synthesized — so the detail modal
        // may link it out.
        txHash,
        clusterName: null,
      });
    } catch {
      continue; // a malformed entry is dropped, never partially rendered
    }
  }
  return rows;
}

export interface TxFeedFallbackInput {
  confirmedCount: number;
  failedCount: number;
  liveReadErrored: boolean;
  coverageKind: ActivityCoverageKind | null;
}

/**
 * Whether the fallback may run. Every condition must hold.
 *
 * The load-bearing one is `liveReadErrored`: a transient indexer error keeps the
 * error band, because a fallback rendered over an error would present a partial
 * view as if it were the whole answer.
 *
 * `pruned` / `private` / `unknown` each keep their own empty state — only an
 * explicitly-disabled indexer (or a genuinely-empty timeline) falls back. Pure.
 */
export function txFeedFallbackEnabled(input: TxFeedFallbackInput): boolean {
  if (input.confirmedCount !== 0) return false;
  if (input.failedCount !== 0) return false;
  if (input.liveReadErrored) return false;
  if (input.coverageKind === null) return false; // probe unresolved — wait
  return input.coverageKind === "indexer_disabled" || input.coverageKind === "not_found";
}

/** Read the global feed and filter it to this wallet. Any error — including a
 *  node without the capability answering NotImplemented — yields `ok: false`,
 *  and the page keeps its honest empty state. */
export async function loadTxFeedFallback(
  wallet: string,
): Promise<RpcOutcome<LiveAddressActivityRow[]>> {
  return capture(async () => {
    const res = (await getProvider().rpcClient.lythTxFeed(TXFEED_FALLBACK_LIMIT)) as unknown;
    const transactions =
      res && typeof res === "object" ? (res as { transactions?: unknown }).transactions : null;
    return mapTxFeedToRows(transactions, wallet);
  });
}
