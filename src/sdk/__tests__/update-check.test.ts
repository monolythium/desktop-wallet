// §D — the update-check cache, the honest fold, and the boot ordering.
//
// G6 is the reason the last describe block exists: the fold and the reconcile
// are each individually correct, and the pattern still fails if they run in the
// wrong order. Testing the two functions proves nothing about that.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdate = vi.hoisted(() =>
  vi.fn<() => Promise<import("../updater").UpdateCheckResult>>(async () => ({
    kind: "none" as const,
  })),
);
const isTauriRuntime = vi.hoisted(() => vi.fn(() => true));

vi.mock("../updater", async (orig) => ({
  ...(await orig<typeof import("../updater")>()),
  checkForUpdate,
}));
vi.mock("../about", async (orig) => ({
  ...(await orig<typeof import("../about")>()),
  isTauriRuntime,
}));

import {
  STORAGE_KEY_UPDATE_CHECK,
  WALLET_UPDATE_CHECK_INTERVAL_MS,
  cacheStatusOf,
  nextUpdateAvailable,
  parseUpdateCheckRecord,
  readUpdateCheckRecord,
  reconcileUpdateCacheOnBoot,
  shouldCheckWalletUpdate,
  syncWalletUpdateState,
  writeUpdateCheckRecord,
  type UpdateCheckRecord,
} from "../update-check";

const NOW = 1_800_000_000_000;
const TWELVE_H = WALLET_UPDATE_CHECK_INTERVAL_MS;

function record(over: Partial<UpdateCheckRecord> = {}): UpdateCheckRecord {
  return {
    lastCheckAt: NOW,
    updateAvailable: false,
    lastStatus: "no_update",
    appVersion: "0.0.17",
    offeredVersion: null,
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  checkForUpdate.mockClear();
  checkForUpdate.mockResolvedValue({ kind: "none" });
  isTauriRuntime.mockReturnValue(true);
});

afterEach(() => {
  localStorage.clear();
});

describe("the 12-hour gate", () => {
  it("never checked → open", () => {
    expect(shouldCheckWalletUpdate(null, NOW)).toBe(true);
  });

  it("exactly 12h → open (inclusive)", () => {
    expect(shouldCheckWalletUpdate(NOW - TWELVE_H, NOW)).toBe(true);
  });

  it("one millisecond short → closed", () => {
    expect(shouldCheckWalletUpdate(NOW - TWELVE_H + 1, NOW)).toBe(false);
  });

  it("a FUTURE timestamp counts as stale, not as an eternal lock", () => {
    // A clock change must not park the gate closed forever with no symptom.
    expect(shouldCheckWalletUpdate(NOW + 60_000, NOW)).toBe(true);
  });
});

describe("the honest fold", () => {
  it("a real answer sets the verdict", () => {
    expect(nextUpdateAvailable("update_available", false)).toBe(true);
    expect(nextUpdateAvailable("no_update", true)).toBe(false);
  });

  it("a NON-ANSWER keeps the prior verdict — both directions", () => {
    // The whole point. A blip must not raise a false alarm…
    expect(nextUpdateAvailable("unavailable", false)).toBe(false);
    // …nor silently clear a real one.
    expect(nextUpdateAvailable("unavailable", true)).toBe(true);
  });

  it("maps the updater seam's union onto the persisted vocabulary", () => {
    expect(cacheStatusOf({ kind: "available", version: "1", notes: null, pubDate: null }))
      .toBe("update_available");
    expect(cacheStatusOf({ kind: "none" })).toBe("no_update");
    expect(cacheStatusOf({ kind: "error" })).toBe("unavailable");
  });
});

describe("tolerant parse", () => {
  it("round-trips a valid record", () => {
    const r = record({ updateAvailable: true, offeredVersion: "0.0.18" });
    expect(parseUpdateCheckRecord(JSON.stringify(r))).toEqual(r);
  });

  it.each([
    ["not json", "{{{"],
    ["not an object", '"hello"'],
    ["null", "null"],
    ["non-number lastCheckAt", '{"lastCheckAt":"x","updateAvailable":false,"appVersion":"1"}'],
    ["non-boolean updateAvailable", '{"lastCheckAt":1,"updateAvailable":"yes","appVersion":"1"}'],
    ["non-string appVersion", '{"lastCheckAt":1,"updateAvailable":false,"appVersion":7}'],
    ["absent", null],
  ])("%s → null (treated as never checked, never repaired)", (_label, raw) => {
    expect(parseUpdateCheckRecord(raw)).toBeNull();
  });

  it("an unknown lastStatus is dropped, the rest kept", () => {
    const parsed = parseUpdateCheckRecord(
      JSON.stringify({ ...record(), lastStatus: "throttled" }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.lastStatus).toBeUndefined();
    expect(parsed!.appVersion).toBe("0.0.17");
    expect(parsed!.updateAvailable).toBe(false);
  });
});

describe("reconcile on boot", () => {
  it("removes the record when the binary changed", () => {
    writeUpdateCheckRecord(record({ appVersion: "0.0.16", updateAvailable: true }));
    const out = reconcileUpdateCacheOnBoot(readUpdateCheckRecord(), "0.0.17");
    expect(out).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY_UPDATE_CHECK)).toBeNull();
  });

  it("keeps it when the version matches", () => {
    const r = record({ appVersion: "0.0.17", updateAvailable: true });
    writeUpdateCheckRecord(r);
    expect(reconcileUpdateCacheOnBoot(readUpdateCheckRecord(), "0.0.17")).toEqual(r);
    expect(localStorage.getItem(STORAGE_KEY_UPDATE_CHECK)).not.toBeNull();
  });

  it("no-ops on an absent record", () => {
    expect(reconcileUpdateCacheOnBoot(null, "0.0.17")).toBeNull();
  });
});

