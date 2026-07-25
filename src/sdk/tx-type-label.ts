// Typed transaction labels — one neutral type-noun per activity row and per
// operation kind, so rows, the detail modal, and notifications all speak the
// same vocabulary instead of ad-hoc per-surface heuristics. Pure; no chain
// lookup, no DOM.

import { isNativeLythTokenId } from "./lyth-display";
import { activityMatchText, DELEGATION_OPERANDS } from "./activity-kind";
import type { TxOpKind } from "./notifications";

/** Neutral type-noun for a recorded/operation kind — drives the notification
 *  row meta. Every TxOpKind maps explicitly (the union is closed). */
export function txTypeLabelForOpKind(kind: TxOpKind): string {
  switch (kind) {
    case "send":
      return "Outgoing transfer";
    case "receive":
      return "Incoming transfer";
    case "delegate":
      return "Delegate";
    case "undelegate":
      return "Undelegate";
    case "redelegate":
      return "Redelegate";
    case "claim":
      return "Claim rewards";
    case "set-auto-compound":
      // Its own noun: this kind used to fall through to "Outgoing transfer",
      // which described the meta line as a transfer while the title said the
      // auto-compound preference had changed.
      return "Auto-compound";
    case "agent-policy":
      return "Agent policy";
    case "contract_call":
      return "Contract call";
  }
}

/** Neutral type-noun for an indexed activity row. The indexer `kind` is a free
 *  string, so we match the recognisable families first and fall back to a
 *  direction-aware transfer label — never a bare "Transaction". */
export function txTypeLabelForActivity(row: {
  kind: string;
  subKind?: string | null;
  direction?: string | null;
  /** MRC-20 token id; absent/null/zero-address means native LYTH. Only consulted
   *  by the direction-less token rule below. */
  tokenId?: string | null;
}): string {
  // The operands come from the ONE shared set in `activity-kind.ts`, so this
  // label path and the kind classifier can never disagree about what counts as a
  // delegation family. They test the indexer's free-string `kind`/`subKind`
  // (which still emit legacy "stake"/"unstake" spellings) — keep them; only the
  // returned label is delegate-worded.
  const k = activityMatchText(row);
  const hit = (ops: readonly string[]) => ops.some((op) => k.includes(op));
  // Claim is tested FIRST, matching the kind classifier: a claim aggregates
  // across the whole stake and is reported against no real target, so testing
  // the delegation family ahead of it would label every claim a delegation.
  if (hit(DELEGATION_OPERANDS.claim)) return "Claim rewards";
  if (hit(DELEGATION_OPERANDS.redelegate)) return "Redelegate";
  if (hit(DELEGATION_OPERANDS.undelegate)) return "Undelegate";
  if (hit(DELEGATION_OPERANDS.delegate)) return "Delegate";
  if (k.includes("rebalance")) return "Auto-rebalance";
  // Reserved: the chain does not emit a private-transfer kind today. Matched (so
  // it renders honestly the day it lands) but NEVER client-synthesized.
  if (k.includes("crossing") || k.includes("cross_to_private")) {
    return "Private transfer";
  }
  // A token movement the indexer gave no direction for must not read as
  // "Outgoing transfer" — that would assert a direction the row never carried.
  if (!isNativeLythTokenId(row.tokenId ?? null) && row.direction == null) {
    return "Token transfer";
  }
  if (row.direction === "in") return "Incoming transfer";
  if (row.direction === "out") return "Outgoing transfer";
  // No direction reported. The badge already renders this row directionless, so
  // an "Outgoing transfer" eyebrow beside it was the surface contradicting
  // itself — and asserting a fund movement the chain never stated. "Transfer"
  // says what is known (value moved) and stops there. Deliberately not the bare
  // "Transaction" catch-all, which names nothing at all.
  return "Transfer";
}
