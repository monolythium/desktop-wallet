// Chain registry model: canonical keys, hardened narrowing, user-chain CRUD (the
// verbatim reject reasons + patch semantics), the active-chain lookup-miss guard,
// setActiveChain + subscribers, and the scope-key byte-identity pin (G2).
//
// build-mode + client are mocked so the test drives the build flag and observes
// the endpoint follow without a real RpcClient.

import { afterEach, describe, expect, it, vi } from "vitest";

const hardenedMock = vi.hoisted(() => ({ value: false }));
vi.mock("../build-mode", () => ({ isHardenedBuild: () => hardenedMock.value }));

const clientMock = vi.hoisted(() => ({ endpoint: "https://rpc.monolythium.com", setEndpoint: vi.fn() }));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  currentEndpoint: () => clientMock.endpoint,
  setEndpoint: (u: string) => {
    clientMock.setEndpoint(u);
    clientMock.endpoint = u;
  },
  isKnownEndpoint: (u: string) => u === "https://rpc.monolythium.com",
  resolveActiveEndpoint: () => "https://rpc.monolythium.com",
}));

import {
  ACTIVE_CHAIN_KEY,
  BUILTIN_CHAIN,
  BUILTIN_CHAIN_ID,
  USER_CHAINS_KEY,
  __resetChainsForTests,
  activeChainRecord,
  addUserChain,
  canonicalChainKey,
  chainRegistry,
  deleteUserChain,
  editUserChain,
  hardenedChains,
  readActiveChainId,
  readUserChains,
  scopeChainKey,
  setActiveChain,
  subscribeActiveChain,
  type ChainRecord,
} from "../chains";

afterEach(() => {
  hardenedMock.value = false;
  clientMock.endpoint = "https://rpc.monolythium.com";
  clientMock.setEndpoint.mockClear();
  localStorage.clear();
  __resetChainsForTests();
});

const custom = (over: Partial<ChainRecord> = {}): ChainRecord => ({
  chainId: "0x539",
  chainIdNum: 1337,
  name: "Local devnet",
  rpc: "http://localhost:8545",
  official: false,
  builtin: false,
  ...over,
});

describe("canonicalChainKey", () => {
  it("converts decimal to hex and uppercases hex after the prefix", () => {
    expect(canonicalChainKey(1337)).toBe("0x539");
    expect(canonicalChainKey("1337")).toBe("0x539");
    expect(canonicalChainKey("0x10f2c")).toBe("0x10F2C");
    expect(canonicalChainKey("0x10F2C")).toBe("0x10F2C");
  });

  it("rejects 0, negatives, NaN, and malformed input", () => {
    expect(canonicalChainKey("0x0")).toBeNull();
    expect(canonicalChainKey(0)).toBeNull();
    expect(canonicalChainKey(-5)).toBeNull();
    expect(canonicalChainKey("-5")).toBeNull();
    expect(canonicalChainKey(Number.NaN)).toBeNull();
    expect(canonicalChainKey("0x")).toBeNull();
    expect(canonicalChainKey("0xzz")).toBeNull();
    expect(canonicalChainKey("garbage")).toBeNull();
  });
});

describe("hardenedChains + chainRegistry", () => {
  const builtin = { [BUILTIN_CHAIN_ID]: BUILTIN_CHAIN };
  const user = { "0x539": custom() };

  it("hardened → builtin only; development → builtin + user (pure)", () => {
    expect(Object.keys(hardenedChains(builtin, user, true))).toEqual([BUILTIN_CHAIN_ID]);
    expect(Object.keys(hardenedChains(builtin, user, false)).sort()).toEqual(["0x539", BUILTIN_CHAIN_ID].sort());
  });

  it("a hardened build hides a stored custom chain WITHOUT deleting it", () => {
    localStorage.setItem(USER_CHAINS_KEY, JSON.stringify({ "0x539": custom() }));
    hardenedMock.value = true;
    expect(chainRegistry()[BUILTIN_CHAIN_ID]).toBeDefined();
    expect(chainRegistry()["0x539"]).toBeUndefined();
    // The storage is untouched — a development build still sees it.
    expect(readUserChains()["0x539"]).toBeDefined();
  });
});

