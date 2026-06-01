// Bridge pre-send risk disclosure panel (§20 / §25.2).
//
// Given a selected route disclosure + its SDK assessment + the live drain
// bucket, renders every fact a user needs to verify BEFORE they would sign
// a bridge call: route + verifier model, drain-cap remaining, circuit
// breaker, insurance pool, last incident, and the risk tier as a chromatic
// halo (per the design contract — NOT a filled pill).
//
// IMPORTANT: a live bridge SEND is blocked at the SDK boundary
// (BRIDGE_QUOTE_API_BLOCKED_REASON / BRIDGE_SUBMIT_API_BLOCKED_REASON) —
// mono-core exposes no live quote/submit primitive yet. This panel is the
// disclosure surface only; if a send is ever attempted, the
// blocked-reason surfaces here verbatim rather than reading as a broken
// send.

import {
  BRIDGE_QUOTE_API_BLOCKED_REASON,
  BRIDGE_SUBMIT_API_BLOCKED_REASON,
} from "@monolythium/core-sdk";
import type {
  BridgeDrainStatus,
  BridgeRouteAssessment,
  BridgeRouteDisclosure,
} from "@monolythium/core-sdk";

interface Props {
  route: BridgeRouteDisclosure;
  assessment: BridgeRouteAssessment;
  /** Live per-route drain bucket, when fetched. */
  drainStatus?: BridgeDrainStatus | null;
  /** Set true to surface the SDK send-blocked notice (disclosure-only UX). */
  showSendBlockedNotice?: boolean;
}

// Risk tier → chromatic halo (glow), never a filled pill.
const TIER_GLOW: Record<string, string> = {
  low: "var(--ok)",
  medium: "var(--warn)",
  high: "var(--alert)",
  blocked: "var(--err)",
};

function formatAtomic(value: string | undefined | null): string {
  if (value === undefined || value === null) return "—";
  try {
    const n = BigInt(value);
    if (n === 0n) return "0";
    if (n >= 10n ** 18n) {
      return `${(Number(n) / 1e18).toFixed(2)} (1e18 atoms)`;
    }
    return n.toString();
  } catch {
    return value;
  }
}

export function BridgeRiskPanel({
  route,
  assessment,
  drainStatus,
  showSendBlockedNotice,
}: Props) {
  const glow = TIER_GLOW[assessment.riskTier] ?? "var(--info)";
  const drainRemaining = drainStatus ? drainStatus.remaining : null;

  return (
    <div
      style={{
        display: "grid",
        gap: 6,
        padding: 14,
        borderRadius: 10,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: `0 0 0 1px ${glow}33, 0 0 18px -6px ${glow}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h4 style={{ margin: 0 }}>
          {route.asset} via {route.bridge}
        </h4>
        <span
          style={{
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: glow,
            textShadow: `0 0 10px ${glow}`,
          }}
        >
          {assessment.riskTier} risk
        </span>
      </div>

      <div className="w-kv">
        <span className="k">Route</span>
        <span className="v">
          {route.sourceChain} → {route.destinationChain}
        </span>
      </div>
      <div className="w-kv">
        <span className="k">Verifier</span>
        <span className="v">
          {route.verifier.model} ({route.verifier.threshold}/
          {route.verifier.participantCount})
        </span>
      </div>
      <div className="w-kv">
        <span className="k">Drain cap</span>
        <span className="v">{formatAtomic(route.drainCapAtomic)}</span>
      </div>
      <div className="w-kv">
        <span className="k">Drain remaining</span>
        <span className="v">
          {drainRemaining !== null
            ? formatAtomic(drainRemaining)
            : "no per-asset cap / not loaded"}
        </span>
      </div>
      <div className="w-kv">
        <span className="k">Circuit breaker</span>
        <span className="v">{route.circuitBreaker}</span>
      </div>
      <div className="w-kv">
        <span className="k">Insurance pool</span>
        <span className="v">{formatAtomic(route.insuranceAtomic)}</span>
      </div>
      <div className="w-kv">
        <span className="k">Last incident</span>
        <span className="v">{route.lastIncidentDate ?? "none on record"}</span>
      </div>

      {assessment.warnings.length > 0 && (
        <div className="row-help" style={{ color: "var(--warn)" }}>
          {assessment.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      {assessment.blockedReasons.length > 0 && (
        <div className="row-help" style={{ color: "var(--err)" }}>
          {assessment.blockedReasons.map((r, i) => (
            <div key={i}>✕ {r}</div>
          ))}
        </div>
      )}

      {showSendBlockedNotice && (
        <div
          className="row-help"
          style={{ color: "var(--info)", marginTop: 6, lineHeight: 1.5 }}
        >
          Disclosure only — a live bridge transfer is not available from the
          wallet on this network. {BRIDGE_QUOTE_API_BLOCKED_REASON};{" "}
          {BRIDGE_SUBMIT_API_BLOCKED_REASON}.
        </div>
      )}
    </div>
  );
}
