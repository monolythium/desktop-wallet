import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of @tauri-apps/plugin-store, shared by the notifications
// store AND the tracked-tx store under test. JSON round-trip mirrors the real
// plugin so the test stays honest about what survives a reload. (Same fake as
// notifications-store.test.ts.)
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

import { setProviderForTest, type MonolythiumClient } from "../client";
import {
  __resetNotificationsStoreForTests,
  listAllNotifications,
} from "../notifications-store";
import {
  __resetPendingTxStoreForTests,
  enqueuePendingTx,
  listPendingTxs,
} from "../pending-tx-store";
import { PENDING_TX_WINDOW_MS, type PendingTx } from "../pending-tx";
import { reconcilePendingOnce, trackOperationTx } from "../reconcile";

// ── Fake RpcClient ──
// Per-hash scripted answers for the two methods the reconciler probes. A
// missing entry means "not surfaced" (txStatus=not_found / receipt=null), which
// keeps the tx pending — the honest default.
type TxStatusAnswer =
  | { status: "found"; blockNumber: number }
  | { status: "not_found" }
  | { throws: true };
type ReceiptAnswer =
  | { status: number; block_number: bigint }
  | null
  | { throws: true };

let txStatusScript: Map<string, TxStatusAnswer>;
let receiptScript: Map<string, ReceiptAnswer>;

function installFakeClient(): void {
  const rpcClient = {
    async lythTxStatus(txHash: string) {
      const a = txStatusScript.get(txHash);
      if (!a || a === undefined) return { status: "not_found", txHash };
      if ("throws" in a) throw new Error("rpc down");
      if (a.status === "found") {
        return {
          status: "found",
          txHash,
          blockHash: "0xbh",
          blockNumber: a.blockNumber,
          txIndex: 0,
        };
      }
      return { status: "not_found", txHash };
    },
    async ethGetTransactionReceipt(txHash: string) {
      const a = receiptScript.get(txHash);
      if (a === undefined) return null;
      if (a !== null && "throws" in a) throw new Error("rpc down");
      return a;
    },
  };
  setProviderForTest({
    rpcClient: rpcClient as unknown as MonolythiumClient["rpcClient"],
    endpoint: "http://test",
  });
}

function tx(over: Partial<PendingTx> = {}): PendingTx {
  return {
    txHash: "0xabc",
    chainIdHex: "0x10f2c",
    addressLower: "mono1self",
    opKind: "send",
    amountDecimal: "1.00",
    counterparty: "mono1to",
    submittedAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  backing.clear();
  __resetNotificationsStoreForTests();
  __resetPendingTxStoreForTests();
  txStatusScript = new Map();
  receiptScript = new Map();
  installFakeClient();
});

describe("reconcilePendingOnce — confirmed path", () => {
  it("records a 'confirmed' notification on lyth_txStatus=found and stops tracking", async () => {
    await enqueuePendingTx(tx({ txHash: "0xc1" }));
    txStatusScript.set("0xc1", { status: "found", blockNumber: 321 });

    const res = await reconcilePendingOnce();
    expect(res.recorded).toBe(1);
    expect(res.remaining).toBe(0);

    const notes = await listAllNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.status).toBe("confirmed");
    expect(notes[0]!.txHash).toBe("0xc1");
    expect(notes[0]!.blockNumber).toBe(321);

    // Removed from the tracked set — won't re-fire next tick.
    expect(await listPendingTxs()).toHaveLength(0);
  });

  it("confirms via a success receipt when txStatus hasn't surfaced", async () => {
    await enqueuePendingTx(tx({ txHash: "0xc2" }));
    receiptScript.set("0xc2", { status: 1, block_number: 88n });

    await reconcilePendingOnce();
    const notes = await listAllNotifications();
    expect(notes[0]!.status).toBe("confirmed");
    expect(notes[0]!.blockNumber).toBe(88);
  });
});

describe("reconcilePendingOnce — failed path (the fix)", () => {
  it("records a 'failed' notification on a reverted receipt (status 0)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xf1", opKind: "delegate" }));
    receiptScript.set("0xf1", { status: 0, block_number: 12n });

    const res = await reconcilePendingOnce();
    expect(res.recorded).toBe(1);

    const notes = await listAllNotifications();
    expect(notes[0]!.status).toBe("failed");
    expect(notes[0]!.txHash).toBe("0xf1");
    expect(notes[0]!.blockNumber).toBe(12);
    expect(notes[0]!.kind).toBe("delegate");
    expect(await listPendingTxs()).toHaveLength(0);
  });
});

