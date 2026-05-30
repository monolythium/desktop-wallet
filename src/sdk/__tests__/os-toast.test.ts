import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spies for the three plugin entry points os-toast.ts uses. Permission state is
// scriptable per test so we can exercise granted / needs-prompt / denied.
const sendNotification = vi.fn();
const isPermissionGranted = vi.fn(async () => true);
const requestPermission = vi.fn(async () => "granted" as string);

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification: (opts: unknown) => sendNotification(opts),
}));

// Scriptable feature-flag read.
let experimental = true;
vi.mock("../feature-flags", () => ({
  readExperimentalEnabled: () => experimental,
}));

import { toastTerminalNotification } from "../os-toast";
import type { NotificationRecord } from "../notifications";

const TAURI_KEY = "__TAURI_INTERNALS__";

function rec(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 100,
    kind: "send",
    amountDecimal: "12.50",
    counterparty: "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    createdAtMs: 1_700_000_000_000,
    read: false,
    schemaVersion: 0,
    ...over,
  };
}

function setTauri(present: boolean): void {
  if (present) {
    (window as unknown as Record<string, unknown>)[TAURI_KEY] = {};
  } else {
    delete (window as unknown as Record<string, unknown>)[TAURI_KEY];
  }
}

beforeEach(() => {
  sendNotification.mockClear();
  isPermissionGranted.mockClear();
  isPermissionGranted.mockResolvedValue(true);
  requestPermission.mockClear();
  requestPermission.mockResolvedValue("granted");
  experimental = true;
  setTauri(true);
});

afterEach(() => {
  setTauri(false);
});

describe("toastTerminalNotification", () => {
  it("sends an OS toast with the in-app title/body when granted + flag on", async () => {
    await toastTerminalNotification(rec());
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith({
      title: "Sent",
      body: "12.50 LYTH · mono1qqqqq…qqqqqq",
    });
  });

  it("requests permission once when not yet granted, then sends", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    await toastTerminalNotification(rec());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("does NOT send when the permission prompt is denied", async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("denied");
    await toastTerminalNotification(rec());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("is a no-op (NO toast, NO permission prompt) when the flag is off", async () => {
    experimental = false;
    await toastTerminalNotification(rec());
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("is a no-op outside Tauri (browser preview)", async () => {
    setTauri(false);
    await toastTerminalNotification(rec());
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("swallows errors — never throws back into the caller", async () => {
    isPermissionGranted.mockRejectedValue(new Error("boom"));
    await expect(toastTerminalNotification(rec())).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
