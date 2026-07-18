// The effective-fleet seam: activeFleet() composition (defaults / override /
// hardened narrowing / custom chain / de-dupe) and the fleet-aware endpoint
// policy registered into client.ts (isKnownEndpoint + resolveActiveEndpoint).
//
// build-mode + peers are mocked; chains + operator-override are real, driven via
// localStorage, so the composition is exercised end-to-end.

import { afterEach, describe, expect, it, vi } from "vitest";

const hardenedMock = vi.hoisted(() => ({ value: false }));
vi.mock("../build-mode", () => ({ isHardenedBuild: () => hardenedMock.value }));

const GATEWAY = "https://rpc.monolythium.com";
const OP_A = "http://5.6.7.8:8545";
vi.mock("../peers", async (orig) => ({
  ...(await orig<typeof import("../peers")>()),
  listPeers: () => [
    { url: GATEWAY, label: "Public gateway", region: null, tier: "gateway" },
    { url: OP_A, label: "op-a", region: "fsn1", tier: "official" },
  ],
}));

import { activeFleet, operatorOverrideActive } from "../fleet";
import { isKnownEndpoint, resolveActiveEndpoint } from "../client";
import { OPERATOR_OVERRIDE_KEY, type OperatorEntry } from "../operator-override";
import { ACTIVE_CHAIN_KEY, USER_CHAINS_KEY, type ChainRecord } from "../chains";
import { RPC_ENDPOINT_KEY } from "../peers";

const setOverride = (list: OperatorEntry[]) => localStorage.setItem(OPERATOR_OVERRIDE_KEY, JSON.stringify(list));
const IN_FLEET: OperatorEntry = { name: "mine", region: "", rpc: OP_A };
const FOREIGN: OperatorEntry = { name: "mine", region: "", rpc: "http://9.9.9.9:8545" };

afterEach(() => {
  hardenedMock.value = false;
  localStorage.clear();
});

describe("activeFleet", () => {
  it("no override → listPeers() verbatim (tiers preserved)", () => {
    expect(activeFleet()).toEqual([
      { url: GATEWAY, label: "Public gateway", region: null, tier: "gateway" },
      { url: OP_A, label: "op-a", region: "fsn1", tier: "official" },
    ]);
  });

  it("development + override → the override verbatim (as custom-tier peers)", () => {
    setOverride([FOREIGN]);
    expect(activeFleet()).toEqual([{ url: "http://9.9.9.9:8545", label: "mine", region: null, tier: "custom" }]);
  });

  it("a known default URL in an override keeps its real tier", () => {
    setOverride([IN_FLEET]);
    expect(activeFleet()).toEqual([{ url: OP_A, label: "op-a", region: "fsn1", tier: "official" }]);
  });

  it("the hardened narrowing runs at EVERY call (flip the flag between calls)", () => {
    setOverride([FOREIGN]);
    expect(activeFleet().map((p) => p.url)).toEqual(["http://9.9.9.9:8545"]); // dev honors it
    hardenedMock.value = true;
    expect(activeFleet().map((p) => p.url)).toEqual([GATEWAY, OP_A]); // hardened → defaults
    // The stored value is NOT deleted — a development build still honors it.
    expect(localStorage.getItem(OPERATOR_OVERRIDE_KEY)).not.toBeNull();
  });

  it("de-dupes duplicate override URLs (first occurrence wins)", () => {
    setOverride([
      { name: "first", region: "", rpc: "http://dup:8545" },
      { name: "second", region: "", rpc: "http://dup:8545" },
    ]);
    const fleet = activeFleet();
    expect(fleet).toHaveLength(1);
    expect(fleet[0]!.label).toBe("first");
  });

  it("a custom chain active → exactly one custom-tier Peer for its rpc", () => {
    const chain: ChainRecord = {
      chainId: "0x539",
      chainIdNum: 1337,
      name: "Local devnet",
      rpc: "http://localhost:8545",
      official: false,
      builtin: false,
    };
    localStorage.setItem(USER_CHAINS_KEY, JSON.stringify({ "0x539": chain }));
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    expect(activeFleet()).toEqual([{ url: "http://localhost:8545", label: "Local devnet", region: null, tier: "custom" }]);
  });
});

describe("operatorOverrideActive", () => {
  it("false with no override; true with a dev override; false when narrowed away", () => {
    expect(operatorOverrideActive()).toBe(false);
    setOverride([FOREIGN]);
    expect(operatorOverrideActive()).toBe(true);
    hardenedMock.value = true; // narrowed back to defaults
    expect(operatorOverrideActive()).toBe(false);
  });
});

describe("fleet-aware endpoint policy (registered into client.ts)", () => {
  it("isKnownEndpoint accepts an override member in dev and rejects it under hardened narrowing", () => {
    setOverride([FOREIGN]);
    expect(isKnownEndpoint("http://9.9.9.9:8545")).toBe(true); // dev honors the override
    hardenedMock.value = true;
    expect(isKnownEndpoint("http://9.9.9.9:8545")).toBe(false); // narrowed away
    expect(isKnownEndpoint(GATEWAY)).toBe(true); // the default set remains known
  });

  it("resolveActiveEndpoint precedence: env > custom chain rpc > dev proxy > fleet-known persisted > gateway", () => {
    // env override wins over everything
    expect(resolveActiveEndpoint({ VITE_MONO_RPC_URL: "https://env.example", DEV: true })).toBe("https://env.example");

    // gateway is the floor
    expect(resolveActiveEndpoint({ DEV: false })).toBe(GATEWAY);

    // dev proxy when nothing else applies
    expect(resolveActiveEndpoint({ DEV: true })).toBe("/rpc");

    // fleet-known persisted selection (an override host) wins over the gateway
    setOverride([FOREIGN]);
    localStorage.setItem(RPC_ENDPOINT_KEY, "http://9.9.9.9:8545");
    expect(resolveActiveEndpoint({ DEV: false })).toBe("http://9.9.9.9:8545");
    localStorage.removeItem(RPC_ENDPOINT_KEY);
    localStorage.removeItem(OPERATOR_OVERRIDE_KEY);

    // an active custom chain's rpc outranks the dev proxy
    const chain: ChainRecord = {
      chainId: "0x539",
      chainIdNum: 1337,
      name: "Local",
      rpc: "http://localhost:8545",
      official: false,
      builtin: false,
    };
    localStorage.setItem(USER_CHAINS_KEY, JSON.stringify({ "0x539": chain }));
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    expect(resolveActiveEndpoint({ DEV: true })).toBe("http://localhost:8545");
  });
});
