// The fiat display layer — the producer's null contract, the formatter's exact
// math, and the feed helper.
//
// Exact-glyph pins only for $ € £ ¥; the all-25 sweeps assert STRUCTURAL
// properties with the expected symbol derived from the same Intl call, so
// exotic-glyph ICU variance between engines cannot flake the suite.

import { describe, expect, it } from "vitest";
import { formatFiat, formatFiatFromLythoshi, getLythFiatRate } from "../fiat";
import { ISO_4217_CURRENCIES } from "../display-prefs";

const CODES = ISO_4217_CURRENCIES.map((c) => c.code);

/** The glyph Intl uses — the same source the formatter reads. */
function intlSymbol(code: string): string {
  const part = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  return part?.value ?? code;
}

describe("getLythFiatRate — the null producer", () => {
  it("returns null for every shipped currency (no registered LYTH price feed)", () => {
    expect(CODES).toHaveLength(25);
    for (const code of CODES) {
      expect(getLythFiatRate(code)).toBeNull();
    }
  });

  it("returns null for unknown codes too — unconditionally", () => {
    expect(getLythFiatRate("XYZ")).toBeNull();
    expect(getLythFiatRate("")).toBeNull();
    expect(getLythFiatRate("NOPE")).toBeNull();
  });
});

describe("formatFiat — the empty form", () => {
  it("pins the four exact glyphs", () => {
    expect(formatFiat("1", "USD", null)).toBe("$—");
    expect(formatFiat("1", "EUR", null)).toBe("€—");
    expect(formatFiat("1", "GBP", null)).toBe("£—");
    expect(formatFiat("1", "JPY", null)).toBe("¥—");
  });

  it("for ALL 25: symbol + em-dash, non-empty symbol, and NO digit ever", () => {
    for (const code of CODES) {
      const out = formatFiat("1234.5", code, null);
      const symbol = intlSymbol(code);
      expect(symbol.length).toBeGreaterThan(0);
      expect(out).toBe(`${symbol}—`);
      expect(out).toMatch(/^[^0-9]*—$/); // structural: no digit anywhere
      expect(out).not.toBe("$0");
      expect(out).not.toBe("$0.00");
      expect(out).not.toContain("≈");
    }
  });

  it("uses the em-dash U+2014, never a hyphen", () => {
    const out = formatFiat("1", "USD", null);
    expect(out.endsWith("—")).toBe(true);
    expect(out).not.toContain("-");
  });

  it("a non-finite rate is an empty form (NaN / Infinity)", () => {
    expect(formatFiat("1", "USD", Number.NaN)).toBe("$—");
    expect(formatFiat("1", "USD", Number.POSITIVE_INFINITY)).toBe("$—");
    expect(formatFiat("1", "USD", Number.NEGATIVE_INFINITY)).toBe("$—");
  });

  it("an unparseable amount is an empty form EVEN WITH a real rate", () => {
    expect(formatFiat("abc", "USD", 1)).toBe("$—");
    expect(formatFiat("", "USD", 1)).toBe("$—");
    expect(formatFiat("   ", "USD", 1)).toBe("$—");
    expect(formatFiat("12,34", "USD", 1)).toBe("$—"); // invalid comma placement
    expect(formatFiat("1.2.3", "USD", 1)).toBe("$—");
  });
});

describe("formatFiat — the populated form", () => {
  it("renders ≈ + symbol-first value", () => {
    expect(formatFiat("1", "USD", 1)).toBe("≈ $1.00");
    expect(formatFiat("2.5", "EUR", 2)).toBe("≈ €5.00");
  });

  it("respects 0-decimal currencies", () => {
    expect(formatFiat("1000", "JPY", 0.0067)).toBe("≈ ¥7");
  });

  it("respects 3-decimal currencies", () => {
    expect(formatFiat("100", "KWD", 0.003)).toContain("0.300");
  });

  it("the ≈ prefix appears ONLY with a real value", () => {
    expect(formatFiat("1", "USD", 1).startsWith("≈ ")).toBe(true);
    expect(formatFiat("1", "USD", null)).not.toContain("≈");
  });

  it("symbol-first in BOTH forms — the glyph position never moves", () => {
    // The empty form's symbol is a prefix of the populated form's post-≈ text.
    for (const code of ["USD", "EUR", "GBP", "JPY"]) {
      const empty = formatFiat("1", code, null);
      const symbol = empty.slice(0, empty.length - 1);
      expect(formatFiat("1", code, 1).startsWith(`≈ ${symbol}`)).toBe(true);
    }
  });
});