describe("syncWalletUpdateState — the gate is real", () => {
  it("a fresh cache fires NO network call", async () => {
    writeUpdateCheckRecord(record({ lastCheckAt: NOW - 1000, lastStatus: "no_update" }));
    const state = await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17" });
    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(state.lastStatus).toBe("no_update");
  });

  it("a stale cache checks exactly once", async () => {
    writeUpdateCheckRecord(record({ lastCheckAt: NOW - TWELVE_H - 1 }));
    await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17" });
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("`force` bypasses the gate — a user action may always hit the network", async () => {
    writeUpdateCheckRecord(record({ lastCheckAt: NOW - 1000 }));
    await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17", force: true });
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("the browser preview never calls the updater and never writes", async () => {
    isTauriRuntime.mockReturnValue(false);
    const state = await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17" });
    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY_UPDATE_CHECK)).toBeNull();
    expect(state.preview).toBe(true);
    // …and it certainly never claims the wallet is current.
    expect(state.lastStatus).not.toBe("no_update");
  });

  it("persists an offered version alongside a true verdict", async () => {
    checkForUpdate.mockResolvedValue({
      kind: "available",
      version: "0.0.18",
      notes: null,
      pubDate: null,
    });
    const state = await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17" });
    expect(state.updateAvailable).toBe(true);
    expect(state.offeredVersion).toBe("0.0.18");
    expect(readUpdateCheckRecord()!.offeredVersion).toBe("0.0.18");
  });

  it("a non-answer over a standing verdict keeps BOTH verdict and version", async () => {
    writeUpdateCheckRecord(
      record({
        lastCheckAt: NOW - TWELVE_H - 1,
        updateAvailable: true,
        lastStatus: "update_available",
        offeredVersion: "0.0.18",
      }),
    );
    checkForUpdate.mockResolvedValue({ kind: "error" });
    const state = await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17" });
    expect(state.updateAvailable).toBe(true);
    expect(state.offeredVersion).toBe("0.0.18");
    expect(state.lastStatus).toBe("unavailable");
  });

  it("a real `no_update` DOES clear a standing verdict (a withdrawn release)", async () => {
    writeUpdateCheckRecord(
      record({
        lastCheckAt: NOW - TWELVE_H - 1,
        updateAvailable: true,
        offeredVersion: "0.0.18",
      }),
    );
    checkForUpdate.mockResolvedValue({ kind: "none" });
    const state = await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.17" });
    expect(state.updateAvailable).toBe(false);
    expect(state.offeredVersion).toBeNull();
  });
});

describe("G6 — the reconcile runs BEFORE the cache is read", () => {
  it("a post-update boot does not inherit the old binary's verdict", async () => {
    // The exact shape of the bug: the user installed 0.0.18, so the cache
    // written by 0.0.17 says "update available". The network then fails to
    // answer. If the reconcile ran first, the prior is false and the fold
    // leaves it false — no banner. If the read happened first, keep-prior
    // preserves `true` and the wallet nags forever about an update it has
    // already installed.
    writeUpdateCheckRecord(
      record({
        appVersion: "0.0.17",
        lastCheckAt: NOW - 1000, // fresh, so the gate alone would not save us
        updateAvailable: true,
        lastStatus: "update_available",
        offeredVersion: "0.0.18",
      }),
    );
    checkForUpdate.mockResolvedValue({ kind: "error" });

    const state = await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.18" });

    expect(state.updateAvailable).toBe(false);
    expect(state.offeredVersion).toBeNull();
  });

  it("the stale record is gone from storage, not merely ignored", async () => {
    writeUpdateCheckRecord(
      record({ appVersion: "0.0.17", updateAvailable: true, lastCheckAt: NOW - 1000 }),
    );
    checkForUpdate.mockResolvedValue({ kind: "error" });
    await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.18" });

    const stored = readUpdateCheckRecord();
    // Either cleared outright, or replaced by a record stamped with the NEW
    // version — never the old one still sitting there available:true.
    if (stored !== null) {
      expect(stored.appVersion).toBe("0.0.18");
      expect(stored.updateAvailable).toBe(false);
    }
  });

  it("the reconcile also re-opens the gate (a fresh stale cache still checks)", async () => {
    // Corollary of ordering: discarding the record drops `lastCheckAt` with it,
    // so the new binary checks immediately instead of waiting out the old
    // binary's 12-hour window.
    writeUpdateCheckRecord(record({ appVersion: "0.0.17", lastCheckAt: NOW - 1000 }));
    await syncWalletUpdateState({ now: NOW, runningVersion: "0.0.18" });
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });
});
