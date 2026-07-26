// bech32m typo suggester (T2). bech32m's ≤ 4-error detection means a
// single-corruption string has a UNIQUE valid distance-1 neighbour, so a
// corrupt-then-suggest round-trip must return exactly the original.

import { describe, expect, it } from "vitest";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { BECH32_CHARSET, suggestBech32mCorrection } from "../bech32m-typo";

const VALID = addressToTypedBech32("user", "0x000000000000000000000000000000000000dead"); // 43 chars

/** Replace the char at `i` with a different charset char (a checksum-breaking,
 *  still-in-charset corruption). */
function corruptAt(s: string, i: number): string {
  const other = s[i] === BECH32_CHARSET[0] ? BECH32_CHARSET[1]! : BECH32_CHARSET[0]!;
  return s.slice(0, i) + other + s.slice(i + 1);
}

describe("suggestBech32mCorrection", () => {
  it("restores the original after a single corruption (early / middle / final)", () => {
    for (const i of [DATA_EARLY(), DATA_MIDDLE(), DATA_FINAL()]) {
      expect(suggestBech32mCorrection(corruptAt(VALID, i))).toBe(VALID);
    }
  });

  it("returns null for an already-valid address (nothing to suggest)", () => {
    expect(suggestBech32mCorrection(VALID)).toBeNull();
  });

  it("returns null for a two-character corruption (distance ≥ 2 is never attempted)", () => {
    const twice = corruptAt(corruptAt(VALID, 6), 20);
    expect(suggestBech32mCorrection(twice)).toBeNull();
  });

  it("returns null for non-mono1 and 0x input", () => {
    expect(suggestBech32mCorrection("0x" + "a".repeat(40))).toBeNull();
    expect(suggestBech32mCorrection("monok1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq")).toBeNull();
  });

  it("respects the [30, 70] length gate (29 and 71 → null)", () => {
    expect(suggestBech32mCorrection("mono1" + "q".repeat(24))).toBeNull(); // 29 chars
    expect(suggestBech32mCorrection("mono1" + "q".repeat(66))).toBeNull(); // 71 chars
  });

  it("uppercases/whitespace are normalized before the search", () => {
    expect(suggestBech32mCorrection(`  ${corruptAt(VALID, 12).toUpperCase()}  `)).toBe(VALID);
  });
});

function DATA_EARLY() {
  return 5;
}
function DATA_MIDDLE() {
  return Math.floor(VALID.length / 2);
}
function DATA_FINAL() {
  return VALID.length - 1;
}
