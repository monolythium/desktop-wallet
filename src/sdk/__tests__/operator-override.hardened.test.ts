// The hardened-build dial rule: overrideWithinFleet + hardenedOperators (the §4
// matrix) and the save-time hardened reject wired into writeOperatorOverride.
// build-mode + peers are mocked so the test drives the build flag and the
// canonical fleet directly.

import { afterEach, describe, expect, it, vi } from "vitest";

const hardenedMock = vi.hoisted(() => ({ value: false }));
vi.mock("../build-mode", () => ({ isHardenedBuild: () => hardenedMock.value }));

// A two-origin canonical fleet: one operator + the gateway.
vi.mock("../peers", async (orig) => ({
  ...(await orig<typeof import("../peers")>()),
  listPeers: () => [
    { url: "http://5.6.7.8:8545", label: "op-a", region: "fsn1", tier: "official" },
    { url: "https://rpc.monolythium.com", label: "gateway", region: null, tier: "gateway" },
  ],
}));

import {
  HARDENED_REJECT_REASON,
  OPERATOR_OVERRIDE_KEY,
  hardenedOperators,
  overrideWithinFleet,
  writeOperatorOverride,
  type OperatorEntry,
} from "../operator-override";

const FLEET = new Set(["http://5.6.7.8:8545", "https://rpc.monolythium.com"]);
const opA = (over: Partial<OperatorEntry> = {}): OperatorEntry => ({
  name: "op-a",
  region: "fsn1",
  rpc: "http://5.6.7.8:8545",
  ...over,
});
const defaults: OperatorEntry[] = [opA(), { name: "gateway", region: "", rpc: "https://rpc.monolythium.com" }];

afterEach(() => {
  hardenedMock.value = false;
  localStorage.clear();
});

describe("overrideWithinFleet (matched by origin)", () => {
  it("a renamed / blank-region entry on a fleet origin passes (path ignored)", () => {
    expect(overrideWithinFleet(FLEET, [opA({ name: "mine", region: "", rpc: "http://5.6.7.8:8545/rpc" })])).toBe(true);
  });

  it("a different port or scheme on the same host fails", () => {
    expect(overrideWithinFleet(FLEET, [opA({ rpc: "http://5.6.7.8:9999" })])).toBe(false);
    expect(overrideWithinFleet(FLEET, [opA({ rpc: "https://5.6.7.8:8545" })])).toBe(false);
  });

  it("a subset passes; one foreign host fails the whole list", () => {
    expect(overrideWithinFleet(FLEET, [{ name: "g", region: "", rpc: "https://rpc.monolythium.com" }])).toBe(true);
    expect(overrideWithinFleet(FLEET, [opA(), opA({ rpc: "http://9.9.9.9:8545" })])).toBe(false);
  });
});

describe("hardenedOperators — the §4 matrix", () => {
  const override = [opA({ name: "reordered" })];
  const foreign = [opA({ rpc: "http://9.9.9.9:8545" })];

  it("development + a valid override → the override verbatim", () => {
    expect(hardenedOperators(defaults, override, false)).toEqual(override);
  });

  it("hardened + null/empty override → defaults", () => {
    expect(hardenedOperators(defaults, null, true)).toEqual(defaults);
    expect(hardenedOperators(defaults, [], true)).toEqual(defaults);
  });

  it("hardened + a within-fleet override → honored verbatim (reorder/pin/subset)", () => {
    expect(hardenedOperators(defaults, override, true)).toEqual(override);
  });

  it("hardened + ANY out-of-fleet host → the whole override is ignored → defaults", () => {
    expect(hardenedOperators(defaults, foreign, true)).toEqual(defaults);
  });

  it("always returns fresh copies (mutating the result never mutates inputs)", () => {
    const out = hardenedOperators(defaults, override, false);
    out[0]!.name = "mutated";
    expect(override[0]!.name).toBe("reordered");
  });
});

describe("writeOperatorOverride — the hardened save gate", () => {
  it("hardened + out-of-fleet → the verbatim hardened reject, nothing persisted", () => {
    hardenedMock.value = true;
    expect(writeOperatorOverride([opA({ rpc: "http://9.9.9.9:8545" })])).toEqual({
      ok: false,
      reason: HARDENED_REJECT_REASON,
    });
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).toBeNull();
  });

  it("hardened + within-fleet → persists", () => {
    hardenedMock.value = true;
    expect(writeOperatorOverride([opA({ name: "reordered" })])).toEqual({ ok: true });
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).not.toBeNull();
  });

  it("development + out-of-fleet → persists (the gate is hardened-only)", () => {
    hardenedMock.value = false;
    expect(writeOperatorOverride([opA({ rpc: "http://9.9.9.9:8545" })])).toEqual({ ok: true });
  });
});
