import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of @tauri-apps/plugin-store (same shape as the other store
// tests) so recordOperationFailure's real recordNotification round-trips
// without touching Tauri IPC.
const backing = new Map<string, unknown>();

vi.mock("@tauri-apps/plugin-store", () => {
  class FakeStore {
    constructor(private readonly file: string) {}
    static async load(file: string): Promise<FakeStore> {
      return new FakeStore(file);
    }
    async get<T>(key: string): Promise<T | undefined> {
      const v = backing.get(`${this.file}:${key}`);
      return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.set(`${this.file}:${key}`, JSON.parse(JSON.stringify(value)));
    }
    async save(): Promise<void> {
      /* no-op */
    }
  }
  return { Store: FakeStore };
});

// Stub the OS-toast helper to assert the synchronous-reject path fires it once
// per new record and reuses the store dedupe.
const toastSpy = vi.fn((_record: unknown): Promise<void> => Promise.resolve());
vi.mock("../os-toast", () => ({
  toastTerminalNotification: (record: unknown) => toastSpy(record),
}));

import {
  __resetNotificationsStoreForTests,
  listAllNotifications,
} from "../notifications-store";
import { recordOperationFailure } from "../notifications-record";

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  backing.clear();
  seedActiveVault();
  __resetNotificationsStoreForTests();
  toastSpy.mockClear();
});

function seedActiveVault(): void {
  backing.set("vaults.v1.json:state", {
    version: 1,
    activeSlot: "kc:test",
    vaults: {
      "kc:test": {
        slot: "kc:test",
        name: "Test wallet",
        addressHex: "0x0000000000000000000000000000000000000001",
        createdAt: 1,
        kind: "local",
      },
    },
  });
}

describe("recordOperationFailure", () => {
  const meta = {
    kind: "send" as const,
    amountDecimal: "2.50",
    counterparty: "mono1to",
  };

  it("records a 'failed' notification AND fires one OS toast", async () => {
    await recordOperationFailure(meta, "0xrej");

    const notes = await listAllNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.status).toBe("failed");
    expect(notes[0]!.txHash).toBe("0xrej");

    expect(toastSpy).toHaveBeenCalledTimes(1);
    const arg = toastSpy.mock.calls[0]![0] as { txHash: string; status: string };
    expect(arg.txHash).toBe("0xrej");
    expect(arg.status).toBe("failed");
  });

  it("is a no-op (no record, no toast) without a hash", async () => {
    await recordOperationFailure(meta, undefined);
    expect(await listAllNotifications()).toHaveLength(0);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("does NOT re-toast a hash already recorded (dedupe)", async () => {
    await recordOperationFailure(meta, "0xdup");
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Same hash again — recordNotification dedupes (added: false) so no second
    // toast.
    await recordOperationFailure(meta, "0xdup");
    expect(await listAllNotifications()).toHaveLength(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });
});
