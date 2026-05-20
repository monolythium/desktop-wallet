// auto-lock SDK — persistence + idle-timer behavior.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_LOCK_INTERVALS,
  DEFAULT_AUTO_LOCK_MINUTES,
  _resetAutoLockForTest,
  getAutoLockMinutes,
  installIdleTimer,
  setAutoLockMinutes,
} from "../auto-lock";

beforeEach(() => {
  _resetAutoLockForTest();
});

describe("auto-lock · persistence", () => {
  it("returns the default when nothing persisted", () => {
    expect(getAutoLockMinutes()).toBe(DEFAULT_AUTO_LOCK_MINUTES);
  });

  it("round-trips a valid interval", () => {
    setAutoLockMinutes(30);
    expect(getAutoLockMinutes()).toBe(30);
  });

  it("clamps unknown intervals to the default", () => {
    setAutoLockMinutes(99);
    expect(getAutoLockMinutes()).toBe(DEFAULT_AUTO_LOCK_MINUTES);
  });

  it("accepts 0 (Never) as a valid stored value", () => {
    setAutoLockMinutes(0);
    expect(getAutoLockMinutes()).toBe(0);
  });

  it("recovers from malformed storage", () => {
    localStorage.setItem("mono.autolock.v1", "{not-json");
    expect(getAutoLockMinutes()).toBe(DEFAULT_AUTO_LOCK_MINUTES);
  });

  it("exposes every allowed interval option", () => {
    expect(AUTO_LOCK_INTERVALS).toContain(0);
    expect(AUTO_LOCK_INTERVALS).toContain(15);
    expect(AUTO_LOCK_INTERVALS).toContain(60);
  });
});

describe("auto-lock · idle timer", () => {
  it("fires onIdle after `minutes` of inactivity", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const handle = installIdleTimer(1, onIdle);
    // Advance just under threshold — no fire yet.
    vi.advanceTimersByTime(59_000);
    expect(onIdle).not.toHaveBeenCalled();
    // Cross the threshold.
    vi.advanceTimersByTime(2_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    handle.dispose();
    vi.useRealTimers();
  });

  it("resets when a user-interaction event fires", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const handle = installIdleTimer(1, onIdle);
    vi.advanceTimersByTime(50_000);
    // Activity — should reset the 60s window.
    window.dispatchEvent(new KeyboardEvent("keydown"));
    vi.advanceTimersByTime(50_000);
    expect(onIdle).not.toHaveBeenCalled();
    // Pushing past the new window.
    vi.advanceTimersByTime(15_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    handle.dispose();
    vi.useRealTimers();
  });

  it("dispose stops the timer and removes listeners", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const handle = installIdleTimer(1, onIdle);
    handle.dispose();
    vi.advanceTimersByTime(120_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("manual reset() extends the window", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const handle = installIdleTimer(1, onIdle);
    vi.advanceTimersByTime(50_000);
    handle.reset();
    vi.advanceTimersByTime(55_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    handle.dispose();
    vi.useRealTimers();
  });

  it("minutes=0 (Never) installs a no-op timer", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const handle = installIdleTimer(0, onIdle);
    vi.advanceTimersByTime(10 * 60 * 60 * 1000); // 10 hours
    expect(onIdle).not.toHaveBeenCalled();
    handle.dispose();
    vi.useRealTimers();
  });
});
