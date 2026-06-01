import { describe, expect, it } from "vitest";
import type { LiveTokenStatus } from "../live";
import { NATIVE_TOKEN_REF } from "../selected-token";
import { selectTokenDetailFacts } from "../token-detail";

function status(partial: Partial<LiveTokenStatus>): LiveTokenStatus {
  return {
    endpoint: "http://node.test:8545",
    nativeBalance: { ok: true, value: "12.5" },
    tokenBalances: { ok: true, value: [] },
    addressLabel: { ok: true, value: null },
    assetPolicy: { ok: true, value: {} },
    ...partial,
  };
}

describe("selectTokenDetailFacts — native LYTH", () => {
  it("resolves name/ticker and the live native balance", () => {
    const facts = selectTokenDetailFacts(status({}), NATIVE_TOKEN_REF);
    expect(facts.isNative).toBe(true);
    expect(facts.name).toBe("Monolythium");
    expect(facts.ticker).toBe("LYTH");
    expect(facts.balanceDisplay).toBe("12.5");
    expect(facts.balanceAmount).toBe(12.5);
    expect(facts.tokenId).toBeNull();
    expect(facts.notFound).toBe(false);
  });

  it("surfaces a failed native read as a null balance (never a fabricated 0)", () => {
    const facts = selectTokenDetailFacts(
      status({ nativeBalance: { ok: false, error: "rpc down" } }),
      NATIVE_TOKEN_REF,
    );
    expect(facts.balanceDisplay).toBeNull();
    expect(facts.balanceAmount).toBe(0);
  });

  it("carries the native asset policy when the read succeeded", () => {
    const facts = selectTokenDetailFacts(
      status({ assetPolicy: { ok: true, value: { mode: "open", allowTransparent: true } } }),
      NATIVE_TOKEN_REF,
    );
    expect(facts.assetPolicy).toEqual({ mode: "open", allowTransparent: true });
  });

  it("defaults to native facts when live status is null", () => {
    const facts = selectTokenDetailFacts(null, NATIVE_TOKEN_REF);
    expect(facts.isNative).toBe(true);
    expect(facts.balanceDisplay).toBeNull();
    expect(facts.assetPolicy).toBeNull();
  });
});

describe("selectTokenDetailFacts — MRC-20", () => {
  const tokenId = "0x" + "ab".repeat(32);

  it("matches the MRC row and short-forms the id for name/ticker", () => {
    const facts = selectTokenDetailFacts(
      status({
        tokenBalances: {
          ok: true,
          value: [{ tokenId, balance: "1000", updatedAtBlock: 42n }],
        },
      }),
      tokenId,
    );
    expect(facts.isNative).toBe(false);
    expect(facts.tokenId).toBe(tokenId);
    expect(facts.balanceDisplay).toBe("1000");
    expect(facts.balanceAmount).toBe(1000);
    expect(facts.updatedAtBlock).toBe(42n);
    expect(facts.name).toContain("…");
    expect(facts.name).toBe(facts.ticker);
    // No per-MRC asset-policy read exists yet.
    expect(facts.assetPolicy).toBeNull();
    expect(facts.notFound).toBe(false);
  });

  it("flags notFound when the selected id is absent from the balance list", () => {
    const facts = selectTokenDetailFacts(
      status({ tokenBalances: { ok: true, value: [] } }),
      tokenId,
    );
    expect(facts.notFound).toBe(true);
    expect(facts.balanceDisplay).toBeNull();
  });

  it("does not flag notFound when the balance read itself failed", () => {
    const facts = selectTokenDetailFacts(
      status({ tokenBalances: { ok: false, error: "indexer down" } }),
      tokenId,
    );
    expect(facts.notFound).toBe(false);
    expect(facts.balanceDisplay).toBeNull();
  });
});