describe("formatFiat — exact magnitude (bigint, never float)", () => {
  it("keeps full magnitude above 2^53", () => {
    // A float path loses the trailing 3.
    expect(formatFiat("9007199254740993", "USD", 1)).toBe(
      "≈ $9,007,199,254,740,993.00",
    );
  });

  it("keeps the fraction on a huge integer part", () => {
    expect(formatFiat("9007199254740993.50", "USD", 1)).toBe(
      "≈ $9,007,199,254,740,993.50",
    );
  });

  it("scales a 1e18-magnitude amount exactly", () => {
    expect(formatFiat("1000000000000000000", "USD", 2.5)).toBe(
      "≈ $2,500,000,000,000,000,000.00",
    );
  });
});

describe("formatFiat — grouping in the feed", () => {
  it("parses the wallet's own comma-grouped formatLyth output", () => {
    expect(formatFiat("1,234.5", "USD", 1)).toBe("≈ $1,234.50");
    expect(formatFiat("1,234,567", "USD", 1)).toBe("≈ $1,234,567.00");
  });

  it("rejects invalid comma placement rather than guessing", () => {
    expect(formatFiat("12,34", "USD", 1)).toBe("$—");
    expect(formatFiat("1,2345", "USD", 1)).toBe("$—");
    expect(formatFiat(",123", "USD", 1)).toBe("$—");
  });
});

describe("formatFiat — a single half-away-from-zero rounding", () => {
  it("rounds a half up in magnitude", () => {
    expect(formatFiat("0.005", "USD", 1)).toBe("≈ $0.01");
  });

  it("rounds below a half down", () => {
    expect(formatFiat("0.004", "USD", 1)).toBe("≈ $0.00");
  });

  it("is away-from-zero, NOT banker's rounding", () => {
    expect(formatFiat("0.5", "JPY", 1)).toBe("≈ ¥1");
    expect(formatFiat("2.5", "JPY", 1)).toBe("≈ ¥3"); // banker's would give ¥2
  });

  it("carries the sign on a rounded negative", () => {
    expect(formatFiat("-0.005", "USD", 1)).toBe("≈ -$0.01");
    expect(formatFiat("-1", "USD", 1)).toBe("≈ -$1.00");
  });

  it("DROPS the sign when the result rounds to zero — never -$0.00", () => {
    expect(formatFiat("-0.001", "USD", 1)).toBe("≈ $0.00");
    expect(formatFiat("-0.004", "USD", 1)).toBe("≈ $0.00");
    expect(formatFiat("1", "USD", -0)).toBe("≈ $0.00");
  });

  it("a negative rate flips the sign", () => {
    expect(formatFiat("1", "USD", -1)).toBe("≈ -$1.00");
    expect(formatFiat("-1", "USD", -1)).toBe("≈ $1.00");
  });
});

describe("formatFiat — exponent-form rates", () => {
  it("parses a decimal-form small rate", () => {
    expect(formatFiat("1000000", "USD", 1e-6)).toBe("≈ $1.00");
  });

  it("parses an exponent-form small rate (String(1e-7) === '1e-7')", () => {
    expect(String(1e-7)).toBe("1e-7"); // documents WHY the parser needs exponents
    expect(formatFiat("10000000", "USD", 1e-7)).toBe("≈ $1.00");
  });

  it("parses an exponent-form large rate", () => {
    expect(formatFiat("1", "USD", 1e21)).toBe(
      "≈ $1,000,000,000,000,000,000,000.00",
    );
  });
});

describe("formatFiat — 18-dp exactness", () => {
  it("handles the smallest lythoshi unit without crashing", () => {
    expect(formatFiat("0.000000000000000001", "USD", 1)).toBe("≈ $0.00");
  });

  it("rounds the EXACT product once (feed ≠ truncated display)", () => {
    // The hero would show 99.99 (truncate-never-round); the estimate describes
    // the real amount and rounds it once.
    expect(formatFiat("99.999999999999999999", "USD", 1)).toBe("≈ $100.00");
  });
});

