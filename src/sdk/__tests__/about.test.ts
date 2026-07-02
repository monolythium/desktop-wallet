import { describe, expect, it } from "vitest";
import {
  activeFeatureChips,
  operatorsSummary,
  WALLET_TAGLINE,
  WALLET_TITLE,
  type FeatureFlagState,
} from "../about";
import type { ProbeResult } from "../peers";

const ALL_OFF: FeatureFlagState = {
  experimental: false,
  stele: false,
  developer: false,
  incoming: false,
  notifications: false,
  notificationDetails: false,
  notifyWhileLocked: false,
};

function probe(reachable: boolean, chainIdOk: boolean): ProbeResult {
  return { url: "x", reachable, latencyMs: 1, chainIdOk };
}

describe("identity copy", () => {
  it("is a plain self-description — no banned framing", () => {
    const copy = `${WALLET_TITLE} ${WALLET_TAGLINE}`.toLowerCase();
    expect(WALLET_TITLE).toBe("Monolythium Wallet");
    expect(copy).not.toContain("browser");
    expect(copy).not.toContain("reference implementation");
  });
});

describe("activeFeatureChips", () => {
  it("renders no chip when every flag is off", () => {
    expect(activeFeatureChips(ALL_OFF)).toEqual([]);
  });

  it("renders a labelled chip only for the enabled flags, in a stable order", () => {
    const chips = activeFeatureChips({
      ...ALL_OFF,
      developer: true,
      experimental: true,
    });
    // Order follows the chip map: experimental before developer.
    expect(chips.map((c) => c.id)).toEqual(["experimental", "developer"]);
    expect(chips.every((c) => c.label.length > 0)).toBe(true);
  });
});

describe("operatorsSummary", () => {
  it("counts only endpoints reachable AND on the right chain", () => {
    const results = [
      probe(true, true), // live
      probe(true, true), // live
      probe(true, false), // reachable but wrong chain — not live
      probe(false, false), // unreachable
    ];
    const summary = operatorsSummary(results, 5);
    expect(summary.live).toBe(2);
    expect(summary.total).toBe(5);
    expect(summary.label).toBe("2 of 5 endpoints live on chain 69420");
  });

  it("is honest about zero live endpoints (no fabrication)", () => {
    const summary = operatorsSummary([probe(false, false)], 3);
    expect(summary.live).toBe(0);
    expect(summary.label).toContain("0 of 3");
  });
});
