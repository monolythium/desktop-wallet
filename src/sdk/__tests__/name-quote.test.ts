import { describe, expect, it, vi } from "vitest";

// Mock the RPC provider so loadNameQuote's formatting + failure paths are
// exercised without a live node. Spread the real module so its other exports
// (the endpoint constants chains.ts reads at import time, reached transitively
// via name-registry → submit) stay defined; only getProvider is stubbed.
const quoteFn = vi.fn();
vi.mock("../client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client")>()),
  getProvider: () => ({ rpcClient: { quoteNameRegistration: quoteFn } }),
}));

import {
  NAME_FALLBACK_FEE_UNIT_LYTHOSHI,
  nameRegistrationCost,
} from "@monolythium/core-sdk";
import { loadNameQuote } from "../name-registry";

describe("loadNameQuote — real chain quote, never the 0.05 placeholder", () => {
  it("formats the SDK cost as a real LYTH value (not 0.05)", async () => {
    // 6–12-char human at the fallback fee unit: 5 × 10 × 1e12 / 10 = 5e12 lythoshi.
    const cost = nameRegistrationCost("human", 8, NAME_FALLBACK_FEE_UNIT_LYTHOSHI);
    quoteFn.mockResolvedValueOnce({ costLythoshi: cost });
    const q = await loadNameQuote("alice.mono");
    expect(q).not.toBeNull();
    // 5e12 lythoshi = 0.000005 LYTH — the real U-curve, ~50,000× below the old 0.05.
    expect(q!.costLyth).toBe("0.000005");
    expect(q!.costLyth).not.toBe("0.05");
  });

  it("returns null (→ honest em-dash) when the quote read fails", async () => {
    quoteFn.mockRejectedValueOnce(new Error("rpc down"));
    expect(await loadNameQuote("alice.mono")).toBeNull();
  });
});

describe("nameRegistrationCost — the real U-curve, not a flat placeholder", () => {
  const unit = NAME_FALLBACK_FEE_UNIT_LYTHOSHI;
  it("varies by length (U-curve) and category — a fixed 0.05 never would", () => {
    // 1-char human is far pricier than a 6–12-char human (U-curve extremes).
    expect(nameRegistrationCost("human", 1, unit)).toBeGreaterThan(
      nameRegistrationCost("human", 8, unit),
    );
    // cluster (20×) costs more than human (5×) at the same length.
    expect(nameRegistrationCost("cluster", 8, unit)).toBeGreaterThan(
      nameRegistrationCost("human", 8, unit),
    );
  });
});