describe("formatFiat — rate pathologies and zero", () => {
  it("an explicit finite 0 rate renders the real product, not the empty form", () => {
    expect(formatFiat("1000", "USD", 0)).toBe("≈ $0.00");
  });

  it("zero amount + real rate is an honest explicit zero", () => {
    expect(formatFiat("0", "USD", 1)).toBe("≈ $0.00");
  });

  it("zero amount + null rate is the empty form like everything else", () => {
    expect(formatFiat("0", "USD", null)).toBe("$—");
  });
});

describe("formatFiat — never throws", () => {
  it("degrades an Intl-rejected currency to code-as-symbol", () => {
    expect(formatFiat("1", "NOPE", null)).toBe("NOPE—");
    expect(formatFiat("1", "NOPE", 1)).toContain("NOPE");
    expect(formatFiat("1", "", null)).toBe("—");
  });

  it("handles a well-formed but unknown ISO code", () => {
    const out = formatFiat("1", "XYZ", null);
    expect(out.endsWith("—")).toBe(true);
    expect(out).not.toContain("0");
  });

  it("returns a string for every garbage combination", () => {
    const garbage: [string, string, number | null][] = [
      ["abc", "NOPE", Number.NaN],
      ["", "", null],
      ["-", "USD", 1],
      ["1e999999", "USD", 1],
      ["....", "XYZ", 1],
    ];
    for (const [amount, code, rate] of garbage) {
      expect(typeof formatFiat(amount, code, rate)).toBe("string");
    }
  });
});

describe("Intl-vs-stored-decimals cross-check (engine-drift guard)", () => {
  it("agrees for all 25 currencies", () => {
    for (const entry of ISO_4217_CURRENCIES) {
      const resolved = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: entry.code,
        currencyDisplay: "narrowSymbol",
      }).resolvedOptions().maximumFractionDigits;
      expect({ code: entry.code, digits: resolved }).toEqual({
        code: entry.code,
        digits: entry.decimals,
      });
    }
  });
});

describe("formatFiatFromLythoshi — the feed helper", () => {
  it("converts exact lythoshi through the one SDK converter", () => {
    expect(formatFiatFromLythoshi(10n ** 18n, "USD", 1)).toBe("≈ $1.00");
    expect(formatFiatFromLythoshi("1000000000000000000", "USD", 1)).toBe("≈ $1.00");
  });

  it("feeds FULL precision, not the display-truncated figure", () => {
    // 99.999999999999999999 LYTH — a 2-dp display feed would give $99.99.
    expect(formatFiatFromLythoshi(99999999999999999999n, "USD", 1)).toBe("≈ $100.00");
  });

  it("an absent or undecodable amount degrades to the empty form", () => {
    expect(formatFiatFromLythoshi(null, "USD", 1)).toBe("$—");
    expect(formatFiatFromLythoshi(undefined, "USD", 1)).toBe("$—");
    expect(formatFiatFromLythoshi("", "USD", 1)).toBe("$—");
    expect(formatFiatFromLythoshi("   ", "USD", 1)).toBe("$—");
    expect(formatFiatFromLythoshi("abc", "USD", 1)).toBe("$—");
  });

  it("a null rate is the empty form regardless of the amount", () => {
    expect(formatFiatFromLythoshi(10n ** 18n, "USD", null)).toBe("$—");
    expect(formatFiatFromLythoshi(0n, "EUR", null)).toBe("€—");
  });

  it("zero lythoshi with a real rate is an honest zero", () => {
    expect(formatFiatFromLythoshi(0n, "USD", 1)).toBe("≈ $0.00");
  });

  it("the produced rate wires end-to-end to the empty form", () => {
    // The integration the slots actually perform.
    for (const code of ["USD", "EUR", "JPY", "KWD"]) {
      const out = formatFiatFromLythoshi(10n ** 18n, code, getLythFiatRate(code));
      expect(out).toBe(`${intlSymbol(code)}—`);
      expect(out).not.toMatch(/[0-9]/);
    }
  });
});
