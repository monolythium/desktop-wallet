import { describe, expect, it } from "vitest";
import {
  evaluateTokenSendAmount,
  isTokenAmountValid,
  maxTokenAmount,
  tokenAmountBaseToDisplay,
  tokenAmountToBase,
} from "../token-send-compose";

describe("isTokenAmountValid", () => {
  it("accepts a decimal within the token's places, rejects over-precise", () => {
    expect(isTokenAmountValid("1.5", 6)).toBe(true);
    expect(isTokenAmountValid("1.234567", 6)).toBe(true);
    expect(isTokenAmountValid("1.2345678", 6)).toBe(false); // 7 > 6 places
    expect(isTokenAmountValid("", 6)).toBe(false);
    expect(isTokenAmountValid("-1", 6)).toBe(false);
    expect(isTokenAmountValid("abc", 6)).toBe(false);
  });

  it("handles a 0-decimal token without throwing (integer-only)", () => {
    expect(isTokenAmountValid("42", 0)).toBe(true);
    expect(isTokenAmountValid("4.2", 0)).toBe(false); // no fractional for 0-dp
    expect(isTokenAmountValid("0", 0)).toBe(true);
  });
});

describe("tokenAmountToBase / tokenAmountBaseToDisplay — exact round-trip at real decimals", () => {
  it("scales at 6 decimals", () => {
    expect(tokenAmountToBase("1.5", 6)).toBe(1_500_000n);
    expect(tokenAmountBaseToDisplay(1_500_000n, 6)).toBe("1.5");
  });

  it("scales at 18 decimals exactly above 2^53 (no float)", () => {
    expect(tokenAmountToBase("12.345678901234567890", 18)).toBe(12_345_678_901_234_567_890n);
    expect(tokenAmountBaseToDisplay(12_345_678_901_234_567_890n, 18)).toBe("12.34567890123456789");
  });

  it("scales a 0-decimal token as a whole integer", () => {
    expect(tokenAmountToBase("42", 0)).toBe(42n);
    expect(tokenAmountBaseToDisplay(42n, 0)).toBe("42");
  });

  it("round-trips base->display->base for many values", () => {
    for (const [v, d] of [["1.5", 6], ["1000", 6], ["0.000001", 6], ["7", 0], ["3.14159", 18]] as const) {
      const base = tokenAmountToBase(v, d);
      expect(tokenAmountToBase(tokenAmountBaseToDisplay(base, d), d)).toBe(base);
    }
  });

  it("throws on a malformed / over-precise amount", () => {
    expect(() => tokenAmountToBase("1.2345678", 6)).toThrow();
    expect(() => tokenAmountToBase("4.2", 0)).toThrow();
  });
});

describe("maxTokenAmount — full holding, honest on unknowns", () => {
  it("is the exact full balance at the token's decimals", () => {
    expect(maxTokenAmount("1500000", 6)).toBe("1.5");
    expect(maxTokenAmount("42", 0)).toBe("42");
  });

  it("returns null (no fabricated max) when decimals are unknown or balance unparseable", () => {
    expect(maxTokenAmount("1500000", null)).toBeNull();
    expect(maxTokenAmount("1500000", undefined)).toBeNull();
    expect(maxTokenAmount("not-a-number", 6)).toBeNull();
  });
});

describe("evaluateTokenSendAmount — the single fund-safety gate", () => {
  it("accepts a valid amount within balance and returns the encoded base + shown==encoded display", () => {
    const v = evaluateTokenSendAmount("1.5", 6, "2000000"); // holding 2.0
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.amountBase).toBe(1_500_000n);
      expect(v.displayAmount).toBe("1.5"); // exactly what will be signed
      // round-trip: display re-parses to the same base units
      expect(tokenAmountToBase(v.displayAmount, 6)).toBe(v.amountBase);
    }
  });

  it("BLOCKS when decimals are unavailable — never encodes at a guessed scale", () => {
    expect(evaluateTokenSendAmount("1.5", null, "2000000")).toEqual({ ok: false, reason: "unknown-decimals" });
    expect(evaluateTokenSendAmount("1.5", undefined, "2000000")).toEqual({ ok: false, reason: "unknown-decimals" });
  });

  it("blocks empty / zero / over-precise / negative amounts", () => {
    expect(evaluateTokenSendAmount("", 6, "2000000")).toEqual({ ok: false, reason: "empty" });
    expect(evaluateTokenSendAmount("0", 6, "2000000")).toEqual({ ok: false, reason: "zero" });
    expect(evaluateTokenSendAmount("0.0000000", 6, "2000000")).toEqual({ ok: false, reason: "invalid" }); // 7 places
    expect(evaluateTokenSendAmount("1.2345678", 6, "2000000")).toEqual({ ok: false, reason: "invalid" });
  });

  it("blocks an over-balance amount pre-submit (not a chain revert)", () => {
    expect(evaluateTokenSendAmount("2.5", 6, "2000000")).toEqual({ ok: false, reason: "insufficient" }); // holding 2.0
    // exact-balance is allowed
    expect(evaluateTokenSendAmount("2", 6, "2000000").ok).toBe(true);
  });

  it("fails closed on an unparseable balance (never treats it as infinite)", () => {
    expect(evaluateTokenSendAmount("1", 6, "garbage")).toEqual({ ok: false, reason: "insufficient" });
  });

  it("handles a 0-decimal token (integer send, fractional rejected)", () => {
    expect(evaluateTokenSendAmount("5", 0, "10").ok).toBe(true);
    expect(evaluateTokenSendAmount("5.5", 0, "10")).toEqual({ ok: false, reason: "invalid" });
    expect(evaluateTokenSendAmount("11", 0, "10")).toEqual({ ok: false, reason: "insufficient" });
  });

  it("stays exact for an 18-decimal amount above 2^53", () => {
    const balance = "20000000000000000000"; // 20.0
    const v = evaluateTokenSendAmount("12.345678901234567890", 18, balance);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.amountBase).toBe(12_345_678_901_234_567_890n);
  });
});
