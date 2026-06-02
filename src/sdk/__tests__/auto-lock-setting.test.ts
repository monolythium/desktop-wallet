import { describe, expect, it } from "vitest";
import {
  AUTO_LOCK_DEFAULT_MINUTES,
  AUTO_LOCK_OPTIONS,
  normalizeAutoLockMinutes,
} from "../auto-lock-setting";

describe("normalizeAutoLockMinutes", () => {
  it("accepts each allowed option unchanged", () => {
    for (const m of AUTO_LOCK_OPTIONS) {
      expect(normalizeAutoLockMinutes(m)).toBe(m);
    }
  });

  it("falls back to the default for values outside the allowed set", () => {
    expect(normalizeAutoLockMinutes(0)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
    expect(normalizeAutoLockMinutes(7)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
    expect(normalizeAutoLockMinutes(120)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
    expect(normalizeAutoLockMinutes(-15)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
  });

  it("falls back to the default for NaN", () => {
    expect(normalizeAutoLockMinutes(Number.NaN)).toBe(AUTO_LOCK_DEFAULT_MINUTES);
  });

  it("ships a default that is itself one of the allowed options", () => {
    expect((AUTO_LOCK_OPTIONS as readonly number[]).includes(AUTO_LOCK_DEFAULT_MINUTES)).toBe(
      true,
    );
  });
});
