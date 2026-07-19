// Typed transaction labels — one neutral type-noun per activity row and per
// operation kind, so rows, the detail modal, and notifications all speak the
// same vocabulary instead of ad-hoc per-surface heuristics. Pure; no chain
// lookup, no DOM.

import { isNativeLythTokenId } from "./lyth-display";
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
    case "emergency-key":
      return "Backup key";
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
  // Operands test the indexer's free-string `kind` (which still emits legacy
  // "stake" spellings) — keep them; only the returned label is delegate-worded.
  const k = `${row.kind} ${row.subKind ?? ""}`.toLowerCase();
  if (k.includes("redeleg")) return "Redelegate";
  if (k.includes("undeleg")) return "Undelegate";
  if (k.includes("deleg") || k.includes("stake")) return "Delegate";
  if (k.includes("reward") || k.includes("claim")) return "Claim rewards";
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
  return row.direction === "in" ? "Incoming transfer" : "Outgoing transfer";
}
