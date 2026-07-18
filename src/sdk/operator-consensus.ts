// Consensus telemetry for the Operators screen (developer-gated cards).
//
// Three reads about the CONSENSUS AUTHORITY SLOT (not an RPC row): signing
// activity, authority risk, and upcoming duties. Unlike the rest of the screen
// these go through getProvider() — they are data reads about the trusted chain,
// so while the wallet is fail-closed they simply throw and the cards hide. Each
// loader returns null on any failure OR a response that fails a minimal shape
// check; the card renders nothing on null (never a skeleton, error, or zeroed
// body). The pure tier/pill derivations are unit-tested.

import { getProvider } from "./client";
import type {
  OperatorRiskResponse,
  OperatorSigningActivityResponse,
  UpcomingDutiesResponse,
} from "@monolythium/core-sdk";

/** The canonical first authority slot. Card titles carry the scope so nobody
 *  mistakes the card for a per-row attribution. */
export const CONSENSUS_AUTHORITY_INDEX = 0;
export const SIGNING_ACTIVITY_LIMIT = 50;
/** The chain clamps the window at 1000; 200 is the wallet's request. */
export const OPERATOR_RISK_WINDOW_ROUNDS = 200;

export type RiskTier = "ok" | "warn" | "err";

/** Authority-risk tier (pure, first match wins). An absence-shaped jailStatus
 *  never influences the tier — absence of data is not jail. */
export function deriveOperatorRiskTier(risk: OperatorRiskResponse): RiskTier {
  const jail = risk.jailStatus;
  if ("jailed" in jail && (jail.jailed || jail.tombstoned)) return "err";
  if (risk.thresholdBps === 0) return "ok";
  if (risk.missRateBps >= risk.thresholdBps) return "err";
  if (risk.remainingHeadroomBps < risk.thresholdBps / 4) return "warn";
  if (risk.reasons.length > 0) return "warn";
  return "ok";
}

export interface ConsensusPill {
  label: string;
  color: string;
}

/** Signing-status pill (pure). Any unlisted status falls to the generic branch
 *  so no chain-side status ever renders dishonestly. */
export function signingPill(status: string): ConsensusPill {
  switch (status) {
    case "signed":
      return { label: "Signing (latest cert healthy)", color: "var(--ok)" };
    case "maintenance":
      return { label: "Maintenance window", color: "var(--fg-300)" };
    case "delayed":
      return { label: "Delayed — round behind", color: "var(--warn)" };
    case "missed":
      return { label: "Missed round", color: "var(--warn)" };
    case "offline":
      return { label: "Offline", color: "var(--err)" };
    case "no_cert":
      return { label: "No cert this round", color: "var(--fg-500)" };
    case "unavailable_history":
      return { label: "History unavailable", color: "var(--fg-500)" };
    default:
      return { label: `Status: ${status}`, color: "var(--fg-500)" };
  }
}

/** bps → percent string at 2 decimals (e.g. 123 → "1.23"). */
export function bpsPct(bps: number): string {
  return (bps / 100).toFixed(2);
}

export async function loadSigningActivity(): Promise<OperatorSigningActivityResponse | null> {
  try {
    const res = await getProvider().rpcClient.lythSigningActivity(
      CONSENSUS_AUTHORITY_INDEX,
      SIGNING_ACTIVITY_LIMIT,
    );
    return res && Array.isArray(res.entries) ? res : null;
  } catch {
    return null;
  }
}

export async function loadOperatorRisk(): Promise<OperatorRiskResponse | null> {
  try {
    const res = await getProvider().rpcClient.lythOperatorRisk(
      CONSENSUS_AUTHORITY_INDEX,
      OPERATOR_RISK_WINDOW_ROUNDS,
    );
    return res && typeof res.missRateBps === "number" && res.jailStatus != null ? res : null;
  } catch {
    return null;
  }
}

export async function loadUpcomingDuties(): Promise<UpcomingDutiesResponse | null> {
  try {
    const res = await getProvider().rpcClient.lythUpcomingDuties(CONSENSUS_AUTHORITY_INDEX);
    return res && res.duties != null ? res : null;
  } catch {
    return null;
  }
}
