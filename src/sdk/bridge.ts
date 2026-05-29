// Bridge SDK seam — typed wrappers around the §20 trusted-routes registry
// and the §25.2 pre-send risk disclosure surface.
//
// Read-only. mono-core exposes NO live bridge quote/submit primitive in
// 0.3.10 — the SDK gates both behind BRIDGE_QUOTE_API_BLOCKED_REASON /
// BRIDGE_SUBMIT_API_BLOCKED_REASON. This seam surfaces every disclosure
// field a user needs to verify a route BEFORE they would sign a bridge
// call (drain cap remaining, circuit-breaker posture, insurance pool,
// last incident, verifier model, and a computed risk tier) but never
// attempts a transfer.

import {
  BRIDGE_QUOTE_API_BLOCKED_REASON,
  BRIDGE_SUBMIT_API_BLOCKED_REASON,
  assessBridgeRoute,
  bridgeDrainRemaining,
  rankBridgeRoutes,
} from "@monolythium/core-sdk";
import type {
  BridgeDrainStatus,
  BridgeHealthResponse,
  BridgeRouteAssessment,
  BridgeRouteDisclosure,
  BridgeRoutesResponse,
  BridgeRiskTier,
  BridgeTransferIntent,
} from "@monolythium/core-sdk";
import { getProvider } from "./client";

// Re-export the SDK blocked-reason constants so the pre-send panel can
// surface them verbatim if a live send is ever attempted (it cannot be —
// the SDK has no quote/submit). One import site for the whole wallet.
export { BRIDGE_QUOTE_API_BLOCKED_REASON, BRIDGE_SUBMIT_API_BLOCKED_REASON };
export type { BridgeRouteDisclosure, BridgeRouteAssessment, BridgeDrainStatus };

/**
 * Fetch the trusted bridge route disclosures from the connected node.
 * The chain returns the catalogue under either `routes` or
 * `bridgeRouteDisclosures` depending on the path; normalise to one list.
 */
export async function fetchBridgeRoutes(
  intent?: BridgeTransferIntent,
  limit = 25,
): Promise<{ response: BridgeRoutesResponse; routes: BridgeRouteDisclosure[] }> {
  const response = await getProvider().rpcClient.lythBridgeRoutes({
    intent: intent ?? null,
    limit,
  });
  const routes =
    response.routes ?? response.bridgeRouteDisclosures ?? [];
  return { response, routes };
}

/**
 * Compute the SDK risk assessment for a single disclosure — pure, no I/O.
 * `riskTier` is "low" | "medium" | "high" | "blocked"; a paused breaker
 * or a route the SDK refuses lands as "blocked".
 */
export function assessRoute(route: BridgeRouteDisclosure): BridgeRouteAssessment {
  return assessBridgeRoute(route);
}

/** Rank a route set best-first by SDK score (read-only, no transfer). */
export function rankRoutes(routes: readonly BridgeRouteDisclosure[]) {
  return rankBridgeRoutes(routes);
}

/**
 * Live per-route drain bucket for one `(bridgeId, wrappedAsset)`. The
 * `remaining` field is the headroom left in the current rolling window
 * before the bridge's drain-cap circuit-breaker trips.
 */
export async function fetchDrainStatus(
  bridgeId: string,
  wrappedAssetBech32m: string,
): Promise<BridgeDrainStatus> {
  return getProvider().rpcClient.lythBridgeDrainStatus(
    bridgeId,
    wrappedAssetBech32m,
  );
}

/**
 * Page the global bridge-health set — each record's `circuitBreaker`
 * answers "is this route paused / rate-limited" in one round-trip.
 */
export async function fetchBridgeHealth(
  cursor?: string | null,
  limit = 25,
): Promise<BridgeHealthResponse> {
  return getProvider().rpcClient.lythBridgeHealth(cursor ?? null, limit);
}

/**
 * SDK-computed `cap - drained` floored at zero (decimal string), or
 * `null` when the cap is disabled. Pure passthrough so callers don't
 * re-import the SDK helper.
 */
export function drainRemainingDisplay(
  capPerWindow: string,
  drained: string,
): string | null {
  return bridgeDrainRemaining(capPerWindow, drained);
}

/**
 * The flattened risk summary the pre-send {@link BridgeRiskPanel}
 * consumes. Everything here is read straight from the chain's trusted
 * registry + the SDK's pure risk assessment — no transfer is built.
 */
export interface BridgeRouteRiskSummary {
  routeId: string;
  bridge: string;
  asset: string;
  sourceChain: string;
  destinationChain: string;
  /** native / wrapped / bridged / light-client / zk — from verifier.model. */
  verifierModel: string;
  verifierThreshold: number;
  verifierParticipantCount: number;
  riskTier: BridgeRiskTier;
  score: number;
  /** Static drain cap from the disclosure (atomic decimal/hex string). */
  drainCapAtomic: string;
  /** Live remaining headroom from lyth_bridgeDrainStatus, when fetched. */
  drainRemaining: string | null;
  /** "armed" | "paused" | "disabled" | "unknown". */
  circuitBreaker: string;
  insuranceAtomic: string;
  lastIncidentDate: string | null;
  blockedReasons: string[];
  warnings: string[];
}

/**
 * Build the read-only risk summary for one route. `drainStatus` is the
 * optional live bucket (lyth_bridgeDrainStatus); when absent the summary
 * carries the static disclosure cap only.
 */
export function buildRouteRiskSummary(
  route: BridgeRouteDisclosure,
  drainStatus?: BridgeDrainStatus | null,
): BridgeRouteRiskSummary {
  const assessment = assessBridgeRoute(route);
  return {
    routeId: route.routeId,
    bridge: route.bridge,
    asset: route.asset,
    sourceChain: route.sourceChain,
    destinationChain: route.destinationChain,
    verifierModel: route.verifier.model,
    verifierThreshold: route.verifier.threshold,
    verifierParticipantCount: route.verifier.participantCount,
    riskTier: assessment.riskTier,
    score: assessment.score,
    drainCapAtomic: route.drainCapAtomic,
    drainRemaining: drainStatus ? drainStatus.remaining : null,
    circuitBreaker: route.circuitBreaker,
    insuranceAtomic: route.insuranceAtomic,
    lastIncidentDate: route.lastIncidentDate ?? null,
    blockedReasons: assessment.blockedReasons,
    warnings: assessment.warnings,
  };
}
