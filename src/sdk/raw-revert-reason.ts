// F4 — the ONE place that reaches past the sanctioned SDK receipt reader.
//
// WORKAROUND: `eth_getTransactionReceipt` carries the chain's `revert_reason`
// on the wire (verified live), and the SDK type `TransactionReceipt` even
// DECLARES `revertReason?` — but the pinned SDK's `normalizeTransactionReceipt`
// (0.6.10) builds {tx_hash, block_hash, block_number, tx_index, status,
// executionUnitsUsed} and silently DROPS the reason. So `client.ethGetTransaction-
// Receipt(...)` can never surface it. This module makes a single raw JSON-RPC
// call to read that ONE field. It is NOT a general second RPC path — nothing
// else routes around the sanctioned reader.
//
// UPSTREAM ASK (filed): `normalizeTransactionReceipt` should carry `revertReason`
// through. DELETE this module and read `receipt.revertReason` from the typed
// reader once it does.

import type { RpcClient } from "@monolythium/core-sdk";
import { classifySendError } from "./send-error";
import { MAX_REASON_DETAIL_LEN } from "./notifications";

/** Read the reverted receipt's raw `revert_reason` string via a raw call, past
 *  the normaliser that drops it. Returns the trimmed string, or null on any
 *  failure / absence — the caller then falls back to the honest "unavailable"
 *  marker, never to silence or a guess. */
export async function readRawRevertReason(
  client: RpcClient,
  txHash: string,
): Promise<string | null> {
  try {
    const raw = await client.call<unknown>("eth_getTransactionReceipt", [txHash]);
    if (raw !== null && typeof raw === "object") {
      const rr = raw as { revert_reason?: unknown; revertReason?: unknown };
      const value =
        typeof rr.revert_reason === "string"
          ? rr.revert_reason
          : typeof rr.revertReason === "string"
            ? rr.revertReason
            : null;
      if (value !== null) {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** The on-chain revert code the chain names in a coded revert (`… reverted: 0x02NN`),
 *  else undefined. Pure. */
export function extractRevertCode(raw: string): number | undefined {
  const m = raw.match(/reverted:\s*0x([0-9a-f]{1,4})\b/i);
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 16);
  return Number.isFinite(n) ? n : undefined;
}

/** Bounded, sanitised excerpt of a chain-supplied reason: control chars → space,
 *  whitespace collapsed, capped at {@link MAX_REASON_DETAIL_LEN}. Dropped entirely
 *  if it smells of a path or URL — a chain revert never carries those, so their
 *  presence means something unexpected, and we prefer to store nothing than
 *  something unbounded or leaky. Pure. */
export function sanitizeReasonDetail(raw: string): string | undefined {
  // Replace ASCII control chars (code < 0x20, or DEL 0x7f) with a space,
  // without a control-char regex; then collapse whitespace and trim.
  let stripped = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    stripped += c < 0x20 || c === 0x7f ? " " : ch;
  }
  const clean = stripped.replace(/\s+/g, " ").trim();
  if (clean.length === 0) return undefined;
  // URL, unix path (a run starting with `/`), or windows drive path → drop.
  if (/:\/\//.test(clean) || /(^|\s)\/\S/.test(clean) || /[a-z]:\\/i.test(clean)) {
    return undefined;
  }
  return clean.slice(0, MAX_REASON_DETAIL_LEN);
}

/** Turn a chain-supplied revert reason into the BOUNDED fields a record stores:
 *  a classified `SendErrorKind` token, the numeric revert code when named, and a
 *  sanitised detail excerpt when it adds information the token/code don't carry
 *  (skipped when the excerpt only restates the coded form). Pure. */
export function classifyChainRevert(raw: string): {
  reason: string;
  reasonCode?: number;
  reasonDetail?: string;
} {
  const reason = classifySendError(raw).kind;
  const reasonCode = extractRevertCode(raw);
  const detail = sanitizeReasonDetail(raw);
  const reasonDetail =
    detail && !/^execution reverted:\s*0x[0-9a-f]{1,4}$/i.test(detail) ? detail : undefined;
  return { reason, reasonCode, reasonDetail };
}
