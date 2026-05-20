// Token list CRUD — list/add/remove/hide/pin + reorder + persistence.

import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetTokenListForTest,
  addToken,
  hideToken,
  listTokens,
  listVisibleTokens,
  pinToken,
  removeToken,
  reorderTokens,
  unhideToken,
  unpinToken,
} from "../token-list";

beforeEach(() => {
  _resetTokenListForTest();
});

describe("token-list CRUD", () => {
  it("returns an empty list initially", () => {
    expect(listTokens()).toEqual([]);
  });

  it("adds a token and lists it", () => {
    const t = addToken({
      contract: "0xAAaa00000000000000000000000000000000aaaa",
      kind: "erc20",
      symbol: "FOO",
      name: "Foo Token",
      decimals: 18,
    });
    expect(t.contract).toBe("0xaaaa00000000000000000000000000000000aaaa");
    expect(listTokens()).toHaveLength(1);
  });

  it("sorts pinned first, then alphabetical by symbol", () => {
    addToken({ contract: "0xa1", kind: "erc20", symbol: "ZZZ", name: "Z", decimals: 18 });
    addToken({ contract: "0xa2", kind: "erc20", symbol: "AAA", name: "A", decimals: 18 });
    addToken({ contract: "0xa3", kind: "erc20", symbol: "MMM", name: "M", decimals: 18, pinned: true });
    const list = listTokens();
    expect(list.map((t) => t.symbol)).toEqual(["MMM", "AAA", "ZZZ"]);
  });

  it("upserts on duplicate contract, preserving user choices", () => {
    addToken({ contract: "0xa1", kind: "erc20", symbol: "OLD", name: "Old", decimals: 18, pinned: true });
    // Re-discovery with a fresh chain-side name.
    addToken({ contract: "0xa1", kind: "erc20", symbol: "NEW", name: "New", decimals: 18 });
    const list = listTokens();
    expect(list).toHaveLength(1);
    expect(list[0]?.symbol).toBe("NEW");
    expect(list[0]?.pinned).toBe(true); // sticky
  });

  it("removes a token", () => {
    addToken({ contract: "0xa1", kind: "erc20", symbol: "X", name: "X", decimals: 18 });
    expect(removeToken("0xA1")).toBe(true);
    expect(listTokens()).toEqual([]);
  });

  it("returns false when removing a missing token", () => {
    expect(removeToken("0xdead")).toBe(false);
  });

  it("hides and unhides without removing", () => {
    addToken({ contract: "0xa1", kind: "erc20", symbol: "X", name: "X", decimals: 18 });
    hideToken("0xa1");
    expect(listVisibleTokens()).toEqual([]);
    expect(listTokens()).toHaveLength(1);
    unhideToken("0xa1");
    expect(listVisibleTokens()).toHaveLength(1);
  });

  it("pins and unpins", () => {
    addToken({ contract: "0xa1", kind: "erc20", symbol: "AAA", name: "A", decimals: 18 });
    addToken({ contract: "0xa2", kind: "erc20", symbol: "ZZZ", name: "Z", decimals: 18 });
    pinToken("0xa2");
    expect(listTokens()[0]?.symbol).toBe("ZZZ");
    unpinToken("0xa2");
    expect(listTokens()[0]?.symbol).toBe("AAA");
  });

  it("reorders pinned tokens", () => {
    addToken({ contract: "0xa1", kind: "erc20", symbol: "A", name: "A", decimals: 18, pinned: true });
    addToken({ contract: "0xa2", kind: "erc20", symbol: "B", name: "B", decimals: 18, pinned: true });
    addToken({ contract: "0xa3", kind: "erc20", symbol: "C", name: "C", decimals: 18, pinned: true });
    reorderTokens(["0xa3", "0xa1", "0xa2"]);
    expect(listTokens().map((t) => t.symbol)).toEqual(["C", "A", "B"]);
  });

  it("survives malformed storage rows", () => {
    localStorage.setItem(
      "mono.tokens.v1",
      JSON.stringify([
        { contract: "0xa1", kind: "erc20", symbol: "OK", name: "Ok", addedAt: 1 },
        { contract: "0xa2", kind: "bogus", symbol: "X", name: "X", addedAt: 2 }, // invalid kind
        "not-an-object",
      ]),
    );
    const list = listTokens();
    expect(list).toHaveLength(1);
    expect(list[0]?.symbol).toBe("OK");
  });

  it("recovers from completely malformed storage", () => {
    localStorage.setItem("mono.tokens.v1", "{not-json");
    expect(listTokens()).toEqual([]);
  });
});
