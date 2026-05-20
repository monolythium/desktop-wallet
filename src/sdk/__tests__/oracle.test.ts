// Oracle stub tests — chain-gap fallback + happy path + cache.

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import {
  _resetOraclePriceCacheForTest,
  getTokenUsdPrice,
} from "../oracle";
import { resetProviderForTest, setProviderForTest } from "../client";

interface Fixture {
  /** contract address (lowercased) → real number, or "method-not-found",
   *  or "other-error". */
  prices: Record<string, number | "method-not-found" | "other-error">;
}

function makeFetch(fx: Fixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    if (body.method === "eth_chainId") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x10f2c" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (body.method === "lyth_getTokenPrice") {
      const contract = (body.params[0] as string).toLowerCase();
      const v = fx.prices[contract];
      if (v === undefined || v === "method-not-found") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "method not found" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (v === "other-error") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: "transport hiccup" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: { priceUsd: v } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function installProvider(fx: Fixture): void {
  setProviderForTest(
    new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
    ),
  );
}

beforeEach(() => {
  resetProviderForTest();
  _resetOraclePriceCacheForTest();
});

const CONTRACT = "0xa1aa00000000000000000000000000000000000a";

describe("oracle · happy path", () => {
  it("returns priceUsd + source: 'chain' when RPC succeeds", async () => {
    installProvider({ prices: { [CONTRACT]: 1.23 } });
    const r = await getTokenUsdPrice(CONTRACT);
    expect(r.priceUsd).toBe(1.23);
    expect(r.source).toBe("chain");
  });

  it("caches successful results", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      callCount += 1;
      const body = JSON.parse((init as { body: string }).body);
      const id = body.id;
      const ok = (r: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (body.method === "eth_chainId") return ok("0x10f2c");
      if (body.method === "lyth_getTokenPrice") return ok({ priceUsd: 5.5 });
      return ok(null);
    };
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fetchImpl })),
    );
    await getTokenUsdPrice(CONTRACT);
    const after1 = callCount;
    await getTokenUsdPrice(CONTRACT);
    expect(callCount).toBe(after1);
  });
});

describe("oracle · chain-gap fallback", () => {
  it("returns null + source: '[chain-gap]' on method-not-found", async () => {
    installProvider({ prices: { [CONTRACT]: "method-not-found" } });
    const r = await getTokenUsdPrice(CONTRACT);
    expect(r.priceUsd).toBeNull();
    expect(r.source).toBe("[chain-gap]");
  });

  it("returns null + source: '[chain-gap]' on transport hiccup too", async () => {
    installProvider({ prices: { [CONTRACT]: "other-error" } });
    const r = await getTokenUsdPrice(CONTRACT);
    expect(r.priceUsd).toBeNull();
    expect(r.source).toBe("[chain-gap]");
  });

  it("caches chain-gap results (avoids hammering on every render)", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      callCount += 1;
      const body = JSON.parse((init as { body: string }).body);
      const id = body.id;
      if (body.method === "eth_chainId") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x10f2c" }), {
          status: 200,
        });
      }
      if (body.method === "lyth_getTokenPrice") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: "method not found" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: null }), { status: 200 });
    };
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fetchImpl })),
    );
    await getTokenUsdPrice(CONTRACT);
    const after1 = callCount;
    await getTokenUsdPrice(CONTRACT);
    expect(callCount).toBe(after1);
  });
});

describe("oracle · case folding", () => {
  it("treats uppercase + lowercase contract addresses identically", async () => {
    installProvider({ prices: { [CONTRACT]: 7.42 } });
    const a = await getTokenUsdPrice(CONTRACT);
    const b = await getTokenUsdPrice(CONTRACT.toUpperCase());
    expect(a.priceUsd).toBe(7.42);
    expect(b.priceUsd).toBe(7.42);
  });
});
