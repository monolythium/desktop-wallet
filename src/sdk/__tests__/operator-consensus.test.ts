import { afterEach, describe, expect, it } from "vitest";
import {
  bpsPct,
  deriveOperatorRiskTier,
  loadOperatorRisk,
  loadSigningActivity,
  loadUpcomingDuties,
  signingPill,
} from "../operator-consensus";
import {
  markActiveOperatorTrusted,
  markActiveOperatorUntrusted,
  resetProviderForTest,
} from "../client";
import type { OperatorRiskResponse } from "@monolythium/core-sdk";

function risk(over: Partial<OperatorRiskResponse> = {}): OperatorRiskResponse {
  return {
    schemaVersion: 1, authorityIndex: 0, dataHeight: 100n, windowRounds: 200,
    missedRounds: 0, observedRounds: 200, missRateBps: 0, thresholdBps: 500,
    remainingHeadroomBps: 500, jailStatus: { reason: "not-tracked" }, reasons: [],
    ...over,
  } as unknown as OperatorRiskResponse;
}
const jailed = (over = {}) => ({ jailed: false, tombstoned: false, jailedUntilHeight: 0n, unjailCount: 0n, ...over });

describe("deriveOperatorRiskTier", () => {
  it("jailed or tombstoned (window shape) → err", () => {
    expect(deriveOperatorRiskTier(risk({ jailStatus: jailed({ jailed: true }) }))).toBe("err");
    expect(deriveOperatorRiskTier(risk({ jailStatus: jailed({ tombstoned: true }) }))).toBe("err");
  });

  it("thresholdBps 0 → ok (nothing to be near)", () => {
    expect(deriveOperatorRiskTier(risk({ thresholdBps: 0, missRateBps: 999 }))).toBe("ok");
  });

  it("miss >= threshold → err", () => {
    expect(deriveOperatorRiskTier(risk({ missRateBps: 500, thresholdBps: 500 }))).toBe("err");
  });

  it("headroom strictly below threshold/4 → warn; exactly threshold/4 → not warn", () => {
    // threshold 400 → threshold/4 = 100
    expect(deriveOperatorRiskTier(risk({ thresholdBps: 400, missRateBps: 0, remainingHeadroomBps: 99 }))).toBe("warn");
    expect(deriveOperatorRiskTier(risk({ thresholdBps: 400, missRateBps: 0, remainingHeadroomBps: 100 }))).toBe("ok");
  });

  it("reasons present → warn", () => {
    expect(deriveOperatorRiskTier(risk({ reasons: ["slow"] }))).toBe("warn");
  });

  it("an absence-shaped jailStatus never influences the tier", () => {
    // {reason} shape + otherwise healthy → ok (not err).
    expect(deriveOperatorRiskTier(risk({ jailStatus: { reason: "not-tracked" } }))).toBe("ok");
  });
});

describe("signingPill", () => {
  it("maps known statuses and falls back to a generic pill", () => {
    expect(signingPill("signed").label).toBe("Signing (latest cert healthy)");
    expect(signingPill("maintenance").color).toBe("var(--fg-300)");
    expect(signingPill("delayed").label).toBe("Delayed — round behind");
    expect(signingPill("offline").color).toBe("var(--err)");
    expect(signingPill("no_cert").label).toBe("No cert this round");
    expect(signingPill("weird_new_status").label).toBe("Status: weird_new_status");
  });
});

describe("bpsPct", () => {
  it("renders basis points as a 2-decimal percent", () => {
    expect(bpsPct(123)).toBe("1.23");
    expect(bpsPct(50)).toBe("0.50");
    expect(bpsPct(500)).toBe("5.00");
  });
});

describe("consensus loaders hide while the wallet is fail-closed", () => {
  afterEach(() => {
    markActiveOperatorTrusted();
    resetProviderForTest();
  });

  it("resolve null (not throw) when getProvider refuses a degraded operator", async () => {
    markActiveOperatorUntrusted("regenesis");
    expect(await loadSigningActivity()).toBeNull();
    expect(await loadOperatorRisk()).toBeNull();
    expect(await loadUpcomingDuties()).toBeNull();
  });
});
