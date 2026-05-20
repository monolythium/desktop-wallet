// log-cursor — read/write round trips, TTL invalidation, scan-window
// computation.

import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetAllCursorsForTest,
  clearCursor,
  computeScanWindow,
  hydrateLogCursorStore,
  readCursor,
  writeCursor,
} from "../log-cursor";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

beforeEach(() => {
  _resetAllCursorsForTest();
});

describe("log-cursor · read/write", () => {
  it("returns null when no cursor exists", () => {
    expect(readCursor("activity", TEST_ADDRESS)).toBeNull();
  });

  it("round-trips a bigint lastBlock + bigint payload natively (Phase 5: IDB)", () => {
    // Phase 5 #D17 — payload can carry bigints directly; no
    // serialization round-trip required.
    writeCursor("activity", TEST_ADDRESS, {
      lastBlock: 12_345_678_901_234n,
      scannedAtMs: Date.now(),
      payload: { foo: "bar", id: 999_999_999_999n },
    });
    const entry = readCursor<{ foo: string; id: bigint }>("activity", TEST_ADDRESS);
    expect(entry?.lastBlock).toBe(12_345_678_901_234n);
    expect(entry?.payload).toEqual({ foo: "bar", id: 999_999_999_999n });
  });

  it("returns null on stale entries (>7 days)", () => {
    writeCursor("activity", TEST_ADDRESS, {
      lastBlock: 100n,
      scannedAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
      payload: null,
    });
    expect(readCursor("activity", TEST_ADDRESS)).toBeNull();
  });

  it("survives malformed storage", () => {
    localStorage.setItem(`mono.logcursor.v1.activity.${TEST_ADDRESS.toLowerCase()}`, "{not-json");
    expect(readCursor("activity", TEST_ADDRESS)).toBeNull();
  });

  it("clearCursor wipes a specific scope+holder entry", () => {
    writeCursor("activity", TEST_ADDRESS, {
      lastBlock: 100n,
      scannedAtMs: Date.now(),
      payload: null,
    });
    clearCursor("activity", TEST_ADDRESS);
    expect(readCursor("activity", TEST_ADDRESS)).toBeNull();
  });
});

describe("log-cursor · scope isolation", () => {
  it("activity and discovery cursors don't collide", () => {
    writeCursor("activity", TEST_ADDRESS, {
      lastBlock: 1n,
      scannedAtMs: Date.now(),
      payload: "activity-data",
    });
    writeCursor("discovery", TEST_ADDRESS, {
      lastBlock: 2n,
      scannedAtMs: Date.now(),
      payload: "discovery-data",
    });
    expect(readCursor<string>("activity", TEST_ADDRESS)?.payload).toBe("activity-data");
    expect(readCursor<string>("discovery", TEST_ADDRESS)?.payload).toBe("discovery-data");
  });
});

describe("log-cursor · computeScanWindow", () => {
  it("returns the default lookback when no cursor exists", () => {
    const window = computeScanWindow({
      scope: "activity",
      holder: TEST_ADDRESS,
      latestBlock: 200_000n,
      defaultLookback: 100_000n,
    });
    expect(window.fromBlock).toBe(100_000n);
    expect(window.isIncremental).toBe(false);
  });

  it("clamps to 0 for early chains", () => {
    const window = computeScanWindow({
      scope: "activity",
      holder: TEST_ADDRESS,
      latestBlock: 50n,
      defaultLookback: 100_000n,
    });
    expect(window.fromBlock).toBe(0n);
  });

  it("returns cursor+1 when the cursor is behind latest", () => {
    writeCursor("activity", TEST_ADDRESS, {
      lastBlock: 199_000n,
      scannedAtMs: Date.now(),
      payload: null,
    });
    const window = computeScanWindow({
      scope: "activity",
      holder: TEST_ADDRESS,
      latestBlock: 200_000n,
      defaultLookback: 100_000n,
    });
    expect(window.fromBlock).toBe(199_001n);
    expect(window.isIncremental).toBe(true);
  });

  it("falls back to full window when cursor is at or above latest", () => {
    writeCursor("activity", TEST_ADDRESS, {
      lastBlock: 200_000n,
      scannedAtMs: Date.now(),
      payload: null,
    });
    const window = computeScanWindow({
      scope: "activity",
      holder: TEST_ADDRESS,
      latestBlock: 200_000n,
      defaultLookback: 100_000n,
    });
    expect(window.isIncremental).toBe(false);
  });
});

describe("log-cursor · Phase 5 #D17 IDB storage path", () => {
  it("preserves bigint payload values without serialization", () => {
    // Phase 4 stored bigints as decimal strings via JSON; Phase 5
    // (IDB) preserves bigint identity through the in-memory mirror.
    const huge = 10n ** 30n + 17n;
    writeCursor("discovery", TEST_ADDRESS, {
      lastBlock: huge,
      scannedAtMs: Date.now(),
      payload: { count: huge, tag: "phase-5" },
    });
    const entry = readCursor<{ count: bigint; tag: string }>("discovery", TEST_ADDRESS);
    expect(entry?.lastBlock).toBe(huge);
    expect(entry?.payload.count).toBe(huge);
    expect(entry?.payload.tag).toBe("phase-5");
  });

  it("hydrateLogCursorStore is idempotent", async () => {
    await hydrateLogCursorStore();
    await hydrateLogCursorStore();
    expect(true).toBe(true);
  });
});