describe("addUserChain — verbatim reasons + success", () => {
  it("returns each verbatim reject reason at its trigger", () => {
    expect(addUserChain({ chainId: "", name: "", rpc: "" })).toEqual({ ok: false, reason: "missing chainId, name, or rpc" });
    expect(addUserChain({ chainId: "539", name: "n", rpc: "http://x" })).toEqual({ ok: false, reason: "chainId must be 0x-prefixed hex" });
    expect(addUserChain({ chainId: "0x0", name: "n", rpc: "http://x" })).toEqual({ ok: false, reason: "chainId must be a positive integer" });
    expect(addUserChain({ chainId: "0x10F2C", name: "n", rpc: "http://x" })).toEqual({ ok: false, reason: "chain id already exists" });
    expect(addUserChain({ chainId: "0x539", name: "", rpc: "http://x" })).toEqual({ ok: false, reason: "missing chainId, name, or rpc" });
    expect(addUserChain({ chainId: "0x539", name: "n".repeat(65), rpc: "http://x" })).toEqual({ ok: false, reason: "name must be 1-64 chars" });
    expect(addUserChain({ chainId: "0x539", name: "n", rpc: "ftp://x" })).toEqual({ ok: false, reason: "rpc must be a valid URL" });
    expect(addUserChain({ chainId: "0x539", name: "n", rpc: "http://x", blockExplorer: "http://insecure" })).toEqual({ ok: false, reason: "blockExplorer must be a valid URL" });
  });

  it("collision detection is case-insensitive (hex casing: 0xabc vs 0xABC)", () => {
    expect(addUserChain({ chainId: "0xabc", name: "a", rpc: "http://x" }).ok).toBe(true);
    expect(addUserChain({ chainId: "0xABC", name: "b", rpc: "http://y" })).toEqual({ ok: false, reason: "chain id already exists" });
  });

  it("persists a custom chain (keyed by canonical id, non-builtin, non-official)", () => {
    const r = addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(r.ok).toBe(true);
    const stored = readUserChains()["0x539"]!;
    expect(stored).toMatchObject({ chainId: "0x539", chainIdNum: 1337, official: false, builtin: false });
  });
});

describe("editUserChain / deleteUserChain — reasons, builtin protection, patch semantics", () => {
  it("rejects editing/deleting the builtin chain at the storage layer", () => {
    expect(editUserChain(BUILTIN_CHAIN_ID, { name: "x" })).toEqual({ ok: false, reason: "cannot edit builtin chain" });
    expect(deleteUserChain(BUILTIN_CHAIN_ID)).toEqual({ ok: false, reason: "cannot delete builtin chain" });
    expect(deleteUserChain("69420")).toEqual({ ok: false, reason: "cannot delete builtin chain" });
  });

  it("rejects an unknown chain (edit + delete)", () => {
    expect(editUserChain("0x539", { name: "x" })).toEqual({ ok: false, reason: "unknown chain" });
    expect(deleteUserChain("0x539")).toEqual({ ok: false, reason: "unknown chain" });
    expect(editUserChain("", {})).toEqual({ ok: false, reason: "missing chainId or patch" });
  });

  it("patch semantics: blank explorer deletes; null currency deletes; objects set", () => {
    addUserChain({
      chainId: "0x539",
      name: "Local",
      rpc: "http://localhost:8545",
      blockExplorer: "https://scan.example",
      nativeCurrency: { name: "Local", symbol: "LOC", decimals: 9 },
    });
    const cleared = editUserChain("0x539", { blockExplorer: "", nativeCurrency: null });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.record.blockExplorer).toBeUndefined();
      expect(cleared.record.nativeCurrency).toBeUndefined();
    }
    const set = editUserChain("0x539", { name: "Renamed", rpc: "https://node.example" });
    expect(set.ok).toBe(true);
    if (set.ok) expect(set.record).toMatchObject({ name: "Renamed", rpc: "https://node.example" });
  });

  it("edit validators: bad name / rpc / explorer reject verbatim", () => {
    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(editUserChain("0x539", { name: "n".repeat(65) })).toEqual({ ok: false, reason: "name must be 1-64 chars" });
    expect(editUserChain("0x539", { rpc: "ws://bad" })).toEqual({ ok: false, reason: "rpc must be a valid URL" });
    expect(editUserChain("0x539", { blockExplorer: "http://insecure" })).toEqual({ ok: false, reason: "blockExplorer must be a valid URL" });
  });
});

