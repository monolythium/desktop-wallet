// The whole-LYTH effective-weight floor.
//
// Two different quantities have been sharing one label. The precise delegated
// amount is balance x bps / 10000. The chain's effective weight is that figure
// floored onto whole LYTH — a fractional remainder earns nothing and casts no
// vote. Showing "530.1 LYTH" where the chain credits 530 overstates a position
// by exactly the part that does not count, and it does so on the surface a user
// reads to decide whether to delegate more.
//
// The floor is display-only. The signed transaction still carries bps.

import { describe, expect, it } from "vitest";
import {
  effectiveWeightLythDisplay,
  effectiveWeightLythoshi,
  effectiveWeightWholeLyth,
} from "../delegation-derive";

/** 1000 LYTH in raw lythoshi. */
const THOUSAND = (1000n * 10n ** 18n).toString();
/** 2 LYTH — small enough that a partial weight floors to zero. */
const TWO = (2n * 10n ** 18n).toString();

describe("effectiveWeightWholeLyth", () => {
  it("floors 1000 LYTH at 5301 bps to 530, not 530.1", () => {
    // The pinned example: the chain credits 530 and votes with 530.
    expect(effectiveWeightWholeLyth(THOUSAND, 5301)).toBe("530");
    // What the precise derivation would have shown on the same input.
    expect(effectiveWeightLythDisplay(THOUSAND, 5301)).toBe("530.1");
  });

  it("floors a sub-1-LYTH weight to 0 — an accepted but inert delegation", () => {
    // The row legitimately exists on-chain and earns nothing. "0 LYTH" is the
    // chain's truth here, not an error state.
    expect(effectiveWeightWholeLyth(TWO, 4999)).toBe("0");
  });

  it("is exact at a whole boundary", () => {
    expect(effectiveWeightWholeLyth(THOUSAND, 10_000)).toBe("1000");
    expect(effectiveWeightWholeLyth(THOUSAND, 5_000)).toBe("500");
    expect(effectiveWeightWholeLyth(THOUSAND, 1)).toBe("0");
  });

  it("never rounds up", () => {
    // 999.9999... must not present as 1000.
    const almost = (10_000n * 10n ** 18n - 1n).toString();
    expect(effectiveWeightWholeLyth(almost, 10_000)).toBe("9999");
  });

  it("stays exact far above 2^53, where a float derivation would drift", () => {
    const huge = (123_456_789n * 10n ** 18n).toString();
    expect(effectiveWeightWholeLyth(huge, 10_000)).toBe("123456789");
  });

  it("returns null when the balance is unavailable — never a fabricated figure", () => {
    for (const bad of [null, undefined, "", "   ", "not-a-number", "-1"]) {
      expect(effectiveWeightWholeLyth(bad, 5000)).toBeNull();
    }
  });

  it("returns null for an invalid weight", () => {
    for (const bps of [-1, 1.5, NaN]) {
      expect(effectiveWeightWholeLyth(THOUSAND, bps)).toBeNull();
    }
  });

  it("is zero-weight safe", () => {
    expect(effectiveWeightWholeLyth(THOUSAND, 0)).toBe("0");
  });
});

describe("the two quantities stay distinct", () => {
  it("the precise derivation is unchanged by this law", () => {
    // effectiveWeightLythoshi remains available for non-weight derivations; it
    // is simply no longer what a weight LABEL renders.
    expect(effectiveWeightLythoshi(THOUSAND, 5301)).toBe(
      ((1000n * 10n ** 18n * 5301n) / 10_000n).toString(),
    );
  });

  it("the whole-LYTH figure never exceeds the precise one", () => {
    for (const bps of [1, 137, 2500, 5301, 9999, 10_000]) {
      const precise = BigInt(effectiveWeightLythoshi(THOUSAND, bps)!);
      const whole = BigInt(effectiveWeightWholeLyth(THOUSAND, bps)!) * 10n ** 18n;
      expect(whole <= precise).toBe(true);
      // And it loses less than one whole LYTH.
      expect(precise - whole < 10n ** 18n).toBe(true);
    }
  });
});
