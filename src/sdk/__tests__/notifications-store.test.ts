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
  getIncomingWatermark,
  getUnread,
  listAllNotifications,
  listForScope,
  markAllNotificationsRead,
  markNotificationRead,
  recordNotification,
  setIncomingWatermark,
  subscribeNotifications,
  type RecordNotificationInput,
} from "../notifications-store";
import { __setGenesisIdentityResolverForTests } from "../chain-identity";

const CHAIN = "0x10f2c";
const ADDR = "mono1self";
const GENESIS_A = `0x${"11".repeat(32)}`;
const GENESIS_B = `0x${"22".repeat(32)}`;
let genesisIdentity = GENESIS_A;

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
  genesisIdentity = GENESIS_A;
  __setGenesisIdentityResolverForTests(async () => genesisIdentity);
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

describe("scope attribution", () => {
  it("stamps the owning scope (addressLower) on each record", async () => {
    const r = await recordNotification(input({ addressLower: "mono1aaa" }));
    expect(r.record?.scope).toBe("mono1aaa");
  });

  it("listForScope returns only the records recorded under that scope", async () => {
    await recordNotification(input({ addressLower: "mono1aaa", txHash: "0xa" }));
    await recordNotification(input({ addressLower: "mono1bbb", txHash: "0xb" }));
    expect((await listForScope("mono1aaa")).map((r) => r.txHash)).toEqual(["0xa"]);
    // A record stamped to scope A is never returned for scope B.
    expect((await listForScope("mono1bbb")).map((r) => r.txHash)).toEqual(["0xb"]);
  });

  it("does not match a scope that merely shares an address prefix", async () => {
    await recordNotification(input({ addressLower: "mono1ab", txHash: "0x1" }));
    await recordNotification(input({ addressLower: "mono1abc", txHash: "0x2" }));
    expect((await listForScope("mono1ab")).map((r) => r.txHash)).toEqual(["0x1"]);
    expect((await listForScope("mono1abc")).map((r) => r.txHash)).toEqual(["0x2"]);
  });

  it("attributes a legacy record (no scope field) by its storage key — no leak, not dropped", async () => {
    // Seed a pre-`scope` record directly under scope A's history key.
    const keyA = `mono.notifications.history.mono1aaa.${CHAIN}.v1`;
    backing.set("state", {
      version: 2,
      genesisIdentity: GENESIS_A,
      scopes: {
        [keyA]: {
          schemaVersion: 0,
          entries: [
            {
              id: `${CHAIN}:0xleg`,
              txHash: "0xleg",
              status: "failed",
              blockNumber: null,
              kind: "send",
              amountDecimal: "1.00",
              counterparty: "mono1to",
              // no `scope` — the legacy shape
              createdAtMs: 1_700_000_000_000,
              read: false,
              schemaVersion: 0,
            },
          ],
        },
      },
    });
    __resetNotificationsStoreForTests();
    // Tolerant parse of the old shape + correct ownership by storage key.
    expect((await listForScope("mono1aaa")).map((r) => r.txHash)).toEqual(["0xleg"]);
    expect(await listForScope("mono1bbb")).toHaveLength(0);
  });
});

describe("genesis scoping", () => {
  it("does not surface pre-regenesis history, dedupe, or incoming watermark state", async () => {
    await recordNotification(input({ txHash: "0xsame" }));
    await setIncomingWatermark(ADDR, CHAIN, {
      blockHeight: 100,
      txIndex: 2,
      logIndex: 1,
    });
    expect(await listAllNotifications()).toHaveLength(1);
    expect(await getIncomingWatermark(ADDR, CHAIN)).not.toBeNull();

    genesisIdentity = GENESIS_B;

    expect(await listAllNotifications()).toEqual([]);
    expect(await getUnread()).toBe(0);
    expect(await getIncomingWatermark(ADDR, CHAIN)).toBeNull();
    // The same chain-id/hash can exist on the replacement network. A prior
    // genesis's dedupe set must not suppress it.
    expect((await recordNotification(input({ txHash: "0xsame" }))).added).toBe(
      true,
    );
  });

  it("fails closed on the legacy chain-id-only root schema", async () => {
    const key = `mono.notifications.history.${ADDR}.${CHAIN}.v1`;
    backing.set("state", {
      version: 1,
      scopes: {
        [key]: {
          schemaVersion: 0,
          entries: [
            {
              id: `${CHAIN}:0xold`,
              txHash: "0xold",
              status: "confirmed",
              blockNumber: 99,
              kind: "send",
              amountDecimal: "1",
              counterparty: "mono1to",
              createdAtMs: 1,
              read: false,
              schemaVersion: 0,
            },
          ],
        },
      },
    });
    __resetNotificationsStoreForTests();

    expect(await listAllNotifications()).toEqual([]);
    expect(await getUnread()).toBe(0);
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
