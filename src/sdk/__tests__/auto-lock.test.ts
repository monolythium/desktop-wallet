// Behavioral tests for the LockProvider idle-lock timer.
//
// The configured idle timeout is the SOLE auto-lock trigger. These tests assert
// the idle lock fires after the configured timeout, the deadline still governs
// while the window is unfocused, genuine activity resets the timer, a paused
// timer never fires, and the manual lock works.
//
// Scope note: the removed grace-lock fired via Tauri's onFocusChanged IPC, which
// jsdom cannot drive — so no unit test here can directly re-trigger that exact
// path; its removal is guaranteed structurally (the effect is deleted and no
// onFocusChanged/BLUR_GRACE_MS reference remains). What these tests DO guard is
// that nothing locks early — including no DOM blur→lock wiring — and that the
// idle deadline alone governs the unfocused case.
//
// The provider is rendered with react-dom (no testing-library here) and driven
// with fake timers. JSX is avoided so the file stays a *.test.ts (the vitest
// include glob does not pick up *.test.tsx).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// React's act() needs this flag outside testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Deterministic 1-minute timeout, and a no-op lockout clear (it touches storage).
vi.mock("../auto-lock-setting", () => ({ readAutoLockMinutes: () => 1 }));
vi.mock("../unlock-lockout", () => ({ clearUnlockLockout: vi.fn() }));

import { LockProvider, useAutoLock } from "../auto-lock";
import {
  __sentRecipientKeyRefForTest,
  clearSentRecipientIntegrityKeys,
  computeSentRecipientTag,
  hasSentRecipientKey,
} from "../sent-recipients";

const MINUTE = 60_000;

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useAutoLock> | null;

function Probe() {
  api = useAutoLock();
  return null;
}

function mount() {
  act(() => {
    root.render(createElement(LockProvider, null, createElement(Probe)));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LockProvider idle auto-lock", () => {
  it("locks after the configured idle timeout elapses", () => {
    mount();
    expect(api!.isLocked).toBe(false);
    advance(MINUTE);
    expect(api!.isLocked).toBe(true);
  });

  it("does not lock early on a window blur; the idle deadline governs while unfocused", () => {
    mount();
    advance(30_000);
    // A DOM blur must NOT trigger an early lock — guards against any future
    // blur→lock wiring. (The removed grace-lock used Tauri onFocusChanged, not
    // a DOM blur, so this cannot replay that exact path; the assertion below is
    // the real regression guard — locking is driven only by the idle deadline.)
    act(() => window.dispatchEvent(new Event("blur")));
    advance(29_000); // 59s total — still within the 60s deadline
    expect(api!.isLocked).toBe(false);
    // The idle deadline still governs while unfocused: it fires at 60s.
    advance(2_000);
    expect(api!.isLocked).toBe(true);
  });

  it("resets the idle timer on genuine user activity", () => {
    mount();
    advance(59_000);
    expect(api!.isLocked).toBe(false);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
    // The deadline is now 60s from the keydown, not from mount.
    advance(59_000);
    expect(api!.isLocked).toBe(false);
    advance(2_000);
    expect(api!.isLocked).toBe(true);
  });

  it("locks immediately on an explicit manual lock()", () => {
    mount();
    expect(api!.isLocked).toBe(false);
    act(() => api!.lock());
    expect(api!.isLocked).toBe(true);
  });

  it("stays unlocked while a sensitive flow has the timer paused", () => {
    mount();
    act(() => api!.pauseTimer());
    advance(MINUTE * 2); // the idle timer is suspended — no lock
    expect(api!.isLocked).toBe(false);
    act(() => api!.resumeTimer());
    advance(MINUTE);
    expect(api!.isLocked).toBe(true);
  });

  it("zeroizes the cached sent-recipients integrity key when the wallet locks (C2)", async () => {
    clearSentRecipientIntegrityKeys();
    mount();
    const vault = "0x" + "aa".repeat(20);
    await computeSentRecipientTag(new Uint8Array(32).fill(7), vault, "msg");
    const ref = __sentRecipientKeyRefForTest(vault)!;
    expect(ref.some((b) => b !== 0)).toBe(true); // key cached and non-zero
    act(() => api!.lock());
    expect(hasSentRecipientKey(vault)).toBe(false); // dropped on lock
    expect(ref.every((b) => b === 0)).toBe(true); // and zeroized in place
  });
});
