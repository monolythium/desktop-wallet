import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of @tauri-apps/plugin-store. One shared backing map per test
// run; the store-module's singleton `Store.load` resolves to a wrapper over
// it. JSON round-trip mirrors the real plugin (it serializes to disk), which
// keeps the test honest about what survives a reload.
const backing = new Map<string, unknown>();

vi.mock("@tauri-apps/plugin-store", () => {
  class FakeStore {
    static async load(_file: string): Promise<FakeStore> {
      return new FakeStore();
    }
    async get<T>(key: string): Promise<T | undefined> {
      const v = backing.get(key);
      return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.set(key, JSON.parse(JSON.stringify(value)));
    }
    async save(): Promise<void> {
      /* no-op */
    }
  }
  return { Store: FakeStore };
});

import {
  __resetNotificationsStoreForTests,
  getUnread,
  listAllNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recordNotification,
  subscribeNotifications,
  type RecordNotificationInput,
} from "../notifications-store";

const CHAIN = "0x10f2c";
const ADDR = "mono1self";

function input(over: Partial<RecordNotificationInput> = {}): RecordNotificationInput {
  return {
    addressLower: ADDR,
    chainIdHex: CHAIN,
    txHash: "0xaaa",
    status: "confirmed",
    blockNumber: 10,
    kind: "send",
    amountDecimal: "1.00",
    counterparty: "mono1to",
    ...over,
  };
}

beforeEach(() => {
  backing.clear();
  __resetNotificationsStoreForTests();
});

describe("recordNotification", () => {
  it("adds a record and reports it as new", async () => {
    const r = await recordNotification(input());
    expect(r.added).toBe(true);
    expect(r.record?.txHash).toBe("0xaaa");
    expect(r.record?.status).toBe("confirmed");
    const all = await listAllNotifications();
    expect(all).toHaveLength(1);
  });

  it("dedupes on (address, chain, txHash) — a second call is a no-op", async () => {
    await recordNotification(input());
    const second = await recordNotification(input({ status: "failed" }));
    expect(second.added).toBe(false);
    expect(second.record).toBeNull();
    const all = await listAllNotifications();
    expect(all).toHaveLength(1);
    // The first write wins; the dupe never flips confirmed → failed.
    expect(all[0]!.status).toBe("confirmed");
  });

  it("records 'failed' verbatim (status fidelity — never coerced)", async () => {
    await recordNotification(input({ txHash: "0xfail", status: "failed", blockNumber: null }));
    const all = await listAllNotifications();
    expect(all[0]!.status).toBe("failed");
    expect(all[0]!.blockNumber).toBeNull();
  });

  it("treats the same hash on different chains as distinct records", async () => {
    await recordNotification(input({ chainIdHex: "0x1" }));
    await recordNotification(input({ chainIdHex: "0x2" }));
    const all = await listAllNotifications();
    expect(all).toHaveLength(2);
  });

  it("stores already-read when read:true is passed (no badge bump)", async () => {
    await recordNotification(input({ read: true }));
    expect(await getUnread()).toBe(0);
  });
});

describe("listAllNotifications", () => {
  it("merges scopes newest-first by createdAtMs", async () => {
    await recordNotification(input({ txHash: "0x1" }));
    await new Promise((r) => setTimeout(r, 2));
    await recordNotification(input({ txHash: "0x2" }));
    const all = await listAllNotifications();
    expect(all.map((r) => r.txHash)).toEqual(["0x2", "0x1"]);
  });
});

describe("getUnread", () => {
  it("counts only unread records across scopes", async () => {
    await recordNotification(input({ txHash: "0x1" }));
    await recordNotification(input({ txHash: "0x2" }));
    await recordNotification(input({ txHash: "0x3", chainIdHex: "0x9" }));
    expect(await getUnread()).toBe(3);
  });
});

describe("markAllNotificationsRead", () => {
  it("flips every unread record and returns the count", async () => {
    await recordNotification(input({ txHash: "0x1" }));
    await recordNotification(input({ txHash: "0x2" }));
    const { flipped } = await markAllNotificationsRead();
    expect(flipped).toBe(2);
    expect(await getUnread()).toBe(0);
  });

  it("is idempotent — a second call flips nothing", async () => {
    await recordNotification(input());
    await markAllNotificationsRead();
    const { flipped } = await markAllNotificationsRead();
    expect(flipped).toBe(0);
  });
});

describe("markNotificationRead", () => {
  it("flips exactly one record by id; a second tap is a no-op", async () => {
    const a = await recordNotification(input({ txHash: "0x1" }));
    await recordNotification(input({ txHash: "0x2" }));
    const id = a.record!.id;
    expect((await markNotificationRead(id)).flipped).toBe(true);
    expect(await getUnread()).toBe(1);
    expect((await markNotificationRead(id)).flipped).toBe(false);
  });

  it("returns flipped:false for an unknown id", async () => {
    await recordNotification(input());
    expect((await markNotificationRead("0xnope:0xnope")).flipped).toBe(false);
  });
});

describe("subscribeNotifications", () => {
  it("fires the subscriber on every successful write and stops after unsubscribe", async () => {
    const fn = vi.fn();
    const unsubscribe = subscribeNotifications(fn);
    await recordNotification(input({ txHash: "0x1" }));
    expect(fn).toHaveBeenCalledTimes(1);
    await markAllNotificationsRead();
    expect(fn).toHaveBeenCalledTimes(2);
    unsubscribe();
    await recordNotification(input({ txHash: "0x2" }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not fire on a deduped (no-op) write", async () => {
    await recordNotification(input());
    const fn = vi.fn();
    subscribeNotifications(fn);
    await recordNotification(input()); // dupe → no write
    expect(fn).not.toHaveBeenCalled();
  });
});
