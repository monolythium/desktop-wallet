import { describe, expect, it } from "vitest";
import {
  formatLythDisplay,
  isNativeLythTokenId,
  tokenUnitLabel,
  truncateDecimals,
} from "../lyth-display";

describe("truncateDecimals", () => {
  it("truncates (not rounds) to N fractional digits and trims trailing zeros", () => {
    expect(truncateDecimals("185.8267296753566", 4)).toBe("185.8267");
    expect(truncateDecimals("0.98999", 2)).toBe("0.98"); // truncation, not 0.99
    expect(truncateDecimals("12.5000", 4)).toBe("12.5");
    expect(truncateDecimals("186.00", 4)).toBe("186");
    expect(truncateDecimals("978", 4)).toBe("978");
  });

  it("passes a whole or malformed string through unchanged", () => {
    expect(truncateDecimals("100", 4)).toBe("100");
    expect(truncateDecimals("not-a-number", 4)).toBe("not-a-number");
  });
});

describe("formatLythDisplay — raw lythoshi → display LYTH", () => {
  it("divides by 10^18 and caps at 4 dp (the reported amounts)", () => {
    expect(formatLythDisplay("185826729675356600000")).toBe("185.8267");
    expect(formatLythDisplay("978000000000000000000")).toBe("978");
    expect(formatLythDisplay("22920000000000000000")).toBe("22.92");
    expect(formatLythDisplay("1000000000000000000")).toBe("1");
    expect(formatLythDisplay("0")).toBe("0");
  });

  it("returns null (→ honest em-dash) for an absent/blank/undecodable amount", () => {
    expect(formatLythDisplay(null)).toBeNull();
    expect(formatLythDisplay(undefined)).toBeNull();
    expect(formatLythDisplay("")).toBeNull();
    expect(formatLythDisplay("   ")).toBeNull();
    expect(formatLythDisplay("not-a-number")).toBeNull();
  });
});

describe("isNativeLythTokenId", () => {
  it("treats null and an all-zero (zero-address) id as native", () => {
    expect(isNativeLythTokenId(null)).toBe(true);
    expect(isNativeLythTokenId("0x" + "00".repeat(32))).toBe(true);
    expect(isNativeLythTokenId("0x0")).toBe(true);
    expect(isNativeLythTokenId("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("treats a real (non-zero) MRC-20 id as a token", () => {
    expect(isNativeLythTokenId("0xdeadbeef")).toBe(false);
  });
});

describe("tokenUnitLabel", () => {
  it("is LYTH for native, the token id for MRC-20", () => {
    expect(tokenUnitLabel(null)).toBe("LYTH");
    expect(tokenUnitLabel("0x" + "00".repeat(32))).toBe("LYTH");
    expect(tokenUnitLabel("0xdeadbeef")).toBe("0xdeadbeef");
  });
});
