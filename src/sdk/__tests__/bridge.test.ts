import { describe, expect, it } from "vitest";
import type { BridgeRouteDisclosure } from "@monolythium/core-sdk";
import { assessRoute, buildRouteRiskSummary } from "../bridge";

// A fully-conforming Chainlink CCIP route: LINK fee token, 2-of-3 verifier,
// positive drain cap + insurance, finality + cooldown set, consensus-only
// admin control, armed breaker, no incident → SDK scores 100 → "low".
function validRoute(): BridgeRouteDisclosure {
  return {
    routeId: "route-1",
    bridge: "Chainlink CCIP",
    protocol: "chainlink-ccip",
    asset: "monoUSDC",
    feeToken: "LINK",
    sourceChain: "ethereum",
    destinationChain: "monolythium",
    verifier: { model: "chainlink-ccip", participantCount: 3, threshold: 2 },
    drainCapAtomic: "1000000000000000000000",
    finalityBlocks: 64,
    cooldownSeconds: 7200,
    adminControl: "consensusOnly",
    circuitBreaker: "armed",
    insuranceAtomic: "5000000000000000000000",
    lastIncidentDate: null,
  };
}

describe("bridge risk assessment", () => {
  it("rates a fully-conforming CCIP route as low risk", () => {
    const assessment = assessRoute(validRoute());
    expect(assessment.accepted).toBe(true);
    expect(assessment.riskTier).toBe("low");
    expect(assessment.blockedReasons).toHaveLength(0);
  });

  it("maps a paused circuit breaker to riskTier 'blocked'", () => {
    const paused: BridgeRouteDisclosure = {
      ...validRoute(),
      circuitBreaker: "paused",
    };
    const assessment = assessRoute(paused);
    expect(assessment.accepted).toBe(false);
    expect(assessment.riskTier).toBe("blocked");
    expect(assessment.blockedReasons).toContain("route circuit breaker is paused");
  });

  it("blocks a 1-of-1 verifier set", () => {
    const solo: BridgeRouteDisclosure = {
      ...validRoute(),
      verifier: { model: "chainlink-ccip", participantCount: 1, threshold: 1 },
    };
    expect(assessRoute(solo).riskTier).toBe("blocked");
  });

  it("flattens the disclosure + live drain bucket into a risk summary", () => {
    const route = validRoute();
    const summary = buildRouteRiskSummary(route, {
      schemaVersion: 1,
      source: "native_state_storage",
      precompile: "0x1008",
      bridgeId: "0xabc",
      wrappedAsset: "monoUSDC",
      capPerWindow: "1000",
      windowBlocks: 100,
      currentBucket: 1,
      drainedThisBucket: "250",
      remaining: "750",
      bridgeDefault: { drainCapPerWindow: "0x0", drainWindowBlocks: 0 },
    });
    expect(summary.routeId).toBe("route-1");
    expect(summary.riskTier).toBe("low");
    expect(summary.drainRemaining).toBe("750");
    expect(summary.circuitBreaker).toBe("armed");
    expect(summary.verifierModel).toBe("chainlink-ccip");
  });

  it("carries a null drain remaining when no live bucket is supplied", () => {
    const summary = buildRouteRiskSummary(validRoute());
    expect(summary.drainRemaining).toBeNull();
  });
});
