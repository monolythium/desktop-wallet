// One brute-force budget, shared by every surface that verifies the vault
// password.
//
// The membership rule is the whole point. A lockout that only guards the unlock
// screen guards nothing: an attacker with the machine simply uses whichever
// prompt was left unthrottled. Until this phase the Settings reveal was exactly
// that — an Argon2id oracle for the same secret, with no window, no counter, and
// no ceiling on attempts.
//
// This file pins the shared model. The reveal surface's own wiring is exercised
// through the render tests; what matters here is that all three members read and
// write ONE budget, and that waiting never de-escalates it.

import { describe, expect, it, beforeEach } from "vitest";
import {
  clearUnlockLockout,
  lockoutMsForAttempts,
  lockoutRemainingMs,
  readLockoutState,
  recordWrongUnlockAttempt,
} from "../unlock-lockout";

beforeEach(() => {
  localStorage.clear();
  clearUnlockLockout();
});

describe("the schedule", () => {
  it("stays silent below five attempts", () => {
    for (const fails of [0, 1, 2, 3, 4]) {
      expect(lockoutMsForAttempts(fails)).toBe(0);
    }
  });

  it("escalates at 5, 10 and 20", () => {
    expect(lockoutMsForAttempts(5)).toBe(30_000);
    expect(lockoutMsForAttempts(9)).toBe(30_000);
    expect(lockoutMsForAttempts(10)).toBe(300_000);
    expect(lockoutMsForAttempts(19)).toBe(300_000);
    expect(lockoutMsForAttempts(20)).toBe(1_800_000);
    expect(lockoutMsForAttempts(100)).toBe(1_800_000);
  });
});

describe("one budget across surfaces", () => {
  it("attempts from different surfaces accumulate into the same count", () => {
    // The surfaces are not modelled separately — that IS the design. Five
    // wrong passwords is five, whether they were spread across the unlock
    // gate, the drawer and the reveal or all entered in one place.
    for (let i = 0; i < 4; i++) recordWrongUnlockAttempt();
    expect(readLockoutState().failCount).toBe(4);
    expect(readLockoutState().lockoutUntil).toBe(0);

    const fifth = recordWrongUnlockAttempt();
    expect(readLockoutState().failCount).toBe(5);
    expect(fifth.lockoutUntil).toBeGreaterThan(Date.now());
  });

  it("a window armed on one surface is visible to every other", () => {
    for (let i = 0; i < 5; i++) recordWrongUnlockAttempt();
    // A different surface reading the same persisted state sees the window.
    const seen = readLockoutState();
    expect(lockoutRemainingMs(seen.lockoutUntil, Date.now())).toBeGreaterThan(0);
  });

  it("a success anywhere clears it for everyone", () => {
    for (let i = 0; i < 6; i++) recordWrongUnlockAttempt();
    expect(readLockoutState().failCount).toBe(6);
    clearUnlockLockout();
    expect(readLockoutState().failCount).toBe(0);
    expect(readLockoutState().lockoutUntil).toBe(0);
  });
});

describe("waiting never de-escalates", () => {
  it("the count survives an elapsed window", () => {
    for (let i = 0; i < 5; i++) recordWrongUnlockAttempt();
    const armed = readLockoutState();
    // Simulate the window having passed: remaining time is zero...
    expect(lockoutRemainingMs(armed.lockoutUntil, armed.lockoutUntil + 1)).toBe(0);
    // ...but the count is untouched, so the sixth wrong attempt re-arms rather
    // than starting over from a clean slate.
    expect(readLockoutState().failCount).toBe(5);
    const sixth = recordWrongUnlockAttempt();
    expect(readLockoutState().failCount).toBe(6);
    expect(sixth.lockoutUntil).toBeGreaterThan(Date.now());
  });

  it("each attempt past a threshold re-arms a fresh window", () => {
    for (let i = 0; i < 5; i++) recordWrongUnlockAttempt();
    const first = readLockoutState().lockoutUntil;
    const second = recordWrongUnlockAttempt().lockoutUntil;
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

describe("persistence", () => {
  it("survives a reload — the counters live in storage, checked against the clock", () => {
    for (let i = 0; i < 5; i++) recordWrongUnlockAttempt();
    const before = readLockoutState();
    // A fresh read is what a relaunch performs.
    const after = readLockoutState();
    expect(after.failCount).toBe(before.failCount);
    expect(after.lockoutUntil).toBe(before.lockoutUntil);
    expect(localStorage.getItem("wallet.unlockFailCount")).toBe("5");
  });

  it("treats unreadable counters as cleared rather than crashing", () => {
    // The deterrence layer degrades; the Argon2id cost per guess does not.
    localStorage.setItem("wallet.unlockFailCount", "not-a-number");
    localStorage.setItem("wallet.unlockLockoutUntil", "{}");
    const state = readLockoutState();
    expect(state.failCount).toBe(0);
    expect(lockoutRemainingMs(state.lockoutUntil, Date.now())).toBe(0);
  });
});
