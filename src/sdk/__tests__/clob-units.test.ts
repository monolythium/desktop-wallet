import { describe, expect, it } from "vitest";
import {
  atomPriceToHuman,
  atomsToDecimal,
  decimalToAtoms,
  humanPriceToAtoms,
  humanQuantityToAtoms,
  isValidDecimal,
  notionalQuoteAtoms,
} from "../clob-units";

const DEC = 8; // native LYTH scale

describe("isValidDecimal", () => {
  it("accepts whole and bounded-decimal values", () => {
    expect(isValidDecimal("10", DEC)).toBe(true);
    expect(isValidDecimal("10.12345678", DEC)).toBe(true);
  });
  it("rejects empty, negative, and over-precise values", () => {
    expect(isValidDecimal("", DEC)).toBe(false);
    expect(isValidDecimal("-1", DEC)).toBe(false);
    expect(isValidDecimal("1.123456789", DEC)).toBe(false);
  });
});

describe("decimalToAtoms / atomsToDecimal round-trip", () => {
  it("scales a whole number", () => {
    expect(decimalToAtoms("2", DEC)).toBe(200_000_000n);
    expect(atomsToDecimal(200_000_000n, DEC)).toBe("2");
  });
  it("scales a fractional number and trims trailing zeros back", () => {
    expect(decimalToAtoms("1.5", DEC)).toBe(150_000_000n);
    expect(atomsToDecimal(150_000_000n, DEC)).toBe("1.5");
  });
  it("preserves the smallest unit", () => {
    expect(decimalToAtoms("0.00000001", DEC)).toBe(1n);
    expect(atomsToDecimal(1n, DEC)).toBe("0.00000001");
  });
});

describe("humanQuantityToAtoms", () => {
  it("converts whole base tokens to base atoms", () => {
    expect(humanQuantityToAtoms("2", DEC)).toBe(200_000_000n);
  });
  it("rejects over-precise quantities", () => {
    expect(humanQuantityToAtoms("1.123456789", DEC)).toBeNull();
  });
});

describe("humanPriceToAtoms (quote tokens per base token → quote atoms per base atom)", () => {
  it("maps a whole-ratio price to the same integer when decimals are equal", () => {
    // 10 quote tokens per base token, 8/8 decimals → 10 quote atoms per base atom.
    expect(humanPriceToAtoms("10", DEC, DEC)).toBe(10n);
  });
  it("returns null for a ratio that is not a whole quote-atom-per-base-atom", () => {
    // 1.5 quote/base at equal decimals isn't representable on the per-atom grid.
    expect(humanPriceToAtoms("1.5", DEC, DEC)).toBeNull();
  });
  it("round-trips a whole ratio through atomPriceToHuman", () => {
    const atoms = humanPriceToAtoms("10", DEC, DEC);
    expect(atoms).not.toBeNull();
    expect(atomPriceToHuman(atoms!.toString(), DEC, DEC)).toBe("10");
  });
  it("handles differing decimals", () => {
    // 2 quote tokens per base token; base 6 dec, quote 8 dec.
    // price_atoms = 2 × 10^8 / 10^6 = 200.
    expect(humanPriceToAtoms("2", 6, 8)).toBe(200n);
    expect(atomPriceToHuman("200", 6, 8)).toBe("2");
  });
});

describe("notionalQuoteAtoms", () => {
  it("is price_atoms × quantity_atoms (quote atoms)", () => {
    const priceAtoms = humanPriceToAtoms("10", DEC, DEC)!; // 10
    const qtyAtoms = humanQuantityToAtoms("2", DEC)!; // 200_000_000
    expect(notionalQuoteAtoms(priceAtoms, qtyAtoms)).toBe(2_000_000_000n);
  });
});
