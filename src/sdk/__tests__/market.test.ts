import { describe, expect, it } from "vitest";
import type { ApiStreamTopicMetadata, NativeMarketStateResponse } from "@monolythium/core-sdk";
import {
  compactAssetId,
  compactMarketId,
  findOrderBookStreamTopic,
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
