import { beforeEach, describe, expect, it, vi } from "vitest";

// Not hardened + a stubbed endpoint seam so setActiveChain resolves without a
// node, for the per-chain scoping test below.
vi.mock("../build-mode", () => ({ isHardenedBuild: () => false }));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  setEndpoint: () => {},
  isKnownEndpoint: () => true,
  resolveActiveEndpoint: () => "https://rpc.monolythium.com",
}));

import {
  BUILTIN_CHAIN_ID,
  __resetChainsForTests,
  addUserChain,
  setActiveChain,
} from "../chains";
import {
  mergeMyNames,
  readRegisteredNames,
  recordRegisteredName,
} from "../my-names";

describe("mergeMyNames — honest, no fabricated owned-names list", () => {
  it("flags the chain reverse-latest and appends local records, deduped", () => {
    const entries = mergeMyNames("alice.mono", ["alice.mono", "bot.agent.alice.mono"]);
    expect(entries).toEqual([
      { name: "alice.mono", reverseLatest: true },
      { name: "bot.agent.alice.mono", reverseLatest: false },
    ]);
  });

  it("with no reverse name, shows only the device records (none authoritative)", () => {
    expect(mergeMyNames(null, ["x.mono"])).toEqual([{ name: "x.mono", reverseLatest: false }]);
  });

  it("is empty when there's nothing known — never invents a name", () => {
    expect(mergeMyNames(null, [])).toEqual([]);
    expect(mergeMyNames("", [])).toEqual([]);
  });
});

describe("my-names device store — records a real action, per owner", () => {
  beforeEach(() => localStorage.clear());

  it("records and reads back a registered name (case-folded), scoped by owner", () => {
    recordRegisteredName("mono1alice", "Alice.MONO");
    expect(readRegisteredNames("mono1alice")).toEqual(["alice.mono"]);
    // A different owner has its own set.
    expect(readRegisteredNames("mono1bob")).toEqual([]);
  });

  it("dedupes repeat records", () => {
    recordRegisteredName("mono1alice", "alice.mono");
    recordRegisteredName("mono1alice", "alice.mono");
    expect(readRegisteredNames("mono1alice")).toEqual(["alice.mono"]);
  });

  it("returns empty for an unknown owner / blank input", () => {
    expect(readRegisteredNames("")).toEqual([]);
    recordRegisteredName("", "x.mono");
    expect(readRegisteredNames("mono1alice")).toEqual([]);
  });
});

describe("my-names device store — per-chain isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetChainsForTests();
  });

  it("a name recorded on one chain does not appear on another (both directions)", () => {
    recordRegisteredName("mono1alice", "builtin.mono"); // builtin chain

    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(setActiveChain("0x539").ok).toBe(true);
    // Fresh chain: no leak from the builtin.
    expect(readRegisteredNames("mono1alice")).toEqual([]);
    recordRegisteredName("mono1alice", "custom.mono");
    expect(readRegisteredNames("mono1alice")).toEqual(["custom.mono"]);

    // Back to the builtin: its own entry intact, the custom chain's absent.
    expect(setActiveChain(BUILTIN_CHAIN_ID).ok).toBe(true);
    expect(readRegisteredNames("mono1alice")).toEqual(["builtin.mono"]);
  });
});
