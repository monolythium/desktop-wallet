import { describe, expect, it } from "vitest";
import type { LiveTokenStatus } from "../live";
import { liveTokenStatusToRows, parseDecimalAmount, shortTokenId } from "../token-rows";
import type { TokenMeta } from "../token-metadata";

function status(partial: Partial<LiveTokenStatus>): LiveTokenStatus {
  return {
    endpoint: "http://node.test:8545",
    nativeBalance: { ok: true, value: "0" },
    nativeBalanceLythoshi: { ok: true, value: "0" },
    tokenBalances: { ok: true, value: [] },
    addressLabel: { ok: true, value: null },
    assetPolicy: { ok: true, value: {} },
    ...partial,
  };
}

describe("parseDecimalAmount", () => {
  it("parses plain and grouped decimals", () => {
    expect(parseDecimalAmount("12.5")).toBe(12.5);
    expect(parseDecimalAmount("1,234.5")).toBe(1234.5);
    expect(parseDecimalAmount("  42 ")).toBe(42);
  });

  it("collapses empty / nullish / non-numeric input to 0 (never throws)", () => {
    expect(parseDecimalAmount("")).toBe(0);
    expect(parseDecimalAmount(null)).toBe(0);
    expect(parseDecimalAmount(undefined)).toBe(0);
    expect(parseDecimalAmount("not-a-number")).toBe(0);
  });
});

describe("shortTokenId", () => {
  it("middle-truncates a long 0x token id", () => {
    const id = "0x" + "ab".repeat(32);
    const short = shortTokenId(id);
    expect(short).toBe("0xabab…abab");
    expect(short.length).toBeLessThan(id.length);
  });

  it("leaves a short id untouched", () => {
    expect(shortTokenId("0xab12")).toBe("0xab12");
  });
});

describe("liveTokenStatusToRows", () => {
  it("always emits a native LYTH row with no price/USD/24h (null)", () => {
    const rows = liveTokenStatusToRows(status({ nativeBalance: { ok: true, value: "100.5" } }));
    expect(rows[0]).toMatchObject({
      sym: "LYTH",
      name: "Monolythium",
      amount: 100.5,
      priceUsd: null,
      chg24h: null,
      primary: true,
    });
  });

  it("emits a native row at amount 0 when the wallet is empty", () => {
    const rows = liveTokenStatusToRows(status({ nativeBalance: { ok: true, value: "0" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(0);
  });

  it("renders the native row at amount 0 when the balance query failed (no fabrication)", () => {
    const rows = liveTokenStatusToRows(status({ nativeBalance: { ok: false, error: "rpc down" } }));
    expect(rows[0]!.amount).toBe(0);
    expect(rows[0]!.priceUsd).toBeNull();
  });

  it("shows an honest '—' for an MRC-20 amount when no metadata is loaded (never raw base units)", () => {
    const tokenId = "0x" + "cd".repeat(32);
    const rows = liveTokenStatusToRows(
      status({
        nativeBalance: { ok: true, value: "5" },
        tokenBalances: { ok: true, value: [{ tokenId, balance: "1500000", updatedAtBlock: 99n }] },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      sym: shortTokenId(tokenId), // no symbol yet → honest short id
      displayAmount: "—", // decimals unknown → em-dash, NOT the raw "1500000"
      amount: 0, // the raw base-units number never leaks through
      priceUsd: null,
      chg24h: null,
    });
    expect(rows[1]!.primary).toBeUndefined();
  });

  it("scales an MRC-20 amount to its real decimals and shows the real symbol when metadata is present", () => {
    const tokenId = "0x" + "cd".repeat(32);
    const meta = new Map<string, TokenMeta>([
      [tokenId, { decimals: 6, symbol: "USDC", name: "USD Coin" }],
    ]);
    const rows = liveTokenStatusToRows(
      status({
        tokenBalances: { ok: true, value: [{ tokenId, balance: "1500000", updatedAtBlock: 99n }] },
      }),
      meta,
    );
    expect(rows[1]).toMatchObject({
      sym: "USDC",
      name: "USD Coin",
      displayAmount: "1.5", // 1500000 / 10^6
      amount: 0,
    });
  });

  it("keys metadata by the mrc assetId (not the tokenId) when the row carries one", () => {
    const tokenId = "0x" + "cd".repeat(32);
    const assetId = "0x" + "ef".repeat(32);
    const meta = new Map<string, TokenMeta>([
      [assetId, { decimals: 18, symbol: "GOV", name: null }],
    ]);
    const rows = liveTokenStatusToRows(
      status({
        tokenBalances: {
          ok: true,
          value: [
            {
              tokenId,
              balance: "2000000000000000000",
              updatedAtBlock: 99n,
              mrc: { standard: "mrc20", assetId },
            },
          ],
        },
      }),
      meta,
    );
    expect(rows[1]).toMatchObject({ sym: "GOV", displayAmount: "2" });
  });

  it("carries the row's MRC standard so a 721/1155 row is not an unloaded MRC-20", () => {
    const nft = "0x" + "a1".repeat(32);
    const fungible = "0x" + "b2".repeat(32);
    const rows = liveTokenStatusToRows(
      status({
        tokenBalances: {
          ok: true,
          value: [
            { tokenId: nft, balance: "1", updatedAtBlock: 1n, mrc: { standard: "mrc721", assetId: nft } },
            { tokenId: fungible, balance: "5", updatedAtBlock: 1n, mrc: { standard: "mrc20", assetId: fungible } },
          ],
        },
      }),
    );
    expect(rows[1]).toMatchObject({ standard: "mrc721" });
    expect(rows[2]).toMatchObject({ standard: "mrc20" });
    // Native row never carries a standard.
    expect(rows[0]?.standard ?? null).toBeNull();
  });

  it("shows '—' when metadata is present but carries no decimals (honest, not raw)", () => {
    const tokenId = "0x" + "cd".repeat(32);
    const meta = new Map<string, TokenMeta>([
      [tokenId, { decimals: null, symbol: "MYST", name: null }],
    ]);
    const rows = liveTokenStatusToRows(
      status({
        tokenBalances: { ok: true, value: [{ tokenId, balance: "1500000", updatedAtBlock: 99n }] },
      }),
      meta,
    );
    expect(rows[1]).toMatchObject({ sym: "MYST", displayAmount: "—" });
  });

  it("omits MRC-20 rows when the token-balance query failed (native row only)", () => {
    const rows = liveTokenStatusToRows(
      status({ tokenBalances: { ok: false, error: "indexer offline" } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sym).toBe("LYTH");
  });

  it("returns just the native placeholder row for a null status (pre-load)", () => {
    const rows = liveTokenStatusToRows(null);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(0);
    expect(rows[0]!.priceUsd).toBeNull();
  });
});
