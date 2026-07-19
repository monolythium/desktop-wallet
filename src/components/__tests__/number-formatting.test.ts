// Law 7 — number and locale formatting.
//
// Two historical defects motivate this file, and both were live in `fmt()`:
//
//   ROUNDING. `Intl` rounds. `fmt(99.999, 2)` produced "100.00" — a display
//   that overstates funds across a boundary, from which a user can compute an
//   amount that crosses an on-chain cap and reverts.
//
//   AMBIENT LOCALE. `toLocaleString(undefined, …)` follows the operating
//   system, so the same balance rendered "1,234.50" here and "1.234,50" on a
//   machine set to German — and any code that later split on "." mangled it.
//
// Plus A1: a FEE has its own precision rule. The balance convention prints "0"
// for a floor-priced fee, which is a wallet claiming it charged nothing for a
// charge it decoded.

import { describe, expect, it } from "vitest";
import { fmt, pct } from "../format";
import { formatFeeLythDisplay, formatLythDisplay } from "../../sdk/lyth-display";
import { nativeFracDigits } from "../../sdk/token-rows";

describe("fmt — truncation, never rounding", () => {
  it("99.999 at 2dp is 99.99, never 100.00", () => {
    // The pinned regression. Rounding here overstates funds.
    expect(fmt(99.999, 2)).toBe("99.99");
  });

  it("does not round up at any boundary", () => {
    expect(fmt(0.999, 2)).toBe("0.99");
    expect(fmt(1.9999, 3)).toBe("1.999");
    expect(fmt(9.99999, 4)).toBe("9.9999");
  });

  it("pads to the requested precision", () => {
    expect(fmt(1.5, 2)).toBe("1.50");
    expect(fmt(2, 2)).toBe("2.00");
  });

  it("supports zero fractional digits", () => {
    expect(fmt(1234.99, 0)).toBe("1,234");
  });
});

describe("fmt — explicit en-US, never the ambient locale", () => {
  it("groups with commas and uses a period decimal", () => {
    expect(fmt(1234.5, 2)).toBe("1,234.50");
    expect(fmt(1234567.89, 2)).toBe("1,234,567.89");
  });

  it("is stable regardless of the host locale", () => {
    // The old implementation returned "1.234,50" on a de-DE machine. This
    // asserts the output shape directly: exactly one period, and commas only
    // as group separators.
    const out = fmt(1234567.5, 2);
    expect(out.split(".").length - 1).toBe(1);
    expect(out).toBe("1,234,567.50");
  });
});

describe("fmt — absence is not a zero", () => {
  it("null and undefined render the em-dash", () => {
    expect(fmt(null)).toBe("—");
    expect(fmt(undefined)).toBe("—");
  });

  it("a non-finite value renders the em-dash, never NaN", () => {
    expect(fmt(Number.NaN)).toBe("—");
    expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("never prints a negative zero", () => {
    // "-0.00" reads as a loss that did not happen.
    expect(fmt(-0.001, 2)).toBe("0.00");
    expect(fmt(-0)).toBe("0.00");
  });

  it("keeps a real negative", () => {
    expect(fmt(-1234.56, 2)).toBe("-1,234.56");
  });
});

describe("native LYTH renders from the exact integer, not a float", () => {
  it("99999999999999999999 lythoshi is 99.99 at 2dp", () => {
    // The float path would round this to 100.00 and overstate the balance.
    expect(formatLythDisplay("99999999999999999999", 2)).toBe("99.99");
  });

  it("the magnitude tiers are shared by the row and the detail page", () => {
    expect(nativeFracDigits(150)).toBe(2);
    expect(nativeFracDigits(5)).toBe(3);
    expect(nativeFracDigits(0.5)).toBe(4);
    expect(nativeFracDigits(100)).toBe(2);
    expect(nativeFracDigits(1)).toBe(3);
  });

  it("an absent balance is null, so the caller shows an honest absence", () => {
    expect(formatLythDisplay(null)).toBeNull();
    expect(formatLythDisplay("")).toBeNull();
  });
});

describe("A1 — a fee has its own precision rule", () => {
  // 0.000042 LYTH — the order of magnitude of a fee at today's floor pricing.
  const FLOOR_FEE = "42000000000000";

  it("the balance convention would print a zero for it (the defect)", () => {
    // Documented here so the reason for a separate formatter is visible: this
    // is what the fee rows rendered before.
    expect(formatLythDisplay(FLOOR_FEE, 4)).toBe("0");
  });

  it("the fee rule shows the real value instead", () => {
    const out = formatFeeLythDisplay(FLOOR_FEE);
    expect(out).not.toBeNull();
    expect(out).toBe("0.000042");
    // Never a zero for a charge that happened…
    expect(out).not.toBe("0");
    // …and never the rounded-up form, which overstates this fee ~2.4×.
    expect(out).not.toBe("0.0001");
  });

  it("an ordinary fee reads normally — exactness costs no readability", () => {
    expect(formatFeeLythDisplay("2500000000000000")).toBe("0.0025");
    expect(formatFeeLythDisplay("1500000000000000000")).toBe("1.5");
  });

  it("never UNDER-reports either — 0.000147 is not 0.0001", () => {
    // The other half of the defect. A 4 dp cap understates this charge by a
    // third; truncation is the safe direction for a balance, not for a fee.
    expect(formatFeeLythDisplay("147000000000000")).toBe("0.000147");
  });

  it("a genuinely zero fee returns null so the row is omitted", () => {
    // Absence is honest; a zero is a claim.
    expect(formatFeeLythDisplay("0")).toBeNull();
  });

  it("an absent or undecodable fee returns null", () => {
    expect(formatFeeLythDisplay(null)).toBeNull();
    expect(formatFeeLythDisplay(undefined)).toBeNull();
    expect(formatFeeLythDisplay("")).toBeNull();
    expect(formatFeeLythDisplay("not-a-number")).toBeNull();
  });

  it("never returns a string that reads as zero", () => {
    // The invariant, across the whole plausible fee range.
    for (const wei of ["1", "42000000000000", "2500000000000000", "1000000000000000000"]) {
      const out = formatFeeLythDisplay(wei);
      expect(out, wei).not.toBeNull();
      expect(/^0(\.0+)?$/.test(out!), `${wei} → ${out}`).toBe(false);
    }
  });
});

describe("pct is locale-independent", () => {
  it("uses toFixed, so the decimal is always a period", () => {
    expect(pct(0.125, 1)).toBe("12.5%");
    expect(pct(0.5, 0)).toBe("50%");
  });
});
