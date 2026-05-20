// ERC-20 SDK seam — happy + error paths for each reader + encoder
// round-trip.

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import {
  ERC20_SELECTORS,
  encodeApprove,
  encodeTransfer,
  formatTokenAmount,
  getTokenAllowance,
  getTokenBalance,
  getTokenMetadata,
  parseTokenAmount,
} from "../erc20";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

const CONTRACT = "0xdac17f958d2ee523a2206206994597c13d831ec7"; // USDT-like

interface Erc20Fixture {
  /** Per-`data` selector → returned hex (without 0x prefix; or "error"
   *  to emit a JSON-RPC error). The fixture keys on the calldata's
   *  4-byte selector so the same fixture serves all callers. */
  calls: Record<string, string | "error">;
}

function encodeString(s: string): string {
  // ABI: offset (0x20) + length + utf8 padded to 32-byte multiple.
  const utf8 = Buffer.from(s, "utf8");
  const len = utf8.length.toString(16).padStart(64, "0");
  const padLen = Math.ceil(utf8.length / 32) * 32 || 32;
  const padded = Buffer.alloc(padLen);
  utf8.copy(padded);
  return (
    "0x" +
    "20".padStart(64, "0") +
    len +
    padded.toString("hex")
  );
}

function makeFetch(fx: Erc20Fixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const method = body.method as string;
    if (method === "eth_chainId") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: "0x10f2c" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (method === "eth_call") {
      const params = body.params as Array<{ to: string; data: string }>;
      const data = (params[0]?.data ?? "").toLowerCase();
      const selector = data.slice(0, 10);
      const v = fx.calls[selector];
      if (v === undefined || v === "error") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: `no fixture for ${selector}` },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result: v }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `unhandled: ${method}` },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function installProvider(fx: Erc20Fixture): void {
  setProviderForTest(
    new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
    ),
  );
}

beforeEach(() => {
  resetProviderForTest();
});

describe("erc20 · selectors", () => {
  it("derives the canonical ERC-20 selectors", () => {
    // Pinned against the canonical EIP-20 selectors.
    expect(ERC20_SELECTORS.transfer).toBe("0xa9059cbb");
    expect(ERC20_SELECTORS.balanceOf).toBe("0x70a08231");
    expect(ERC20_SELECTORS.approve).toBe("0x095ea7b3");
    expect(ERC20_SELECTORS.name).toBe("0x06fdde03");
    expect(ERC20_SELECTORS.symbol).toBe("0x95d89b41");
    expect(ERC20_SELECTORS.decimals).toBe("0x313ce567");
  });
});

describe("erc20 · getTokenMetadata", () => {
  it("returns name/symbol/decimals on the happy path", async () => {
    installProvider({
      calls: {
        [ERC20_SELECTORS.name]: encodeString("Tether USD"),
        [ERC20_SELECTORS.symbol]: encodeString("USDT"),
        [ERC20_SELECTORS.decimals]: "0x" + (6n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getTokenMetadata(CONTRACT);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ name: "Tether USD", symbol: "USDT", decimals: 6 });
  });

  it("falls back to 18 decimals + empty strings when calls partially fail", async () => {
    installProvider({
      calls: {
        // Only symbol succeeds.
        [ERC20_SELECTORS.symbol]: encodeString("WIDGET"),
      },
    });
    const out = await getTokenMetadata(CONTRACT);
    expect(out.ok).toBe(true);
    expect(out.value?.symbol).toBe("WIDGET");
    expect(out.value?.decimals).toBe(18);
    expect(out.value?.name).toBe("");
  });

  it("returns ok:false when all three calls fail", async () => {
    installProvider({ calls: {} });
    const out = await getTokenMetadata(CONTRACT);
    expect(out.ok).toBe(false);
  });

  it("rejects implausible decimals (>36) and falls back to 18", async () => {
    installProvider({
      calls: {
        [ERC20_SELECTORS.decimals]: "0x" + (99n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getTokenMetadata(CONTRACT);
    expect(out.value?.decimals).toBe(18);
  });
});

describe("erc20 · getTokenBalance", () => {
  it("decodes a uint256 balance", async () => {
    installProvider({
      calls: {
        [ERC20_SELECTORS.balanceOf]:
          "0x" + (1_234_567_890n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getTokenBalance(CONTRACT, TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toBe(1_234_567_890n);
  });

  it("returns ok:false on RPC error", async () => {
    installProvider({ calls: {} });
    const out = await getTokenBalance(CONTRACT, TEST_ADDRESS);
    expect(out.ok).toBe(false);
  });
});

describe("erc20 · getTokenAllowance", () => {
  it("decodes the allowance value", async () => {
    installProvider({
      calls: {
        [ERC20_SELECTORS.allowance]:
          "0x" + (42_000n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getTokenAllowance(CONTRACT, TEST_ADDRESS, TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toBe(42_000n);
  });
});

describe("erc20 · encodeTransfer / encodeApprove", () => {
  it("builds the canonical transfer calldata", () => {
    const tx = encodeTransfer({
      from: TEST_ADDRESS,
      contract: CONTRACT,
      to: "0x000000000000000000000000000000000000dead",
      amount: 10n,
    });
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
    const data = tx.data as string;
    expect(data.startsWith(ERC20_SELECTORS.transfer)).toBe(true);
    // Recipient padded to 32 bytes, amount = 10 = 0xa.
    expect(data.length).toBe(2 + 8 + 64 + 64);
    expect(data.endsWith("000000000000000000000000000000000000000000000000000000000000000a")).toBe(true);
  });

  it("builds the canonical approve calldata", () => {
    const tx = encodeApprove({
      from: TEST_ADDRESS,
      contract: CONTRACT,
      spender: "0x000000000000000000000000000000000000beef",
      amount: 100n,
    });
    expect((tx.data as string).startsWith(ERC20_SELECTORS.approve)).toBe(true);
  });
});

describe("erc20 · format/parse helpers", () => {
  it("round-trips amounts through parse and format", () => {
    const raw = parseTokenAmount("1.5", 6);
    expect(raw).toBe(1_500_000n);
    expect(formatTokenAmount(raw, 6)).toBeCloseTo(1.5);
  });

  it("rejects too many decimal places", () => {
    expect(() => parseTokenAmount("0.1234567", 6)).toThrow();
  });

  it("rejects non-numeric input", () => {
    expect(() => parseTokenAmount("abc", 6)).toThrow();
  });

  it("handles zero decimals", () => {
    expect(parseTokenAmount("42", 0)).toBe(42n);
    expect(formatTokenAmount(42n, 0)).toBe(42);
  });
});
