// Exact derivation helpers behind the Home hero figure and its chips.
//
// The load-bearing property in both: a displayed figure may UNDERSTATE by a
// truncated digit, never overstate. A rounded-up balance crossing a boundary
// would tell the user they hold more than they do.

import { describe, expect, it } from "vitest";
import { formatLythFixed } from "../lyth-display";
import { delegatedLythoshiFromBps } from "../delegation-summary";

describe("formatLythFixed — fixed, padded, truncated", () => {
  it("pads a whole value to the requested decimals", () => {
    expect(formatLythFixed("0", 2)).toBe("0.00");
    expect(formatLythFixed("1000000000000000000", 2)).toBe("1.00");
  });

  it("TRUNCATES rather than rounds — the overstatement pin", () => {
    // 99.999999999999999999 LYTH. Rounding would render 100.00 and claim funds
    // the wallet does not hold.
    expect(formatLythFixed(99999999999999999999n, 2)).toBe("99.99");
    expect(formatLythFixed(99999999999999999999n, 2)).not.toBe("100.00");
  });

  it("preserves en-US grouping in the integer part", () => {
    expect(formatLythFixed("1234567000000000000000", 2)).toBe("1,234.56");
  });

  it("dp = 0 yields the integer part with no decimal point", () => {
    expect(formatLythFixed("1234567000000000000000", 0)).toBe("1,234");
    expect(formatLythFixed("1000000000000000000", 0)).toBe("1");
  });

  it("pads a short fraction out to the full width", () => {
    // 1.5 LYTH at 4 dp → the column stays a fixed width.
    expect(formatLythFixed("1500000000000000000", 4)).toBe("1.5000");
  });

  it("accepts a bigint as well as a string", () => {
    expect(formatLythFixed(10n ** 18n, 2)).toBe("1.00");
  });

  it("returns null for an absent, blank or undecodable amount", () => {
    expect(formatLythFixed(null, 2)).toBeNull();
    expect(formatLythFixed(undefined, 2)).toBeNull();
    expect(formatLythFixed("", 2)).toBeNull();
    expect(formatLythFixed("   ", 2)).toBeNull();
    expect(formatLythFixed("abc", 2)).toBeNull();
    expect(formatLythFixed("1.5", 2)).not.toBe("0.00"); // never a fabricated zero
  });

  it("returns null for a nonsense dp rather than throwing", () => {
    expect(formatLythFixed("1000000000000000000", -1)).toBeNull();
    expect(formatLythFixed("1000000000000000000", 1.5)).toBeNull();
  });

  it("never returns a fabricated zero for an unreadable input", () => {
    for (const bad of [null, undefined, "", "abc", "0x10"]) {
      expect(formatLythFixed(bad as string | null, 2)).toBeNull();
    }
  });
});

describe("delegatedLythoshiFromBps — exact weight math", () => {
  it("computes balance × bps / 10000 exactly", () => {
    // 100 LYTH at 25% → 25 LYTH.
    expect(delegatedLythoshiFromBps("100000000000000000000", 2500)).toBe(
      "25000000000000000000",
    );
  });

  it("floors a non-zero remainder (can only understate)", () => {
    // 3 lythoshi × 3333 / 10000 = 0.9999 → 0.
    expect(delegatedLythoshiFromBps("3", 3333)).toBe("0");
    // 7 × 1234 / 10000 = 0.8638 → 0.
    expect(delegatedLythoshiFromBps("7", 1234)).toBe("0");
  });

  it("is exact above 2^53 (bigint, never float)", () => {
    expect(delegatedLythoshiFromBps("9007199254740993", 10_000)).toBe("9007199254740993");
  });

  it("full delegation returns the whole balance", () => {
    expect(delegatedLythoshiFromBps("5000000000000000000", 10_000)).toBe(
      "5000000000000000000",
    );
  });

  it("zero bps with a real balance is an honest '0', not an absence", () => {
    expect(delegatedLythoshiFromBps("5000000000000000000", 0)).toBe("0");
  });

  it("returns null when the balance is absent — never a fabricated 0", () => {
    expect(delegatedLythoshiFromBps(null, 2500)).toBeNull();
    expect(delegatedLythoshiFromBps("", 2500)).toBeNull();
    expect(delegatedLythoshiFromBps("abc", 2500)).toBeNull();
  });

  it("returns null for an out-of-range or non-integer bps", () => {
    expect(delegatedLythoshiFromBps("100", null)).toBeNull();
    expect(delegatedLythoshiFromBps("100", -1)).toBeNull();
    expect(delegatedLythoshiFromBps("100", 10_001)).toBeNull();
    expect(delegatedLythoshiFromBps("100", 12.5)).toBeNull();
    expect(delegatedLythoshiFromBps("100", Number.NaN)).toBeNull();
  });
});

describe("the hero figure split (int / frac)", () => {
  // The hero splits the formatted string on the FIRST "." — safe because
  // formatLyth emits en-US ("." decimal, "," grouping).
  const split = (s: string) => {
    const i = s.indexOf(".");
    return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
  };

  it("keeps a comma-grouped integer part intact", () => {
    const figure = formatLythFixed("1234567000000000000000", 2)!;
    expect(split(figure)).toEqual(["1,234", "56"]);
  });

  it("splits on the first dot only", () => {
    expect(split("1,234.56")).toEqual(["1,234", "56"]);
    expect(split("0.00")).toEqual(["0", "00"]);
  });

  it("handles a dp-0 figure with no fraction", () => {
    expect(split(formatLythFixed("1000000000000000000", 0)!)).toEqual(["1", ""]);
  });
});
