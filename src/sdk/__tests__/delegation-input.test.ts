// The anchored parse for fund-relevant delegation fields.
//
// These are not hypothetical inputs. Every string asserted as refused below was
// verified to be accepted by the previous `parseInt(raw, 10)` parse and silently
// reduced to a different number — on fields whose value becomes a signed
// delegation weight or a destination cluster id.

import { describe, expect, it } from "vitest";
import { parseExactNonNegativeInteger } from "../delegation-input";

describe("parseExactNonNegativeInteger", () => {
  describe("the verified hazards — refused, never truncated", () => {
    it("refuses exponent forms, which a number input accepts and parseInt read as 1", () => {
      // parseInt("1e1", 10) === 1 — a user aiming at cluster 10 reached cluster 1.
      expect(parseExactNonNegativeInteger("1e1")).toBeNull();
      // parseInt("1e3", 10) === 1 — 1000 bps (10%) entered, 1 bps (0.01%) signed.
      expect(parseExactNonNegativeInteger("1e3")).toBeNull();
      expect(parseExactNonNegativeInteger("1e5")).toBeNull();
      expect(parseExactNonNegativeInteger("1E3")).toBeNull();
    });

    it("refuses a decimal rather than truncating toward zero", () => {
      // parseInt("12.9", 10) === 12
      expect(parseExactNonNegativeInteger("12.9")).toBeNull();
      expect(parseExactNonNegativeInteger("1.5")).toBeNull();
      expect(parseExactNonNegativeInteger("0.9")).toBeNull();
    });

    it("refuses trailing garbage rather than reading the numeric prefix", () => {
      // parseInt("50abc", 10) === 50
      expect(parseExactNonNegativeInteger("50abc")).toBeNull();
      expect(parseExactNonNegativeInteger("10 000")).toBeNull();
      expect(parseExactNonNegativeInteger("5,000")).toBeNull();
    });
  });

  describe("plainly invalid input", () => {
    it("refuses an empty or whitespace-only field", () => {
      expect(parseExactNonNegativeInteger("")).toBeNull();
      expect(parseExactNonNegativeInteger("   ")).toBeNull();
    });

    it("refuses a sign, because every field it guards is non-negative", () => {
      expect(parseExactNonNegativeInteger("-1")).toBeNull();
      expect(parseExactNonNegativeInteger("+1")).toBeNull();
    });

    it("refuses non-numeric text", () => {
      expect(parseExactNonNegativeInteger("abc")).toBeNull();
      expect(parseExactNonNegativeInteger("Infinity")).toBeNull();
      expect(parseExactNonNegativeInteger("NaN")).toBeNull();
    });

    it("refuses a digit string too large to survive as an exact number", () => {
      // Beyond Number.MAX_SAFE_INTEGER the parsed value no longer equals what was
      // typed, which is the whole failure this function exists to prevent.
      expect(parseExactNonNegativeInteger("9007199254740993")).toBeNull();
      expect(parseExactNonNegativeInteger("999999999999999999999")).toBeNull();
    });
  });

  describe("legitimate values — accepted unchanged", () => {
    it("accepts the weights the delegation forms are built around", () => {
      expect(parseExactNonNegativeInteger("1")).toBe(1);
      expect(parseExactNonNegativeInteger("1000")).toBe(1000);
      expect(parseExactNonNegativeInteger("5000")).toBe(5000);
      expect(parseExactNonNegativeInteger("10000")).toBe(10000);
    });

    it("accepts zero, because a cluster id may legitimately be 0", () => {
      expect(parseExactNonNegativeInteger("0")).toBe(0);
    });

    it("accepts leading zeros, which are unambiguous", () => {
      expect(parseExactNonNegativeInteger("0010")).toBe(10);
    });

    it("trims surrounding whitespace before testing", () => {
      // Trimming agrees with the autovote custom field, which already trims, and
      // cannot rescue a hazardous value — " 1e1 " is still refused.
      expect(parseExactNonNegativeInteger("  12  ")).toBe(12);
      expect(parseExactNonNegativeInteger("\t500\n")).toBe(500);
      expect(parseExactNonNegativeInteger(" 1e1 ")).toBeNull();
    });
  });

  describe("non-string input", () => {
    it("refuses null and undefined rather than coercing", () => {
      expect(parseExactNonNegativeInteger(null)).toBeNull();
      expect(parseExactNonNegativeInteger(undefined)).toBeNull();
    });
  });
});
