import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the RPC provider so the metadata fetch + cache are exercised without a
// live node.
const mrcMetadataFn = vi.fn();
vi.mock("../client", () => ({
  getProvider: () => ({ rpcClient: { lythMrcMetadata: mrcMetadataFn } }),
}));

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
});

describe("loadTokenMeta — fetch + cache", () => {
  it("maps decimals/symbol/name from the metadata row", async () => {
    mrcMetadataFn.mockResolvedValueOnce(metaResponse());
    const meta = await loadTokenMeta("0xtoken");
    expect(meta).toEqual({ decimals: 6, symbol: "TT", name: "Test Token" });
  });

  it("fetches once per asset id, then serves from cache (no refetch per render)", async () => {
    mrcMetadataFn.mockResolvedValue(metaResponse());
    await loadTokenMeta("0xtoken");
    await loadTokenMeta("0xtoken");
    await loadTokenMeta("0xtoken");
    expect(mrcMetadataFn).toHaveBeenCalledTimes(1);
  });

  it("returns all-null (→ em-dash) and does NOT cache a failed read (retriable)", async () => {
    mrcMetadataFn.mockRejectedValueOnce(new Error("rpc down"));
    expect(await loadTokenMeta("0xtoken")).toEqual(UNKNOWN_TOKEN_META);
    // A later successful read is not blocked by the failed one.
    mrcMetadataFn.mockResolvedValueOnce(metaResponse());
    expect(await loadTokenMeta("0xtoken")).toEqual({ decimals: 6, symbol: "TT", name: "Test Token" });
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
});

describe("loadTokenMetaMap — deduped batch", () => {
  it("fetches each distinct id once and keys the map by that id", async () => {
    mrcMetadataFn.mockImplementation(async (id: string) =>
      metaResponse({ assetId: id, symbol: id === "0xa" ? "AAA" : "BBB", decimals: id === "0xa" ? 6 : 18 }),
    );
    const map = await loadTokenMetaMap(["0xa", "0xb", "0xa", "0xb", "0xa"]);
    expect(mrcMetadataFn).toHaveBeenCalledTimes(2); // deduped
    expect(map.get("0xa")).toEqual({ decimals: 6, symbol: "AAA", name: "Test Token" });
    expect(map.get("0xb")).toEqual({ decimals: 18, symbol: "BBB", name: "Test Token" });
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
