import { NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC } from "@monolythium/core-sdk";
import type {
  ApiStreamTopicMetadata,
  ClobMarketSummary,
  NativeMarketStateResponse,
  NativeSpotMarketStateRecord,
} from "@monolythium/core-sdk";

export interface SelectedNativeSpotMarket {
  marketId: string;
  label: string;
  source: "native-state" | "clob-summary";
  native?: NativeSpotMarketStateRecord;
  summary?: ClobMarketSummary;
}

export function selectNativeSpotMarket(
  state: NativeMarketStateResponse | null | undefined,
  summaries: ClobMarketSummary[] | null | undefined,
): SelectedNativeSpotMarket | null {
  const native = state?.spotMarkets[0];
  if (native) {
    return {
      marketId: native.marketId,
      label: spotMarketLabel(native),
      source: "native-state",
      native,
    };
  }

  const summary = summaries?.[0];
  if (summary) {
    return {
      marketId: summary.marketId,
      label: compactMarketId(summary.marketId),
      source: "clob-summary",
      summary,
    };
  }

  return null;
}

/**
 * What the wallet actually KNOWS about whether any market is listed.
 *
 * "No market is listed" and "the market list could not be read" are different
 * facts, and only the first is a statement about the chain. A failed read is an
 * absence of knowledge, so it resolves to `unknown` and callers must not render
 * it as a confident zero.
 *
 * `none` therefore requires BOTH market reads to have succeeded — the selection
 * draws on the native state and the indexed summaries, so either one failing
 * leaves a listed market possible. A resolved selection is direct proof and
 * wins regardless of read outcomes.
 */
export type MarketListingKnowledge = "loading" | "listed" | "none" | "unknown";

export function marketListingKnowledge(args: {
  /** The first status load has resolved. */
  loaded: boolean;
  /** `lyth_*` native market state read succeeded. */
  nativeOk: boolean;
  /** Indexed market summary read succeeded. */
  indexedOk: boolean;
  /** A market was actually resolved. */
  selected: boolean;
}): MarketListingKnowledge {
  if (args.selected) return "listed";
  if (!args.loaded) return "loading";
  return args.nativeOk && args.indexedOk ? "none" : "unknown";
}

export function spotMarketLabel(market: Pick<NativeSpotMarketStateRecord, "baseAssetId" | "quoteAssetId">): string {
  return `${compactAssetId(market.baseAssetId)}/${compactAssetId(market.quoteAssetId)}`;
}

export function compactAssetId(assetId: string): string {
  const trimmed = assetId.trim();
  if (trimmed.length === 0) return "unknown";
  if (/^[A-Z0-9]{2,12}$/.test(trimmed)) return trimmed;
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-6)}`;
}

export function compactMarketId(marketId: string): string {
  const trimmed = marketId.trim();
  if (trimmed.length === 0) return "unknown market";
  if (trimmed.length <= 24) return trimmed;
  return `${trimmed.slice(0, 12)}...${trimmed.slice(-8)}`;
}

export function findOrderBookStreamTopic(
  topics: ApiStreamTopicMetadata[] | null | undefined,
): ApiStreamTopicMetadata | null {
  return topics?.find((topic) => topic.topic === NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC) ?? null;
}
