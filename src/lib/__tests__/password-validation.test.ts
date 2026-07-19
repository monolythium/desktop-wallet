// The password policy — a CREATION rule.
//
// The old policy was 12 characters plus four composition classes. The new one is
// 15 code points plus a denylist, with no composition rules at all (NIST SP
// 800-63B-4 §3.1.1.2(5) forbids imposing them). The composition assertions from
// the previous suite are gone deliberately: a test that still demanded an
// uppercase letter would be asserting the rule this change removes.
//
// The boundary these functions must respect is tested separately in
// `legacy-password-unlock.test.ts` — they answer "may this be a NEW password?"
// and must never be consulted about an existing one.

import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  getPasswordStrength,
  isPasswordValid,
  passwordCodePointLength,
  passwordRejectReason,
} from "../password-validation";
import { COMMON_PASSWORD_COUNT, isCommonPassword } from "../common-passwords";

describe("the floor", () => {
  it("is 15", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(15);
  });

  it("accepts exactly 15 code points and refuses 14", () => {
    // Deliberately not a character run — "aaaaaaaaaaaaaaa" is ON the denylist,
    // so it would fail for the other reason and prove nothing about length.
    const fifteen = "zqxjvbnmkhgfdsa";
    expect(passwordCodePointLength(fifteen)).toBe(15);
    expect(isPasswordValid(fifteen)).toBe(true);

    const fourteen = "zqxjvbnmkhgfds";
    expect(passwordCodePointLength(fourteen)).toBe(14);
    expect(isPasswordValid(fourteen)).toBe(false);
    expect(passwordRejectReason(fourteen)).toBe("too_short");
  });

  it("counts CODE POINTS, not UTF-16 units", () => {
    // 8 astral-plane emoji are 16 UTF-16 units but only 8 characters, so this
    // must fail the floor — counting `.length` would wrongly pass it.
    const eight = "😀".repeat(8);
    expect(eight.length).toBe(16);
    expect(passwordCodePointLength(eight)).toBe(8);
    expect(isPasswordValid(eight)).toBe(false);

    const fifteen = "😀".repeat(15);
    expect(passwordCodePointLength(fifteen)).toBe(15);
    expect(isPasswordValid(fifteen)).toBe(true);
  });
});

describe("no composition rules", () => {
  it("accepts an all-lowercase passphrase with spaces", () => {
    // The point of the policy change: this is a good password, and the old
    // rules rejected it for lacking a capital, a digit and a symbol.
    expect(isPasswordValid("this is a passphrase")).toBe(true);
  });

  it("accepts a single character class", () => {
    // "abcdefghijklmnop" is on the denylist (a straight alphabet walk), so
    // these are non-listed equivalents that isolate the composition question.
    expect(isPasswordValid("zqxjvbnmkhgfdsa")).toBe(true);
    expect(isPasswordValid("1234512345123451")).toBe(true);
  });

  it("does not require uppercase, digits or symbols", () => {
    for (const p of [
      "correcthorsebattery0",
      "the rain in spain fall",
      "eeeeeeeeeeeeeeee",
    ]) {
      expect(isPasswordValid(p)).toBe(true);
    }
  });
});

describe("the denylist, and its precedence", () => {
  it("carries real entries", () => {
    expect(COMMON_PASSWORD_COUNT).toBeGreaterThan(150);
  });

  it("refuses a seeded >= 15 entry as `common`", () => {
    // Long enough to clear the floor, which is exactly why the long tier exists:
    // without it the `common` path would be unreachable and decorative.
    expect(passwordCodePointLength("correcthorsebatterystaple")).toBeGreaterThanOrEqual(15);
    expect(passwordRejectReason("correcthorsebatterystaple")).toBe("common");
    expect(isPasswordValid("correcthorsebatterystaple")).toBe(false);
    expect(isPasswordValid("monolythiumwallet")).toBe(false);
  });

  it("reports LENGTH first for a short denylisted password", () => {
    // "password123" is on the list AND under the floor. Both rules fire; the
    // user's actionable problem is the length, so that is what is reported.
    expect(isCommonPassword("password123")).toBe(true);
    expect(passwordCodePointLength("password123")).toBeLessThan(MIN_PASSWORD_LENGTH);
    expect(passwordRejectReason("password123")).toBe("too_short");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(isCommonPassword("  CorrectHorseBatteryStaple  ")).toBe(true);
    expect(isCommonPassword("MONOLYTHIUMWALLET")).toBe(true);
  });

  it("does not refuse a password that merely CONTAINS an entry", () => {
    // Substring matching would reject far too much; the list is exact-match.
    expect(isCommonPassword("mypasswordisagoodone")).toBe(false);
    expect(isPasswordValid("mypasswordisagoodone")).toBe(true);
  });
});

describe("the secret itself is never normalized", () => {
  it("counts a trailing space as a character", () => {
    // 14 letters + a trailing space = 15 code points, and it passes. The stored
    // secret keeps that space; only the denylist LOOKUP trims.
    const withSpace = "abcdefghijklmn ";
    expect(passwordCodePointLength(withSpace)).toBe(15);
    expect(isPasswordValid(withSpace)).toBe(true);
  });

  it("treats a padded password as distinct from its trimmed form", () => {
    // Both valid, but they are different secrets — nothing here collapses them.
    expect(isPasswordValid(" this is a passphrase ")).toBe(true);
    expect(" this is a passphrase ").not.toBe("this is a passphrase");
  });
});

describe("the strength bands are visual only", () => {
  it("maps length to a band", () => {
    expect(getPasswordStrength("")).toBe("none");
    expect(getPasswordStrength("a")).toBe("too-short");
    expect(getPasswordStrength("a".repeat(14))).toBe("too-short");
    expect(getPasswordStrength("a".repeat(15))).toBe("fair");
    expect(getPasswordStrength("a".repeat(19))).toBe("fair");
    expect(getPasswordStrength("a".repeat(20))).toBe("strong");
    expect(getPasswordStrength("a".repeat(40))).toBe("strong");
  });

  it("G5 — a `fair` password is fully acceptable", () => {
    // If a band ever gated submission it would be a second, hidden policy.
    const fair = "purple llama sky";
    expect(passwordCodePointLength(fair)).toBe(16);
    expect(getPasswordStrength(fair)).toBe("fair");
    expect(isPasswordValid(fair)).toBe(true);
  });

  it("bands by length alone, ignoring composition", () => {
    // A 15-char password carrying every character class is still only "fair".
    expect(getPasswordStrength("Abcdef1!ghijklm")).toBe("fair");
  });

  it("a `strong` band does not override the denylist", () => {
    const long = "correcthorsebatterystaple";
    expect(getPasswordStrength(long)).toBe("strong");
    expect(isPasswordValid(long)).toBe(false);
  });
});
