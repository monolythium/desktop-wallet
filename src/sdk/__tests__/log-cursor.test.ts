// log-cursor — read/write round trips, TTL invalidation, scan-window
// computation.

import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetAlldesktop MCP clientsForTest,
  cleardesktop MCP client,
  computeScanWindow,
  readdesktop MCP client,
  writedesktop MCP client,
} from "../log-cursor";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

beforeEach(() => {
  _resetAlldesktop MCP clientsForTest();
});

describe("log-cursor · read/write", () => {
  it("returns null when no cursor exists", () => {
    expect(readdesktop MCP client("activity", TEST_ADDRESS)).toBeNull();
  });

  it("round-trips a bigint lastBlock through localStorage", () => {
    writedesktop MCP client("activity", TEST_ADDRESS, {
      lastBlock: 12_345_678_901_234n,
      scannedAtMs: Date.now(),
      payload: { foo: "bar" },
    });
    const entry = readdesktop MCP client<{ foo: string }>("activity", TEST_ADDRESS);
    expect(entry?.lastBlock).toBe(12_345_678_901_234n);
    expect(entry?.payload).toEqual({ foo: "bar" });
  });

  it("returns null on stale entries (>7 days)", () => {
    writedesktop MCP client("activity", TEST_ADDRESS, {
      lastBlock: 100n,
      scannedAtMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
      payload: null,
    });
    expect(readdesktop MCP client("activity", TEST_ADDRESS)).toBeNull();
  });

  it("survives malformed storage", () => {
    localStorage.setItem(`mono.logcursor.v1.activity.${TEST_ADDRESS.toLowerCase()}`, "{not-json");
    expect(readdesktop MCP client("activity", TEST_ADDRESS)).toBeNull();
  });

  it("cleardesktop MCP client wipes a specific scope+holder entry", () => {
    writedesktop MCP client("activity", TEST_ADDRESS, {
      lastBlock: 100n,
      scannedAtMs: Date.now(),
      payload: null,
    });
    cleardesktop MCP client("activity", TEST_ADDRESS);
    expect(readdesktop MCP client("activity", TEST_ADDRESS)).toBeNull();
  });
});

describe("log-cursor · scope isolation", () => {
  it("activity and discovery cursors don't collide", () => {
    writedesktop MCP client("activity", TEST_ADDRESS, {
      lastBlock: 1n,
      scannedAtMs: Date.now(),
      payload: "activity-data",
    });
    writedesktop MCP client("discovery", TEST_ADDRESS, {
      lastBlock: 2n,
      scannedAtMs: Date.now(),
      payload: "discovery-data",
    });
    expect(readdesktop MCP client<string>("activity", TEST_ADDRESS)?.payload).toBe("activity-data");
    expect(readdesktop MCP client<string>("discovery", TEST_ADDRESS)?.payload).toBe("discovery-data");
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
    writedesktop MCP client("activity", TEST_ADDRESS, {
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
    writedesktop MCP client("activity", TEST_ADDRESS, {
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
