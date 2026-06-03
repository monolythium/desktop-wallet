// Typed transaction labels — one neutral type-noun per activity row and per
// operation kind, so rows, the detail modal, and notifications all speak the
// same vocabulary instead of ad-hoc per-surface heuristics. Pure; no chain
// lookup, no DOM.

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
      return "Stake";
    case "undelegate":
      return "Unstake";
    case "redelegate":
      return "Restake";
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
}): string {
  const k = `${row.kind} ${row.subKind ?? ""}`.toLowerCase();
  if (k.includes("redeleg")) return "Restake";
  if (k.includes("undeleg")) return "Unstake";
  if (k.includes("deleg") || k.includes("stake")) return "Stake";
  if (k.includes("reward") || k.includes("claim")) return "Claim rewards";
  if (k.includes("rebalance")) return "Auto-rebalance";
  if (k.includes("private") || k.includes("crossing")) return "Private transfer";
  return row.direction === "in" ? "Incoming transfer" : "Outgoing transfer";
}
