// Display preferences store — validated-fallback on READ and on WRITE, the
// 25-entry ISO-4217 table's integrity, and the single truthful locale.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_CURRENCY_DEFAULT,
  DISPLAY_CURRENCY_STORAGE_KEY,
  ISO_4217_CURRENCIES,
  LANGUAGE_DEFAULT,
  LANGUAGE_LABELS,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_VALUES,
  isCurrencyCode,
  readDisplayCurrency,
  readLanguage,
  saveDisplayCurrency,
  saveLanguage,
} from "../display-prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("read — validated fallback", () => {
  it("an absent key reads as the default", () => {
    expect(readLanguage()).toBe("en-US");
    expect(readDisplayCurrency()).toBe("USD");
  });

  it("an unshipped locale falls back to en-US", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr-FR");
    expect(readLanguage()).toBe("en-US");
  });

  it("an unknown / non-string currency falls back to USD", () => {
    for (const bad of ["XYZ", "usd", "", "42", JSON.stringify({ code: "EUR" })]) {
      localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, bad);
      expect(readDisplayCurrency()).toBe("USD");
    }
  });

  it("round-trips every valid value", () => {
    saveLanguage("en-US");
    expect(readLanguage()).toBe("en-US");
    for (const code of ["EUR", "JPY", "KWD", "USD"]) {
      saveDisplayCurrency(code);
      expect(readDisplayCurrency()).toBe(code);
    }
  });
});

describe("write — validated on the way in too", () => {
  it("an invalid currency persists the DEFAULT, never the bad value", () => {
    saveDisplayCurrency("XYZ");
    expect(localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY)).toBe(DISPLAY_CURRENCY_DEFAULT);
    expect(readDisplayCurrency()).toBe("USD");
  });

  it("an invalid language persists the DEFAULT", () => {
    saveLanguage("fr-FR");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe(LANGUAGE_DEFAULT);
  });

  it("a blocked localStorage neither crashes nor corrupts (reads stay default)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveDisplayCurrency("EUR")).not.toThrow();
    expect(() => saveLanguage("en-US")).not.toThrow();
    expect(readDisplayCurrency()).toBe("USD");
    expect(readLanguage()).toBe("en-US");
  });
});

describe("ISO-4217 table integrity", () => {
  it("has exactly 25 unique, well-formed codes", () => {
    expect(ISO_4217_CURRENCIES).toHaveLength(25);
    const codes = ISO_4217_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(25);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{3}$/);
    for (const entry of ISO_4217_CURRENCIES) expect(entry.name.length).toBeGreaterThan(0);
  });

  it("carries the correct minor-unit decimals for every entry", () => {
    const zero = ["JPY", "KRW", "VND"];
    const three = ["KWD", "BHD", "OMR"];
    for (const entry of ISO_4217_CURRENCIES) {
      expect([0, 2, 3]).toContain(entry.decimals);
      const expected = zero.includes(entry.code) ? 0 : three.includes(entry.code) ? 3 : 2;
      expect(entry.decimals).toBe(expected);
    }
  });

  it("isCurrencyCode is exact and case-sensitive", () => {
    for (const entry of ISO_4217_CURRENCIES) expect(isCurrencyCode(entry.code)).toBe(true);
    for (const bad of ["usd", "XYZ", "", "Eur", 42, null, undefined]) {
      expect(isCurrencyCode(bad)).toBe(false);
    }
  });
});

describe("language — one truthful option", () => {
  it("ships exactly one locale", () => {
    expect(LANGUAGE_VALUES).toEqual(["en-US"]);
    expect(LANGUAGE_DEFAULT).toBe("en-US");
  });

  it("labels en-US with the flag emoji and TWO spaces", () => {
    expect(LANGUAGE_LABELS["en-US"]).toBe("🇺🇸  English (US)");
    // The double space is load-bearing — pin it explicitly.
    expect(LANGUAGE_LABELS["en-US"]).toMatch(/\u{1F1FA}\u{1F1F8} {2}English \(US\)/u);
  });
});