describe("active chain — lookup-miss guard, setActiveChain, scope key", () => {
  it("a stored id that no longer resolves reads as the builtin WITHOUT persisting", () => {
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0xDEAD");
    expect(readActiveChainId()).toBe(BUILTIN_CHAIN_ID);
    expect(localStorage.getItem(ACTIVE_CHAIN_KEY)).toBe("0xDEAD"); // not overwritten
    expect(activeChainRecord().builtin).toBe(true);
  });

  it("setActiveChain rejects an unknown id", () => {
    expect(setActiveChain("0x539")).toEqual({ ok: false, reason: "unknown chain" });
  });

  it("activating the builtin persists it and fires subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribeActiveChain((id) => seen.push(id));
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0xDEAD");
    expect(setActiveChain(BUILTIN_CHAIN_ID)).toEqual({ ok: true });
    expect(localStorage.getItem(ACTIVE_CHAIN_KEY)).toBe(BUILTIN_CHAIN_ID); // explicitly persisted
    expect(seen).toEqual([BUILTIN_CHAIN_ID]);
    unsub();
  });

  it("activating a custom chain dials its rpc and fires subscribers", () => {
    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    const seen: string[] = [];
    subscribeActiveChain((id) => seen.push(id));
    expect(setActiveChain("1337")).toEqual({ ok: true });
    expect(clientMock.setEndpoint).toHaveBeenCalledWith("http://localhost:8545");
    expect(seen).toEqual(["0x539"]);
  });

  it("H8: activation notifies subscribers even when the endpoint is unchanged (shared RPC host)", () => {
    // A custom chain whose rpc equals the current endpoint — a real setEndpoint
    // would no-op, but the subscriber (which drives the rescope) MUST still fire.
    addUserChain({ chainId: "0x539", name: "Shared", rpc: "https://rpc.monolythium.com" });
    const seen: string[] = [];
    subscribeActiveChain((id) => seen.push(id));
    expect(setActiveChain("0x539").ok).toBe(true);
    expect(seen).toEqual(["0x539"]);
  });

  it("H9: a hardened build reverts the active chain to builtin WITHOUT persisting; stores survive", () => {
    localStorage.setItem(USER_CHAINS_KEY, JSON.stringify({ "0x539": custom() }));
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    hardenedMock.value = true;
    expect(readActiveChainId()).toBe(BUILTIN_CHAIN_ID); // custom hidden → builtin
    expect(localStorage.getItem(ACTIVE_CHAIN_KEY)).toBe("0x539"); // NOT written back
    expect(localStorage.getItem(USER_CHAINS_KEY)).not.toBeNull(); // survives for the next dev run
  });

  it("the builtin record pins nativeCurrency.decimals === 18 (1 LYTH = 10^18 lythoshi)", () => {
    expect(BUILTIN_CHAIN.nativeCurrency?.decimals).toBe(18);
  });

  it("scopeChainKey is byte-identical to '0x10f2c' for the builtin (G2 no-migration pin)", () => {
    expect(scopeChainKey()).toBe("0x10f2c");
  });

  it("scopeChainKey lowercases a custom canonical key", () => {
    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    expect(scopeChainKey()).toBe("0x539");
  });
});