describe("reconcilePendingOnce — never synthesizes; keeps tracking", () => {
  it("keeps a tx pending (no record) when the chain has no terminal answer", async () => {
    await enqueuePendingTx(tx({ txHash: "0xp1" }));
    // No script entries → not_found + null receipt.

    const res = await reconcilePendingOnce();
    expect(res.recorded).toBe(0);
    expect(res.remaining).toBe(1);
    expect(await listAllNotifications()).toHaveLength(0);
    expect(await listPendingTxs()).toHaveLength(1);
  });

  it("keeps a tx pending when both RPCs throw", async () => {
    await enqueuePendingTx(tx({ txHash: "0xp2" }));
    txStatusScript.set("0xp2", { throws: true });
    receiptScript.set("0xp2", { throws: true });

    const res = await reconcilePendingOnce();
    expect(res.recorded).toBe(0);
    expect(res.remaining).toBe(1);
    expect(await listPendingTxs()).toHaveLength(1);
  });
});

describe("reconcilePendingOnce — window expiry (honest absence)", () => {
  it("drops an expired tx SILENTLY (no notification) and stops tracking", async () => {
    const old = Date.now() - PENDING_TX_WINDOW_MS - 1_000;
    await enqueuePendingTx(tx({ txHash: "0xe1", submittedAt: old }));
    // Even if the chain WOULD confirm it, expiry is checked first.
    txStatusScript.set("0xe1", { status: "found", blockNumber: 5 });

    const res = await reconcilePendingOnce();
    expect(res.expired).toBe(1);
    expect(res.recorded).toBe(0);
    expect(res.remaining).toBe(0);
    expect(await listAllNotifications()).toHaveLength(0);
    expect(await listPendingTxs()).toHaveLength(0);
  });
});

describe("reconcilePendingOnce — dedupe across ticks", () => {
  it("a re-enqueued terminal hash never produces a second notification", async () => {
    await enqueuePendingTx(tx({ txHash: "0xd1" }));
    txStatusScript.set("0xd1", { status: "found", blockNumber: 1 });
    await reconcilePendingOnce();
    expect(await listAllNotifications()).toHaveLength(1);

    // Same hash tracked again (e.g. a stale re-submit) + terminal again.
    await enqueuePendingTx(tx({ txHash: "0xd1" }));
    const res = await reconcilePendingOnce();
    // It's removed from tracking, but the notification store dedupes on
    // ${chainIdHex}:${txHash}, so no second record is added.
    expect(res.remaining).toBe(0);
    expect(await listAllNotifications()).toHaveLength(1);
  });
});

describe("reconcilePendingOnce — mixed batch in one tick", () => {
  it("confirms one, fails one, keeps one, expires one", async () => {
    const now = Date.now();
    await enqueuePendingTx(tx({ txHash: "0xok" }));
    await enqueuePendingTx(tx({ txHash: "0xrevert" }));
    await enqueuePendingTx(tx({ txHash: "0xwait" }));
    await enqueuePendingTx(
      tx({ txHash: "0xold", submittedAt: now - PENDING_TX_WINDOW_MS - 1 }),
    );
    txStatusScript.set("0xok", { status: "found", blockNumber: 10 });
    receiptScript.set("0xrevert", { status: 0, block_number: 11n });

    const res = await reconcilePendingOnce(now);
    expect(res.recorded).toBe(2);
    expect(res.expired).toBe(1);
    expect(res.remaining).toBe(1);

    const byHash = Object.fromEntries(
      (await listAllNotifications()).map((n) => [n.txHash, n.status]),
    );
    expect(byHash).toEqual({ "0xok": "confirmed", "0xrevert": "failed" });
    expect((await listPendingTxs()).map((t) => t.txHash)).toEqual(["0xwait"]);
  });
});

describe("trackOperationTx — enqueue-on-submit", () => {
  it("enqueues a tx with a hash into the durable store", async () => {
    await trackOperationTx(
      { kind: "send", amountDecimal: "2.50", counterparty: "mono1to" },
      "0xnew",
    );
    const tracked = await listPendingTxs();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.txHash).toBe("0xnew");
    expect(tracked[0]!.opKind).toBe("send");
    expect(tracked[0]!.amountDecimal).toBe("2.50");
    expect(tracked[0]!.chainIdHex).toBe("0x10f2c");
  });

  it("is a no-op without a hash (batch ops carry no single hash)", async () => {
    await trackOperationTx(
      { kind: "delegate", amountDecimal: "0", counterparty: "mono1c" },
      undefined,
    );
    expect(await listPendingTxs()).toHaveLength(0);
  });

  it("is idempotent on a repeated hash (no double-tracking)", async () => {
    const meta = { kind: "send" as const, amountDecimal: "1", counterparty: "mono1to" };
    await trackOperationTx(meta, "0xdup");
    await trackOperationTx(meta, "0xdup");
    expect(await listPendingTxs()).toHaveLength(1);
  });
});
