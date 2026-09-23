// Guard: the locked flag survives the process, and resolves fail-closed.
//
// The property under test is NOT "a boolean round-trips through localStorage".
// It is: a wallet that was locked cannot be reopened by killing and relaunching
// it (SA-09-004), and a storage layer that misbehaves yields LOCKED rather than
// open (the fail direction). Those are asserted through the real
// LockProvider/LockBoundary, not against the storage helper alone, because the
// helper being correct while the provider ignores it would be exactly the bug.
//
// `isWalletLocked()` is asserted separately at MODULE INIT, because its two
// consumers (IncomingPoller, os-toast) can read it before React has rendered
// anything — the window SA-10-001 lived in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../auto-lock-setting", () => ({ readAutoLockMinutes: () => 1 }));
vi.mock("../unlock-lockout", () => ({ clearUnlockLockout: vi.fn() }));

import { LockBoundary, LockProvider, useAutoLock } from "../auto-lock";
import { LOCK_STATE_KEY, readPersistedLocked } from "../lock-state";

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useAutoLock> | null;

function Probe() {
  api = useAutoLock();
  return null;
}

/** Mount the provider with the real gate in place: `locked` renders instead of
 *  the shell whenever the wallet is locked, exactly as App.tsx wires it. */
function mount() {
  act(() => {
    root.render(
      createElement(
        LockProvider,
        null,
        createElement(Probe),
        createElement(LockBoundary, { locked: "LOCKED-GATE", children: "WALLET-SHELL" }),
      ),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
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
  localStorage.clear();
});

describe("the locked flag survives a relaunch", () => {
  it("mounts LOCKED when the marker is already set, and shows the gate not the shell", () => {
    localStorage.setItem(LOCK_STATE_KEY, "1");
    mount();
    expect(
      api!.isLocked,
      "a wallet with a persisted locked marker mounted UNLOCKED — killing and " +
        "relaunching the process would reopen the shell without the passphrase (SA-09-004)",
    ).toBe(true);
    expect(container.textContent).toContain("LOCKED-GATE");
    expect(container.textContent).not.toContain("WALLET-SHELL");
  });

  it("mounts unlocked on a clean profile, and shows the shell", () => {
    // Anti-vacuity: without this, an implementation hardcoded to `true` would
    // pass every other test in this file.
    mount();
    expect(
      api!.isLocked,
      "a clean profile mounted LOCKED — a first run would open on a password " +
        "prompt for a wallet that does not exist yet",
    ).toBe(false);
    expect(container.textContent).toContain("WALLET-SHELL");
  });

  it("survives a simulated relaunch: lock, tear down, mount again", () => {
    mount();
    expect(api!.isLocked).toBe(false);
    act(() => api!.lock());
    expect(api!.isLocked).toBe(true);

    // The relaunch. Unmounting and building a fresh root discards every piece
    // of React state; only what reached storage can carry the flag across.
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api = null;

    mount();
    expect(
      api!.isLocked,
      "the wallet came back UNLOCKED after a relaunch, so the lock was in-session only",
    ).toBe(true);
  });

  it("persists a lock that the IDLE TIMER fired, not just a manual lock()", () => {
    // The timer calls setIsLocked directly rather than going through lock(), so
    // an implementation that persisted at the lock() call site would leave the
    // automatic lock — the common case — unpersisted.
    mount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(api!.isLocked).toBe(true);
    expect(
      readPersistedLocked(),
      "an idle-timer lock was not persisted — only the manual lock path writes the marker",
    ).toBe(true);
  });

  it("clears the marker on unlock, so the next launch is not locked forever", () => {
    localStorage.setItem(LOCK_STATE_KEY, "1");
    mount();
    expect(api!.isLocked).toBe(true);
    act(() => api!.unlock());
    expect(api!.isLocked).toBe(false);
    expect(
      readPersistedLocked(),
      "unlocking left the marker in storage, so the wallet would relock on every launch",
    ).toBe(false);
  });
});

describe("the fail direction: an unreadable marker means locked", () => {
  it("treats a throwing storage read as LOCKED", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(
      readPersistedLocked(),
      "a storage read that THREW resolved to unlocked — the failure that exposes " +
        "data must be the one refused",
    ).toBe(true);
    spy.mockRestore();
  });

  it("treats a malformed marker value as LOCKED", () => {
    localStorage.setItem(LOCK_STATE_KEY, "banana");
    expect(
      readPersistedLocked(),
      "a present but unrecognised marker resolved to unlocked — a marker we cannot " +
        "interpret may be a locked marker",
    ).toBe(true);
  });

  it("mounts LOCKED when storage throws at mount", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    mount();
    expect(api!.isLocked, "storage threw at mount and the shell opened anyway").toBe(true);
    expect(container.textContent).toContain("LOCKED-GATE");
    spy.mockRestore();
  });
});

describe("isWalletLocked() agrees with the marker before React renders", () => {
  it("is seeded from storage at module init, not left false until the first sync", async () => {
    // The consumers (IncomingPoller, os-toast) read this synchronously and can
    // run before the provider's effect fires. Re-importing with the marker
    // already set is the only way to observe module-init behaviour.
    localStorage.setItem(LOCK_STATE_KEY, "1");
    vi.resetModules();
    const freshModule = await import("../auto-lock");
    expect(
      freshModule.isWalletLocked(),
      "isWalletLocked() returned false at module init despite a persisted locked " +
        "marker — a toast could reach the OS before the first render (SA-10-001)",
    ).toBe(true);
  });

  it("is seeded false on a clean profile", async () => {
    // Anti-vacuity companion: proves the seeding reads storage rather than
    // returning a constant.
    localStorage.clear();
    vi.resetModules();
    const freshModule = await import("../auto-lock");
    expect(freshModule.isWalletLocked()).toBe(false);
  });
});
