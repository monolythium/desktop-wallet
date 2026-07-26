import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the RPC provider so the metadata fetch + cache are exercised without a
// live node. Spread the real module so the endpoint constants chains.ts reads at
// import time (reached transitively now that token-metadata subscribes to chain
// switches) stay defined; stub the provider + endpoint seams.
const mrcMetadataFn = vi.fn();
vi.mock("../build-mode", () => ({ isHardenedBuild: () => false }));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  getProvider: () => ({ rpcClient: { lythMrcMetadata: mrcMetadataFn } }),
  currentEndpoint: () => "https://rpc.monolythium.com",
  setEndpoint: () => {},
  isKnownEndpoint: () => true,
  resolveActiveEndpoint: () => "https://rpc.monolythium.com",
}));

import { addUserChain, setActiveChain } from "../chains";
import {
  clearTokenMetaCache,
  loadTokenMeta,
  loadTokenMetaMap,
  tokenAmountDisplay,
  UNKNOWN_TOKEN_META,
} from "../token-metadata";

function metaResponse(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    assetId: "0xtoken",
    tokenId: null,
    metadata: {
      standard: "mrc20",
      assetId: "0xtoken",
      tokenId: null,
      name: "Test Token",
      symbol: "TT",
      decimals: 6,
      uri: null,
      updatedAtBlock: 100,
      ...over,
    },
  };
}

beforeEach(() => {
  mrcMetadataFn.mockReset();
  clearTokenMetaCache();
  // Reset the active-chain selection WITHOUT __resetChainsForTests: that clears
  // the subscriber list, which would drop token-metadata's module-level
  // clear-on-switch subscription (registered once at import).
  localStorage.clear();
});

describe("loadTokenMeta — fetch + cache", () => {
  it("maps decimals/symbol/name/standard from the metadata row", async () => {
    mrcMetadataFn.mockResolvedValueOnce(metaResponse());
    const meta = await loadTokenMeta("0xtoken");
    expect(meta).toEqual({ decimals: 6, symbol: "TT", name: "Test Token", standard: "mrc20" });
  });

  it("fetches once per asset id, then serves from cache (no refetch per render)", async () => {
    mrcMetadataFn.mockResolvedValue(metaResponse());
    await loadTokenMeta("0xtoken");
    await loadTokenMeta("0xtoken");
    await loadTokenMeta("0xtoken");
    expect(mrcMetadataFn).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after an active-chain switch (the cache is cleared, not carried)", async () => {
    // The invalidation this closes: an assetId cached on one chain must not
    // scale/label another chain's balance after a switch.
    mrcMetadataFn.mockResolvedValue(metaResponse());
    await loadTokenMeta("0xtoken");
    await loadTokenMeta("0xtoken");
    expect(mrcMetadataFn).toHaveBeenCalledTimes(1); // cached within the chain

    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(setActiveChain("0x539").ok).toBe(true); // fires the cache-clear subscription

    await loadTokenMeta("0xtoken");
    expect(mrcMetadataFn).toHaveBeenCalledTimes(2); // re-fetched on the new chain
  });

  it("returns all-null (→ em-dash) and does NOT cache a failed read (retriable)", async () => {
    mrcMetadataFn.mockRejectedValueOnce(new Error("rpc down"));
    expect(await loadTokenMeta("0xtoken")).toEqual(UNKNOWN_TOKEN_META);
    // A later successful read is not blocked by the failed one.
    mrcMetadataFn.mockResolvedValueOnce(metaResponse());
    expect(await loadTokenMeta("0xtoken")).toEqual({
      decimals: 6,
      symbol: "TT",
      name: "Test Token",
      standard: "mrc20",
    });
    expect(mrcMetadataFn).toHaveBeenCalledTimes(2);
  });

  it("returns all-null and does NOT cache an absent metadata row (folds in later)", async () => {
    mrcMetadataFn.mockResolvedValueOnce({ schemaVersion: 1, assetId: "0xtoken", tokenId: null, metadata: null });
    expect(await loadTokenMeta("0xtoken")).toEqual(UNKNOWN_TOKEN_META);
    mrcMetadataFn.mockResolvedValueOnce(metaResponse());
    expect((await loadTokenMeta("0xtoken")).decimals).toBe(6);
    expect(mrcMetadataFn).toHaveBeenCalledTimes(2);
  });

  it("carries a null decimals through when the row omits it (unknown scale)", async () => {
    mrcMetadataFn.mockResolvedValueOnce(metaResponse({ decimals: null }));
    expect((await loadTokenMeta("0xtoken")).decimals).toBeNull();
  });

  it("carries the standard through so the send gate can exclude non-mrc20", async () => {
    mrcMetadataFn.mockResolvedValueOnce(metaResponse({ standard: "mrc721", decimals: null }));
    const meta = await loadTokenMeta("0xtoken");
    expect(meta.standard).toBe("mrc721");
    expect(meta.decimals).toBeNull();
  });
});

describe("loadTokenMetaMap — deduped batch", () => {
  it("fetches each distinct id once and keys the map by that id", async () => {
    mrcMetadataFn.mockImplementation(async (id: string) =>
      metaResponse({ assetId: id, symbol: id === "0xa" ? "AAA" : "BBB", decimals: id === "0xa" ? 6 : 18 }),
    );
    const map = await loadTokenMetaMap(["0xa", "0xb", "0xa", "0xb", "0xa"]);
    expect(mrcMetadataFn).toHaveBeenCalledTimes(2); // deduped
    expect(map.get("0xa")).toEqual({ decimals: 6, symbol: "AAA", name: "Test Token", standard: "mrc20" });
    expect(map.get("0xb")).toEqual({ decimals: 18, symbol: "BBB", name: "Test Token", standard: "mrc20" });
  });
});

describe("tokenAmountDisplay — honest fallback (no silently-wrong human figure)", () => {
  it("scales to the human amount when decimals are known", () => {
    expect(tokenAmountDisplay("1500000", { decimals: 6, symbol: "TT", name: null })).toBe("1.5");
    expect(tokenAmountDisplay("1000000000000000000", { decimals: 18, symbol: "TT", name: null })).toBe("1");
  });

  it("returns null (→ em-dash) when decimals are unknown — never a raw base-units figure", () => {
    expect(tokenAmountDisplay("1500000", { decimals: null, symbol: "TT", name: null })).toBeNull();
    expect(tokenAmountDisplay("1500000", null)).toBeNull();
    expect(tokenAmountDisplay("1500000", UNKNOWN_TOKEN_META)).toBeNull();
  });

  it("returns null for an undecodable balance", () => {
    expect(tokenAmountDisplay("not-a-number", { decimals: 6, symbol: null, name: null })).toBeNull();
    expect(tokenAmountDisplay(null, { decimals: 6, symbol: null, name: null })).toBeNull();
  });
});
