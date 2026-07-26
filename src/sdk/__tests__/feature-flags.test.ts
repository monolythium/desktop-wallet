import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_MODE_FIRST_SEEN_KEY,
  DEVELOPER_MODE_KEY,
  EXPERIMENTAL_ENABLED_KEY,
  readDeveloperMode,
  readDeveloperModeFirstSeenAt,
  readExperimentalEnabled,
  stampDeveloperModeFirstSeenAt,
  writeDeveloperMode,
  writeExperimentalEnabled,
} from "../feature-flags";

/** Run `fn` with localStorage.getItem/setItem forced to throw, then restore. */
function withStorageThrowing(fn: () => void): void {
  const getItem = Storage.prototype.getItem;
  const setItem = Storage.prototype.setItem;
  Storage.prototype.getItem = vi.fn(() => {
    throw new Error("storage blocked");
  });
  Storage.prototype.setItem = vi.fn(() => {
    throw new Error("storage blocked");
  });
  try {
    fn();
  } finally {
    Storage.prototype.getItem = getItem;
    Storage.prototype.setItem = setItem;
  }
}

describe("experimental v5 surfaces feature flag", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults OFF when the key has never been written", () => {
    localStorage.clear();
    expect(localStorage.getItem(EXPERIMENTAL_ENABLED_KEY)).toBeNull();
    expect(readExperimentalEnabled()).toBe(false);
  });

  it("reads back true only for the exact string \"true\"", () => {
    writeExperimentalEnabled(true);
    expect(localStorage.getItem(EXPERIMENTAL_ENABLED_KEY)).toBe("true");
    expect(readExperimentalEnabled()).toBe(true);
  });

  it("treats any non-\"true\" stored value as OFF", () => {
    localStorage.setItem(EXPERIMENTAL_ENABLED_KEY, "1");
    expect(readExperimentalEnabled()).toBe(false);
    localStorage.setItem(EXPERIMENTAL_ENABLED_KEY, "yes");
    expect(readExperimentalEnabled()).toBe(false);
  });

  it("round-trips a disable back to OFF", () => {
    writeExperimentalEnabled(true);
    expect(readExperimentalEnabled()).toBe(true);
    writeExperimentalEnabled(false);
    expect(localStorage.getItem(EXPERIMENTAL_ENABLED_KEY)).toBe("false");
    expect(readExperimentalEnabled()).toBe(false);
  });
});

describe("developer-mode flag", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("normalises the stored value (default OFF; only exact \"true\" is ON)", () => {
    // absent → OFF
    expect(localStorage.getItem(DEVELOPER_MODE_KEY)).toBeNull();
    expect(readDeveloperMode()).toBe(false);
    for (const [stored, expected] of [
      ["true", true],
      ["false", false],
      ["", false],
      ["1", false],
      ["yes", false],
      ["TRUE", false],
      ["garbage", false],
    ] as const) {
      localStorage.setItem(DEVELOPER_MODE_KEY, stored);
      expect(readDeveloperMode()).toBe(expected);
    }
  });

  it("reads OFF when storage access throws (fail-closed)", () => {
    withStorageThrowing(() => {
      expect(readDeveloperMode()).toBe(false);
    });
  });

  it("writeDeveloperMode returns true on success and persists the value", () => {
    expect(writeDeveloperMode(true)).toBe(true);
    expect(localStorage.getItem(DEVELOPER_MODE_KEY)).toBe("true");
    expect(writeDeveloperMode(false)).toBe(true);
    expect(localStorage.getItem(DEVELOPER_MODE_KEY)).toBe("false");
  });

  it("writeDeveloperMode returns false when storage throws (never throws)", () => {
    withStorageThrowing(() => {
      expect(writeDeveloperMode(true)).toBe(false);
    });
  });
});

describe("developer-mode firstSeenAt", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("parses tolerantly — absent/garbage/non-positive read as null", () => {
    expect(readDeveloperModeFirstSeenAt()).toBeNull();
    for (const raw of ["", "NaN", "Infinity", "-5", "0", "abc"]) {
      localStorage.setItem(DEVELOPER_MODE_FIRST_SEEN_KEY, raw);
      expect(readDeveloperModeFirstSeenAt()).toBeNull();
    }
    localStorage.setItem(DEVELOPER_MODE_FIRST_SEEN_KEY, "1789000000000");
    expect(readDeveloperModeFirstSeenAt()).toBe(1789000000000);
  });

  it("stamps only when none is recorded — an off→on→off→on cycle keeps the original", () => {
    stampDeveloperModeFirstSeenAt(1000);
    expect(readDeveloperModeFirstSeenAt()).toBe(1000);
    // A later stamp must NOT overwrite the original.
    stampDeveloperModeFirstSeenAt(2000);
    expect(readDeveloperModeFirstSeenAt()).toBe(1000);
  });

  it("re-stamps over a garbage stored value on the next enable", () => {
    localStorage.setItem(DEVELOPER_MODE_FIRST_SEEN_KEY, "NaN");
    stampDeveloperModeFirstSeenAt(3000);
    expect(readDeveloperModeFirstSeenAt()).toBe(3000);
  });

  it("stamp is best-effort — a storage failure never throws", () => {
    withStorageThrowing(() => {
      expect(() => stampDeveloperModeFirstSeenAt(1000)).not.toThrow();
    });
  });
});
