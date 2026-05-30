import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of @tauri-apps/plugin-store. JSON round-trip mirrors the real
// plugin (it serializes to disk), keeping the test honest about what survives a
// reload. Same fake shape as notifications-store.test.ts / reconcile.test.ts.
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
  PENDING_TX_STORE_KEY,
  type PendingTx,
} from "../pending-tx";
import {
  __resetPendingTxStoreForTests,
  enqueuePendingTx,
  hasPendingTxs,
  hydratePendingTxs,
  listPendingTxs,
  pendingTxsSnapshot,
  removePendingTx,
  subscribePendingTxs,
} from "../pending-tx-store";

const CHAIN = "0x10f2c";

function tx(over: Partial<PendingTx> = {}): PendingTx {
  return {
    txHash: "0xabc",
    chainIdHex: CHAIN,
    addressLower: "mono1self",
    opKind: "send",
    amountDecimal: "1.00",
    counterparty: "mono1to",
    submittedAt: 1_700_000_000_000,
    ...over,
  };
}

beforeEach(() => {
  backing.clear();
  __resetPendingTxStoreForTests();
});

describe("pendingTxsSnapshot — synchronous render-safe read", () => {
  it("starts empty (matches a no-in-flight build before hydration)", () => {
    expect(pendingTxsSnapshot()).toEqual([]);
  });

  it("returns the same reference between calls when nothing changed (useSyncExternalStore safe)", async () => {
    await enqueuePendingTx(tx({ txHash: "0x1" }));
    const a = pendingTxsSnapshot();
    const b = pendingTxsSnapshot();
    expect(a).toBe(b);
  });

  it("hands back a NEW reference after a mutation (drives a re-render)", async () => {
    const before = pendingTxsSnapshot();
    await enqueuePendingTx(tx({ txHash: "0x1" }));
    const after = pendingTxsSnapshot();
    expect(after).not.toBe(before);
    expect(after.map((t) => t.txHash)).toEqual(["0x1"]);
  });
});

describe("hydratePendingTxs — on-mount disk warm", () => {
  it("loads a persisted set into the snapshot", async () => {
    // Seed the backing store as if a prior session left a tracked tx.
    backing.set(PENDING_TX_STORE_KEY, {
      schemaVersion: 0,
      txs: [tx({ txHash: "0xpersisted" })],
    });
    expect(pendingTxsSnapshot()).toEqual([]);

    await hydratePendingTxs();
    expect(pendingTxsSnapshot().map((t) => t.txHash)).toEqual(["0xpersisted"]);
  });

  it("notifies subscribers when hydration changes the set, and stays warm on a re-hydrate", async () => {
    backing.set(PENDING_TX_STORE_KEY, {
      schemaVersion: 0,
      txs: [tx({ txHash: "0xp" })],
    });
    let hits = 0;
    const unsub = subscribePendingTxs(() => {
      hits++;
    });

    await hydratePendingTxs();
    expect(hits).toBe(1);

    // Cache already warm + unchanged → no spurious notify.
    await hydratePendingTxs();
    expect(hits).toBe(1);
    unsub();
  });

  it("degrades to an empty set on an unreadable / absent store", async () => {
    await hydratePendingTxs();
    expect(pendingTxsSnapshot()).toEqual([]);
    expect(await hasPendingTxs()).toBe(false);
  });
});

describe("subscribePendingTxs — mutation fan-out drives the snapshot", () => {
  it("fires on enqueue and on remove, and the snapshot tracks both", async () => {
    const seen: number[] = [];
    const unsub = subscribePendingTxs(() => {
      seen.push(pendingTxsSnapshot().length);
    });

    await enqueuePendingTx(tx({ txHash: "0x1" }));
    await enqueuePendingTx(tx({ txHash: "0x2" }));
    expect(pendingTxsSnapshot().map((t) => t.txHash)).toEqual(["0x1", "0x2"]);

    await removePendingTx(CHAIN, "0x1");
    expect(pendingTxsSnapshot().map((t) => t.txHash)).toEqual(["0x2"]);

    // One notify per successful write (2 enqueues + 1 remove).
    expect(seen).toEqual([1, 2, 1]);
    unsub();
  });

  it("clears the snapshot to empty as the last tracked tx resolves (rows auto-clear)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xonly" }));
    expect(pendingTxsSnapshot()).toHaveLength(1);

    await removePendingTx(CHAIN, "0xonly");
    expect(pendingTxsSnapshot()).toEqual([]);
    expect(await listPendingTxs()).toEqual([]);
  });

  it("does not notify on an idempotent enqueue of the same (chain, hash)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xdup" }));
    let hits = 0;
    const unsub = subscribePendingTxs(() => {
      hits++;
    });
    await enqueuePendingTx(tx({ txHash: "0xdup" }));
    expect(hits).toBe(0);
    expect(pendingTxsSnapshot()).toHaveLength(1);
    unsub();
  });
});
