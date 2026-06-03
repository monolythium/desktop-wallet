import { beforeEach, describe, expect, it } from "vitest";
import {
  clearUnlockLockout,
  lockoutMsForAttempts,
  lockoutRemainingMs,
  readLockoutState,
  recordWrongUnlockAttempt,
} from "../unlock-lockout";

const MIN = 60_000;

beforeEach(() => {
  localStorage.clear();
});

describe("lockoutMsForAttempts (pure escalation curve)", () => {
  it("imposes no lockout below the first threshold", () => {
    expect(lockoutMsForAttempts(0)).toBe(0);
    expect(lockoutMsForAttempts(4)).toBe(0);
  });

  it("maps each band to the right window", () => {
    expect(lockoutMsForAttempts(5)).toBe(30_000); // 5–9 → 30 s
    expect(lockoutMsForAttempts(9)).toBe(30_000);
    expect(lockoutMsForAttempts(10)).toBe(5 * MIN); // 10–19 → 5 min
    expect(lockoutMsForAttempts(19)).toBe(5 * MIN);
    expect(lockoutMsForAttempts(20)).toBe(30 * MIN); // 20+ → 30 min
    expect(lockoutMsForAttempts(100)).toBe(30 * MIN);
  });
});

describe("lockoutRemainingMs (pure)", () => {
  it("is positive while in the future, 0 once elapsed", () => {
    expect(lockoutRemainingMs(1_000, 0)).toBe(1_000);
    expect(lockoutRemainingMs(1_000, 1_000)).toBe(0); // boundary
    expect(lockoutRemainingMs(1_000, 5_000)).toBe(0); // elapsed
  });
});

describe("recordWrongUnlockAttempt + persistence", () => {
  it("counts up without a window until the first threshold", () => {
    for (let i = 1; i <= 4; i++) {
      const s = recordWrongUnlockAttempt(1_000);
      expect(s.failCount).toBe(i);
      expect(s.lockoutUntil).toBe(0);
    }
    // 5th wrong attempt imposes the 30 s window.
    const fifth = recordWrongUnlockAttempt(1_000);
    expect(fifth.failCount).toBe(5);
    expect(fifth.lockoutUntil).toBe(1_000 + 30_000);
  });

  it("persists across a reload (re-read from storage)", () => {
    recordWrongUnlockAttempt(1_000);
    recordWrongUnlockAttempt(1_000);
    const reloaded = readLockoutState();
    expect(reloaded.failCount).toBe(2);
  });

  it("escalates to 5 min at the 10th attempt", () => {
    let s = readLockoutState();
    for (let i = 0; i < 10; i++) s = recordWrongUnlockAttempt(2_000);
    expect(s.failCount).toBe(10);
    expect(s.lockoutUntil).toBe(2_000 + 5 * MIN);
  });
});

describe("reset on success", () => {
  it("clearUnlockLockout zeroes the count and window", () => {
    for (let i = 0; i < 6; i++) recordWrongUnlockAttempt(1_000);
    expect(readLockoutState().failCount).toBe(6);
    clearUnlockLockout();
    expect(readLockoutState()).toEqual({ failCount: 0, lockoutUntil: 0 });
  });
});

describe("already-elapsed lockout on mount", () => {
  it("reports no remaining time once the window has passed (count retained)", () => {
    // Simulate a stored lockout that has since elapsed.
    localStorage.setItem("wallet.unlockFailCount", "5");
    localStorage.setItem("wallet.unlockLockoutUntil", "1000");
    const s = readLockoutState();
    expect(s.failCount).toBe(5); // count persists across an elapsed window
    expect(lockoutRemainingMs(s.lockoutUntil, 50_000)).toBe(0); // input re-enables
  });
});
