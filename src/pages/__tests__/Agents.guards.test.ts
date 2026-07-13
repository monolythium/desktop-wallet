// The two render-throw guards that previously white-screened the Agents page:
// a huge on-chain expiry through `new Date().toISOString()` (RangeError) and a
// malformed policyExpiry through `BigInt()` (throws).

import { describe, expect, it } from "vitest";
import { MAX_DATE_MS, expiryUnixToIso, safeBigInt } from "../Agents";

describe("safeBigInt", () => {
  it("parses valid values and never throws on garbage", () => {
    expect(safeBigInt(5n)).toBe(5n);
    expect(safeBigInt("10")).toBe(10n);
    expect(safeBigInt(undefined)).toBe(0n);
    expect(safeBigInt(null)).toBe(0n);
    expect(safeBigInt("not-a-number")).toBe(0n);
    expect(safeBigInt({})).toBe(0n);
  });
});

describe("expiryUnixToIso", () => {
  it("formats a normal expiry", () => {
    expect(expiryUnixToIso(0n)).toMatch(/^1970-01-01/);
    expect(expiryUnixToIso(1_800_000_000n)).toMatch(/^20\d\d-/); // a real future date
  });

  it("returns an em-dash instead of throwing a RangeError on an overflowing expiry", () => {
    // 1e13 s * 1000 = 1e16 ms, past the Date range → old code threw here.
    expect(() => expiryUnixToIso(10_000_000_000_000n)).not.toThrow();
    expect(expiryUnixToIso(10_000_000_000_000n)).toBe("—");
    expect(MAX_DATE_MS).toBe(8_640_000_000_000_000);
  });
});
