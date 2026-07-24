// purgeScopesForAddress — the vault-removal cleanup for the reverse-name cache.
//
// A removed vault must leave no resolved counterparty names behind, across every
// chain it touched. The purge is exact-prefix with a trailing dot, so one
// address never purges another that is a prefix of it.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Not-hardened so custom chains can be added; stub the client endpoint seam so
// setActiveChain resolves without a node. (Same shape as chain-scope-isolation.)
vi.mock("../build-mode", () => ({ isHardenedBuild: () => false }));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  setEndpoint: () => {},
  isKnownEndpoint: () => true,
  resolveActiveEndpoint: () => "https://rpc.monolythium.com",
}));

import { __resetChainsForTests, addUserChain, scopeChainKey, setActiveChain } from "../chains";
import {
  __resetReverseNameCacheForTest,
  purgeScopesForAddress,
  reverseNameCacheSnapshot,
  reverseNameKey,
  writeReverseName,
} from "../reverse-name-cache";

const keysFor = (addr: string): string[] =>
  Object.keys(reverseNameCacheSnapshot().reverse).filter((k) =>
    k.startsWith(`mono.name.reverse.${addr}.`),
  );

beforeEach(() => {
  localStorage.clear();
  __resetReverseNameCacheForTest();
  __resetChainsForTests();
});

describe("purgeScopesForAddress", () => {
  it("removes the address's entries across ALL chains, leaving other addresses", async () => {
    // Builtin-chain entries for two addresses…
    await writeReverseName("mono1gone", "alice.mono", 1_000);
    await writeReverseName("mono1keep", "carol.mono", 1_000);
    // …and a second chain's entry for the doomed address.
    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(setActiveChain("0x539").ok).toBe(true);
    await writeReverseName("mono1gone", "bob.mono", 1_000);
    expect(keysFor("mono1gone")).toHaveLength(2); // builtin + custom

    await purgeScopesForAddress("mono1gone");

    expect(keysFor("mono1gone")).toEqual([]); // both chains gone
    expect(keysFor("mono1keep")).toHaveLength(1); // untouched
  });

  it("trailing dot: a prefix address never purges a longer one", async () => {
    await writeReverseName("mono1a", "a.mono", 1_000);
    await writeReverseName("mono1aa", "aa.mono", 1_000);

    await purgeScopesForAddress("mono1a");

    expect(reverseNameCacheSnapshot().reverse[reverseNameKey("mono1a", scopeChainKey())]).toBeUndefined();
    expect(reverseNameCacheSnapshot().reverse[reverseNameKey("mono1aa", scopeChainKey())]).toBeDefined();
  });

  it("is a no-op for an empty scope", async () => {
    await writeReverseName("mono1keep", "carol.mono", 1_000);
    await purgeScopesForAddress("");
    expect(keysFor("mono1keep")).toHaveLength(1);
  });
});
