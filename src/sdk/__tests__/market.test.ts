import { describe, expect, it } from "vitest";
import type { ApiStreamTopicMetadata, NativeMarketStateResponse } from "@monolythium/core-sdk";
import {
  compactAssetId,
  compactMarketId,
  findOrderBookStreamTopic,
  marketListingKnowledge,
  selectNativeSpotMarket,
  spotMarketLabel,
} from "../market";

function stateWithMarkets(markets: NativeMarketStateResponse["spotMarkets"]): NativeMarketStateResponse {
  return {
    schemaVersion: 1,
    limit: 25,
    filters: { includeSpotOrders: false },
    spotMarkets: markets,
    spotOrders: [],
    nftListings: [],
    collectionRoyalties: [],
    source: { indexerProvider: "native_market_state", projection: "native_market_state" },
  };
}

describe("native market helpers", () => {
  it("prefers current native spot market state over indexed summaries", () => {
    const selected = selectNativeSpotMarket(
      stateWithMarkets([
        {
          marketId: "market-native",
          owner: "mono1owner",
          baseAssetId: "LYTH",
          quoteAssetId: "USDL",
          tickSize: "1",
          lotSize: "1",
          minQuantity: "1",
          minNotional: "1",
          tradeCount: "3",
          totalVolumeBase: "10",
          lastPrice: "2",
          lastBlockHeight: 12,
          createdAtBlock: 1,
          updatedAtBlock: 12,
        },
      ]),
      [{ marketId: "market-summary", tradeCount: 1, totalVolumeBase: "1", lastPrice: "1", lastBlockHeight: 8 }],
    );

    expect(selected).toMatchObject({
      marketId: "market-native",
      label: "LYTH/USDL",
      source: "native-state",
    });
  });

  it("falls back to indexed summaries without fabricating a pair", () => {
    const selected = selectNativeSpotMarket(
      stateWithMarkets([]),
      [{ marketId: "0x1234567890abcdef1234567890abcdef", tradeCount: 1, totalVolumeBase: "1", lastPrice: "1", lastBlockHeight: 8 }],
    );

    expect(selected?.marketId).toBe("0x1234567890abcdef1234567890abcdef");
    expect(selected?.source).toBe("clob-summary");
    expect(selected?.label).toBe("0x1234567890...90abcdef");
  });

  it("returns null when no live market source has data", () => {
    expect(selectNativeSpotMarket(stateWithMarkets([]), [])).toBeNull();
    expect(selectNativeSpotMarket(null, null)).toBeNull();
  });

  it("compacts labels without changing short asset ids", () => {
    expect(spotMarketLabel({ baseAssetId: "LYTH", quoteAssetId: "USDL" })).toBe("LYTH/USDL");
    expect(compactAssetId("monos1abcdefghijklmno")).toBe("monos1abcd...jklmno");
    expect(compactMarketId("market-id-with-a-long-derived-hash")).toBe("market-id-wi...ved-hash");
  });

  it("detects the native order book stream topic", () => {
    const topics: ApiStreamTopicMetadata[] = [
      { topic: "newHeads", endpoint: "/api/v1/streams/newHeads" },
      {
        topic: "nativeMarketOrderBook",
        endpoint: "/api/v1/streams/nativeMarketOrderBook",
        retention: { kind: "live_broadcast", replay: true },
      },
    ];

    expect(findOrderBookStreamTopic(topics)?.retention?.replay).toBe(true);
    expect(findOrderBookStreamTopic([])).toBeNull();
  });
});

describe("market listing knowledge", () => {
  // "no market is listed" and "we could not read the market list" are
  // different facts. The wallet may state the first only when it actually
  // knows it; a failed read is an absence of knowledge and must never be
  // rendered as a confident zero.
  const both = { nativeOk: true, indexedOk: true };

  it("is loading before the first read resolves", () => {
    expect(marketListingKnowledge({ loaded: false, ...both, selected: false })).toBe("loading");
  });

  it("is listed when a market was selected", () => {
    expect(marketListingKnowledge({ loaded: true, ...both, selected: true })).toBe("listed");
  });

  it("is a confident none only when BOTH market reads succeeded", () => {
    expect(marketListingKnowledge({ loaded: true, ...both, selected: false })).toBe("none");
  });

  it("is unknown when the native market read failed", () => {
    expect(
      marketListingKnowledge({ loaded: true, nativeOk: false, indexedOk: true, selected: false }),
    ).toBe("unknown");
  });

  it("is unknown when the indexed market read failed", () => {
    expect(
      marketListingKnowledge({ loaded: true, nativeOk: true, indexedOk: false, selected: false }),
    ).toBe("unknown");
  });

  it("reports listed even if a read failed, because a selected market is proof", () => {
    // One read failing does not unmake a market we actually resolved.
    expect(
      marketListingKnowledge({ loaded: true, nativeOk: false, indexedOk: false, selected: true }),
    ).toBe("listed");
  });
});
