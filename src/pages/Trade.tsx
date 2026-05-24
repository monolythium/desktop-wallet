// Trade page — read-only native CLOB spot readiness. Public denom only.

import { useEffect, useState } from "react";
import type { ClobOrderBookResponse, NativeSpotMarketStateRecord } from "@monolythium/core-sdk";
import { findOrderBookStreamTopic } from "../sdk/market";
import { formatOutcome, loadLiveTradeStatus, type LiveTradeStatus } from "../sdk/live";

export function Trade() {
  const [status, setStatus] = useState<LiveTradeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setStatus(await loadLiveTradeStatus());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const selected = status?.selectedMarket ?? null;
  const nativeMarket = selected?.native ?? null;
  const precompiles = status?.activePrecompiles.ok ? status.activePrecompiles.value?.precompiles ?? [] : [];
  const clobPrecompile = precompiles.find((row) => row.name.toLowerCase() === "clob" || row.address.toLowerCase() === "0x1001");
  const orderBookTopic = findOrderBookStreamTopic(status?.apiStreams.ok ? status.apiStreams.value?.topics : null);
  const book = status?.clobOrderBook.ok ? status.clobOrderBook.value : null;
  const trades = status?.clobTrades.ok ? status.clobTrades.value?.trades ?? [] : [];
  const nativeState = status?.nativeMarketState.ok ? status.nativeMarketState.value ?? null : null;
  const marketRows = nativeState?.spotMarkets ?? [];
  const orderRows = nativeState?.spotOrders ?? [];

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Trade</h1>
        <div className="sub">Native spot CLOB readiness. Read-only until live market data is available.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Native market readiness</h3>
          <span className="w-live-pill">read only</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          <div className="w-live-grid">
            <LiveCell
              label="CLOB precompile"
              value={clobPrecompile ? (clobPrecompile.enabled ? "enabled" : clobPrecompile.gateable ? "gated" : "disabled") : status ? "not advertised" : "loading"}
            />
            <LiveCell label="Spot markets" value={status ? formatOutcome(status.nativeMarketState, (state) => state.spotMarkets.length.toString()) : "loading"} />
            <LiveCell label="Indexed markets" value={status ? formatOutcome(status.clobMarkets, (rows) => rows.markets.length.toString()) : "loading"} />
            <LiveCell label="Selected market" value={selected?.label ?? (status ? "none" : "loading")} />
          </div>
          {status ? <div className="row-help">JSON-RPC endpoint: <span className="mono">{status.endpoint}</span></div> : null}
          {status ? <div className="row-help">REST endpoint: <span className="mono">{status.apiBaseUrl}</span></div> : null}
          {clobPrecompile ? <div className="row-help">CLOB address: <span className="mono">{clobPrecompile.address}</span></div> : null}
          {status?.activePrecompiles.ok === false ? <div className="w-live-error">precompile catalogue: {status.activePrecompiles.error}</div> : null}
          {status?.nativeMarketState.ok === false ? <div className="w-live-error">native market state: {status.nativeMarketState.error}</div> : null}
          {status?.clobMarkets.ok === false ? <div className="w-live-error">indexed market summary: {status.clobMarkets.error}</div> : null}
        </div>
      </div>

      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card__head">
            <h3>Endpoint availability</h3>
            <span className="w-live-pill">bounded</span>
          </div>
          <div className="w-card__body">
            <LiveLine k="REST health" v={status ? formatOutcome(status.apiHealth, (health) => health.status) : "loading"} />
            <LiveLine k="REST streams" v={status ? formatOutcome(status.apiStreams, (streams) => `${streams.transport} · ${streams.topics.length} topics`) : "loading"} />
            <LiveLine
              k="Order book stream"
              v={orderBookTopic ? `${orderBookTopic.topic}${orderBookTopic.retention?.replay ? " · replay available" : ""}` : status?.apiStreams.ok ? "not advertised" : status?.apiStreams.error ?? "loading"}
            />
            <LiveLine
              k="Replay check"
              v={status ? formatOutcome(status.orderBookReplay, (replay) => `${replay.deltas.length} deltas at sampled head`) : "loading"}
              mono={Boolean(status?.orderBookReplay.ok)}
            />
            <LiveLine k="Capability report" v={status ? formatOutcome(status.apiCapabilities, (caps) => caps.api.enabled ? caps.api.version : "API disabled") : "loading"} />
            {status?.apiHealth.ok === false ? <div className="w-live-error">REST health: {status.apiHealth.error}</div> : null}
            {status?.apiStreams.ok === false ? <div className="w-live-error">REST streams: {status.apiStreams.error}</div> : null}
            {status?.orderBookReplay.ok === false ? <div className="w-live-error">order book replay: {status.orderBookReplay.error}</div> : null}
            {status?.apiCapabilities.ok === false ? <div className="w-live-error">REST capabilities: {status.apiCapabilities.error}</div> : null}
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head">
            <h3>Selected spot market</h3>
            <span className={`w-live-pill ${selected ? "" : "is-muted"}`}>{selected ? selected.source : "none"}</span>
          </div>
          <div className="w-card__body">
            {nativeMarket ? <MarketDetails market={nativeMarket} /> : null}
            {!nativeMarket && selected ? <LiveLine k="Market id" v={selected.marketId} mono /> : null}
            {!selected && status ? <div className="row-help">No native spot market is available from the live SDK reads.</div> : null}
            {!status ? <div className="row-help">Loading market metadata...</div> : null}
          </div>
        </div>
      </div>

      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card__head">
            <h3>Order book</h3>
            <span className={`w-live-pill ${book ? "" : "is-muted"}`}>{book ? "live read" : "unavailable"}</span>
          </div>
          <div className="w-card__body">
            {book ? <OrderBook book={book} /> : null}
            {!book && status ? <div className="row-help">No book levels are rendered without a successful CLOB order book response.</div> : null}
            {status?.clobOrderBook.ok === false ? <div className="w-live-error">order book: {status.clobOrderBook.error}</div> : null}
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head">
            <h3>Recent fills</h3>
            <span className={`w-live-pill ${trades.length > 0 ? "" : "is-muted"}`}>{trades.length > 0 ? "live read" : "empty"}</span>
          </div>
          <div className="w-card__body">
            {trades.length > 0 ? (
              <div className="w-live-list">
                {trades.map((trade) => (
                  <div className="w-live-row" key={`${trade.blockHeight}-${trade.txIndex}-${trade.logIndex}`}>
                    <div>
                      <div className="row-label mono">{trade.price}</div>
                      <div className="row-help">block {trade.blockHeight}</div>
                    </div>
                    <div className="w-live-right mono">{trade.amount}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {trades.length === 0 && status?.clobTrades.ok ? <div className="row-help">No recent fills returned for the selected market.</div> : null}
            {status?.clobTrades.ok === false ? <div className="w-live-error">recent fills: {status.clobTrades.error}</div> : null}
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>State scope</h3>
          <span className="w-live-pill is-muted">fail closed</span>
        </div>
        <div className="w-card__body">
          <div className="w-live-grid">
            <LiveCell label="Market rows" value={status ? marketRows.length.toString() : "loading"} />
            <LiveCell label="Order rows" value={status ? orderRows.length.toString() : "loading"} />
            <LiveCell label="NFT listings" value={nativeState ? nativeState.nftListings.length.toString() : status?.nativeMarketState.error ?? "loading"} />
            <LiveCell label="Royalties" value={nativeState ? nativeState.collectionRoyalties.length.toString() : status?.nativeMarketState.error ?? "loading"} />
          </div>
          <div className="row-help">Order entry, open orders, and balances are intentionally hidden here until account-scoped CLOB state is available.</div>
        </div>
      </div>
    </div>
  );
}

function MarketDetails({ market }: { market: NativeSpotMarketStateRecord }) {
  return (
    <>
      <LiveLine k="Market id" v={market.marketId} mono />
      <LiveLine k="Base asset" v={market.baseAssetId} mono />
      <LiveLine k="Quote asset" v={market.quoteAssetId} mono />
      <LiveLine k="Last price" v={market.lastPrice ?? "no fills"} mono />
      <LiveLine k="Trade count" v={market.tradeCount} mono />
      <LiveLine k="Total base volume" v={market.totalVolumeBase} mono />
      <LiveLine k="Updated block" v={market.updatedAtBlock.toString()} mono />
    </>
  );
}

function OrderBook({ book }: { book: ClobOrderBookResponse }) {
  const rows = Math.max(book.asks.length, book.bids.length);
  if (rows === 0) return <div className="row-help">The selected market returned an empty book.</div>;

  return (
    <div className="w-market-book">
      <div className="w-market-book__head">
        <span>Bid size</span>
        <span>Bid price</span>
        <span>Ask price</span>
        <span>Ask size</span>
      </div>
      {Array.from({ length: rows }).map((_, index) => {
        const bid = book.bids[index];
        const ask = book.asks[index];
        return (
          <div className="w-market-book__row" key={index}>
            <span className="mono">{bid?.size ?? ""}</span>
            <span className="mono">{bid?.price ?? ""}</span>
            <span className="mono">{ask?.price ?? ""}</span>
            <span className="mono">{ask?.size ?? ""}</span>
          </div>
        );
      })}
    </div>
  );
}

function LiveCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function LiveLine({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="w-kv">
      <span className="k">{k}</span>
      <span className={`v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}
