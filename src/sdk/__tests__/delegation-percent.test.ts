// Percent → basis points, exactly.
//
// The wire unit is bps and stays bps: `delegate(uint32, uint16)` decodes the
// weight with `abi::decode_u16` and `validate_weight` accepts 1..=10000
// (MAX_TOTAL_WEIGHT_BPS: u16 = 10_000). Percent is presentation and input
// parsing only — nothing in the signing path may carry a percent.
//
// WHY A STRING PARSE AND NOT ARITHMETIC. Percent → bps looks like "multiply by
// 100", and in IEEE-754 doubles it is not:
//
//     0.07 * 100 === 7.000000000000001
//     0.29 * 100 === 28.999999999999996     ← Math.floor gives 28 bps
//
// 1146 of the 10000 representable weights fail a naive float round-trip. A
// floor-based conversion would sign a weight one bps below what the user typed,
// on more than a tenth of all inputs, silently. So the conversion never
// produces a float: it splits the string and assembles an integer.
//
// The sweep at the bottom is the real assertion — every legal weight, both
// directions, no exceptions.

import { describe, expect, it } from "vitest";
import { formatBpsAsPercentInput, parsePercentToBps } from "../delegation-input";

describe("parsePercentToBps — exact, or nothing", () => {
  it("converts whole percents", () => {
    expect(parsePercentToBps("1")).toBe(100);
    expect(parsePercentToBps("10")).toBe(1000);
    expect(parsePercentToBps("50")).toBe(5000);
    expect(parsePercentToBps("100")).toBe(10000);
  });

  it("converts one and two decimal places", () => {
    expect(parsePercentToBps("0.5")).toBe(50);
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("0.01")).toBe(1);
    expect(parsePercentToBps("99.99")).toBe(9999);
  });

  it("reads 0.29 as 29 bps and never as 28", () => {
    // The float trap, named: 0.29 * 100 === 28.999999999999996.
    expect(parsePercentToBps("0.29")).toBe(29);
    expect(parsePercentToBps("0.29")).not.toBe(28);
  });

  it("reads 0.07 as 7 bps — the other documented float failure", () => {
    expect(parsePercentToBps("0.07")).toBe(7);
  });

  it("holds both ends of the chain's accepted range", () => {
    // validate_weight: 0 → ZeroWeight, >10000 → WeightOutOfRange.
    expect(parsePercentToBps("0.01")).toBe(1); // smallest non-zero weight
    expect(parsePercentToBps("100")).toBe(10000); // full share
  });

  it("REJECTS a third decimal place rather than rounding it", () => {
    // Not representable in whole bps. Refuse, do not reinterpret — the same law
    // the anchored integer parse in this module already enforces.
    expect(parsePercentToBps("0.005")).toBeNull();
    expect(parsePercentToBps("12.345")).toBeNull();
    expect(parsePercentToBps("1.001")).toBeNull();
  });

  it("REJECTS the exponent forms a type=number field will hand through", () => {
    // There is no <form> on the page, so native constraint validation never
    // runs and "1e1" reaches the parser verbatim.
    expect(parsePercentToBps("1e1")).toBeNull();
    expect(parsePercentToBps("1e-2")).toBeNull();
  });

  it("REJECTS signs, blanks, units and partial decimals", () => {
    for (const bad of ["", "  ", "-1", "+1", "abc", "50%", ".5", "1.", "1..2", "1,5"]) {
      expect(parsePercentToBps(bad)).toBeNull();
    }
  });

  it("REJECTS a non-string", () => {
    expect(parsePercentToBps(null)).toBeNull();
    expect(parsePercentToBps(undefined)).toBeNull();
  });

  it("tolerates surrounding whitespace, like the integer parse does", () => {
    expect(parsePercentToBps("  12.5  ")).toBe(1250);
  });

  it("does NOT clamp out-of-range input — it reports what was typed", () => {
    // Range is the caller's refusal to make, with an explanation. Silently
    // lowering 500% to 100% would build a plan against a weight nobody set.
    expect(parsePercentToBps("500")).toBe(50000);
    expect(parsePercentToBps("0")).toBe(0);
  });
});

describe("formatBpsAsPercentInput — the editable round trip", () => {
  it("renders a whole percent without trailing zeros", () => {
    expect(formatBpsAsPercentInput(1000)).toBe("10");
    expect(formatBpsAsPercentInput(10000)).toBe("100");
  });

  it("renders fractional percents minimally", () => {
    expect(formatBpsAsPercentInput(2950)).toBe("29.5");
    expect(formatBpsAsPercentInput(29)).toBe("0.29");
    expect(formatBpsAsPercentInput(1)).toBe("0.01");
  });
});

describe("percent ↔ bps over the entire representable set", () => {
  it("round-trips every one of the 10000 legal weights exactly", () => {
    const broken: number[] = [];
    for (let bps = 1; bps <= 10_000; bps++) {
      if (parsePercentToBps(formatBpsAsPercentInput(bps)) !== bps) broken.push(bps);
    }
    // A float implementation fails 1146 of these. Exact means exact.
    expect(broken).toEqual([]);
  });

  it("never lands one bps low, which is how a float implementation fails", () => {
    for (let bps = 1; bps <= 10_000; bps++) {
      expect(parsePercentToBps(formatBpsAsPercentInput(bps))).not.toBe(bps - 1);
    }
  });
});
