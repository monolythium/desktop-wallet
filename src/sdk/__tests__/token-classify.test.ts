// token-classify — ERC-165 primary + structural fallback (#D16).

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import { classifyContract } from "../token-classify";
import { ERC20_SELECTORS } from "../erc20";
import { ERC721_SELECTORS } from "../erc721";
import { ERC1155_SELECTORS } from "../erc1155";
import { resetProviderForTest, setProviderForTest } from "../client";

interface Fixture {
  /** per-selector → returned hex or "revert" (emits an RPC error). */
  calls: Record<string, string | "revert">;
}

function makeFetch(fx: Fixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    if (body.method === "eth_chainId") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: "0x10f2c" }), {
        status: 200,
      });
    }
    if (body.method === "eth_call") {
      const params = body.params as Array<{ to: string; data: string }>;
      const sel = (params[0]?.data ?? "").slice(0, 10).toLowerCase();
      const v = fx.calls[sel];
      if (v === undefined || v === "revert") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: "execution reverted" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: v }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "no" } }),
      { status: 200 },
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
});

const CONTRACT = "0xa1aa00000000000000000000000000000000000a";

describe("classifyContract · ERC-165 primary", () => {
  it("returns erc721 + source: erc165 when supportsInterface true", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.supportsInterface]: "0x" + "1".padStart(64, "0"),
      },
    });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("erc721");
    expect(c.source).toBe("erc165");
  });
});

describe("classifyContract · structural fallback", () => {
  it("classifies as erc20 when decimals() responds", async () => {
    installProvider({
      calls: {
        // supportsInterface reverts for both NFT IDs.
        [ERC20_SELECTORS.decimals]: "0x" + (18n).toString(16).padStart(64, "0"),
      },
    });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("erc20");
    expect(c.source).toBe("heuristic");
  });

  it("classifies as erc721 when ownerOf(0) returns a word but decimals reverts", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.ownerOf]: "0x" + "0".repeat(24) + "1".repeat(40),
      },
    });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("erc721");
    expect(c.source).toBe("heuristic");
  });

  it("classifies as erc1155 when uri(0) responds and others don't", async () => {
    // Build a Solidity-style string response: offset + length + body.
    const offset = "0x" + (32n).toString(16).padStart(64, "0");
    // Truncate to just the offset word + a length word + minimal payload.
    const len = "0x" + (5n).toString(16).padStart(64, "0");
    // padded body "abcde"
    const body = "6162636465" + "0".repeat(54);
    const compositeResponse = offset + len.slice(2) + body;
    installProvider({
      calls: {
        [ERC1155_SELECTORS.uri]: compositeResponse,
      },
    });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("erc1155");
    expect(c.source).toBe("heuristic");
  });

  it("returns unknown when nothing responds", async () => {
    installProvider({ calls: {} });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("unknown");
    expect(c.source).toBe("unknown");
  });

  it("rejects implausible decimals (> 36) and falls through", async () => {
    installProvider({
      calls: {
        [ERC20_SELECTORS.decimals]: "0x" + (99n).toString(16).padStart(64, "0"),
      },
    });
    const c = await classifyContract(CONTRACT);
    // Neither erc20 (decimals > 36) nor erc721/erc1155 responded — unknown.
    expect(c.kind).toBe("unknown");
  });
});

describe("classifyContract · precedence", () => {
  it("ERC-165 erc721 wins over heuristic erc20", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.supportsInterface]: "0x" + "1".padStart(64, "0"),
        // Should NOT matter — ERC-165 is consulted first.
        [ERC20_SELECTORS.decimals]: "0x" + (18n).toString(16).padStart(64, "0"),
      },
    });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("erc721");
    expect(c.source).toBe("erc165");
  });

  it("decimals heuristic beats later probes", async () => {
    installProvider({
      calls: {
        [ERC20_SELECTORS.decimals]: "0x" + (6n).toString(16).padStart(64, "0"),
        [ERC721_SELECTORS.ownerOf]: "0x" + "0".repeat(24) + "1".repeat(40),
      },
    });
    const c = await classifyContract(CONTRACT);
    expect(c.kind).toBe("erc20");
  });
});
