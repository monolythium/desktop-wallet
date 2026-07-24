import { describe, expect, it } from "vitest";
import {
  formatAtomic1e18,
  formatLythDisplay,
  formatTokenAmountDisplay,
  isNativeLythTokenId,
  NATIVE_LYTH_TOKEN_ID,
  tokenUnitLabel,
  truncateDecimals,
} from "../lyth-display";

describe("NATIVE_LYTH_TOKEN_ID — the id chain reads (`lyth_getAssetPolicy`) require", () => {
  it("is a 0x-prefixed 32-byte hex id (66 chars), never the ticker", () => {
    expect(NATIVE_LYTH_TOKEN_ID).toMatch(/^0x[0-9a-f]{64}$/);
    expect(NATIVE_LYTH_TOKEN_ID).not.toBe("LYTH");
  });

  it("is the all-zero native sentinel the wallet already recognizes", () => {
    // mono-core: `NATIVE_LYTH_TOKEN_ID: Hash = Hash::ZERO` (schema.rs:62).
    expect(NATIVE_LYTH_TOKEN_ID).toBe("0x" + "00".repeat(32));
    expect(isNativeLythTokenId(NATIVE_LYTH_TOKEN_ID)).toBe(true);
  });
});

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

  it("caps at the caller's decimals — Home passes 2, other surfaces keep the 4-dp default", () => {
    // The Home hero leak rendered un-truncated as 965.988269999999999977 LYTH.
    // From the raw lythoshi the exact bigint formatter yields 965.98 at 2 dp,
    // while every other surface keeps the 4-dp default (965.9882).
    const leak = "965988269999999999977";
    expect(formatLythDisplay(leak, 2)).toBe("965.98");
    expect(formatLythDisplay(leak, 4)).toBe("965.9882");
    expect(formatLythDisplay(leak)).toBe("965.9882");
  });

  it("returns null (→ honest em-dash) for an absent/blank/undecodable amount", () => {
    expect(formatLythDisplay(null)).toBeNull();
    expect(formatLythDisplay(undefined)).toBeNull();
    expect(formatLythDisplay("")).toBeNull();
    expect(formatLythDisplay("   ")).toBeNull();
    expect(formatLythDisplay("not-a-number")).toBeNull();
  });
});

describe("formatTokenAmountDisplay — raw base units → display at token decimals", () => {
  it("scales by 10^decimals for a 6-dp token (the raw-units bug fix)", () => {
    // 1.5 of a 6-dp token is raw "1500000"; the old Number(raw) path showed
    // 1,500,000. The decimals-aware path shows 1.5.
    expect(formatTokenAmountDisplay("1500000", 6)).toBe("1.5");
    expect(formatTokenAmountDisplay("1234567", 6)).toBe("1.2345"); // truncated at 4dp
    expect(formatTokenAmountDisplay("1000000", 6)).toBe("1");
    expect(formatTokenAmountDisplay("0", 6)).toBe("0");
  });

  it("handles 18-dp tokens exactly above 2^53 (no float precision loss)", () => {
    // 12.345678901234567890 of an 18-dp token; > 2^53 where Number() drops digits.
    expect(formatTokenAmountDisplay("12345678901234567890", 18)).toBe("12.3456");
    expect(formatTokenAmountDisplay("1000000000000000000", 18)).toBe("1");
  });

  it("shows a 0-decimal token as a whole integer", () => {
    expect(formatTokenAmountDisplay("42", 0)).toBe("42");
  });

  it("handles more than 18 decimals by truncating onto the 18-atom grid", () => {
    // 1.5 of a 20-dp token is raw "150000000000000000000".
    expect(formatTokenAmountDisplay("150000000000000000000", 20)).toBe("1.5");
  });

  it("respects the caller's display cap and trims trailing zeros", () => {
    expect(formatTokenAmountDisplay("1234567", 6, 2)).toBe("1.23");
    expect(formatTokenAmountDisplay("1500000", 6, 2)).toBe("1.5");
  });

  it("returns null (→ honest em-dash) for absent/undecodable input or bad decimals", () => {
    expect(formatTokenAmountDisplay(null, 6)).toBeNull();
    expect(formatTokenAmountDisplay(undefined, 6)).toBeNull();
    expect(formatTokenAmountDisplay("", 6)).toBeNull();
    expect(formatTokenAmountDisplay("   ", 6)).toBeNull();
    expect(formatTokenAmountDisplay("not-a-number", 6)).toBeNull();
    expect(formatTokenAmountDisplay("1500000", -1)).toBeNull();
    expect(formatTokenAmountDisplay("1500000", 6.5)).toBeNull();
    expect(formatTokenAmountDisplay("1500000", 256)).toBeNull();
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

describe("formatAtomic1e18 — exact, truncated, never float-rounded", () => {
  it("truncates rather than rounds (the fund-safety fix)", () => {
    // 1.999999999999999999 units. The old Number(n)/1e18 float path rounded the
    // integer UP to 2e18 and rendered '2.00' — overstating the figure. The exact
    // bigint path truncates to '1.99'.
    expect(formatAtomic1e18("1999999999999999999")).toBe("1.99 (1e18 atoms)");
  });

  it("stays exact for values above 2^53 (no float precision loss)", () => {
    // 12.345678901234567890 units; > 2^53, where Number() drops integer digits.
    expect(formatAtomic1e18("12345678901234567890")).toBe("12.34 (1e18 atoms)");
  });

  it("respects the requested precision and trims trailing zeros", () => {
    expect(formatAtomic1e18("5000000000000000000")).toBe("5 (1e18 atoms)");
    expect(formatAtomic1e18("2500000000000000000", 4)).toBe("2.5 (1e18 atoms)");
  });

  it("shows sub-unit values as the exact raw integer", () => {
    expect(formatAtomic1e18("500")).toBe("500");
    expect(formatAtomic1e18("0")).toBe("0");
  });

  it("is an honest em-dash for absent or undecodable input", () => {
    expect(formatAtomic1e18(undefined)).toBe("—");
    expect(formatAtomic1e18(null)).toBe("—");
    expect(formatAtomic1e18("not-a-number")).toBe("—");
  });
});
