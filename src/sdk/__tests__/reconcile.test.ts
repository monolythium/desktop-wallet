import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of the wallet store seam, shared by the notifications
// store AND the tracked-tx store under test. the JSON round-trip matches the real
// plugin so the test stays honest about what survives a reload. (Same fake as
// notifications-store.test.ts.)
const backing = new Map<string, unknown>();

vi.mock("../wallet-store", () => {
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
  return { WalletStore: FakeStore };
});

// Stub the OS-toast helper so we can assert the reconcile path fires it exactly
// once per NEWLY-recorded terminal notification (and never on a deduped
// re-observe). The real helper is exercised separately; here we only care that
// reconcile.ts calls it with the record it just recorded.
const toastSpy = vi.fn((_record: unknown): Promise<void> => Promise.resolve());
vi.mock("../os-toast", () => ({
  toastTerminalNotification: (record: unknown) => toastSpy(record),
}));

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
import {
  PENDING_SLOW_MS,
  PENDING_TERMINAL_RETAIN_MS,
  type PendingTx,
} from "../pending-tx";
import { reconcilePendingOnce, trackOperationTx } from "../reconcile";
import { __setGenesisIdentityResolverForTests } from "../chain-identity";

const GENESIS = `0x${"11".repeat(32)}`;

// ── Fake RpcClient ──
// Per-hash scripted answers for the two methods the reconciler probes. A
// missing entry means "not surfaced" (txStatus=not_found / receipt=null), which
// keeps the tx pending — the honest default.
type TxStatusAnswer =
  | { status: "found"; blockNumber: number }
  | { status: "not_found" }
  | { throws: true };
type ReceiptAnswer =
  | { status: number; block_number: bigint; tx_index?: number }
  | null
  | { throws: true };

let txStatusScript: Map<string, TxStatusAnswer>;
let receiptScript: Map<string, ReceiptAnswer>;
// F4 — raw JSON-RPC receipts keyed by hash, carrying the snake_case
// `revert_reason` the SDK normaliser drops. A missing entry means the raw call
// returns null (the fail-safe path: reason falls back to the unavailable marker).
let rawReceiptScript: Map<string, unknown>;

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
    async call(method: string, params: unknown[]) {
      // F4's single documented bypass reads the raw receipt here.
      if (method === "eth_getTransactionReceipt") {
        const hash = (params as string[])[0]!;
        return rawReceiptScript.get(hash) ?? null;
      }
      return null;
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
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  backing.clear();
  seedActiveVault();
  __setGenesisIdentityResolverForTests(async () => GENESIS);
  __resetNotificationsStoreForTests();
  __resetPendingTxStoreForTests();
  txStatusScript = new Map();
  receiptScript = new Map();
  rawReceiptScript = new Map();
  toastSpy.mockClear();
  installFakeClient();
});

function seedActiveVault(): void {
  backing.set("vaults:state", {
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

describe("reconcilePendingOnce — confirmed path (bridge)", () => {
  it("records a confirmed notification on found and BRIDGES (keeps it, stamps the slot)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xc1" }));
    txStatusScript.set("0xc1", { status: "found", blockNumber: 321 }); // included → txIndex 0
    // Included + successful: the receipt establishes the outcome ("found" alone
    // is inclusion, not success, so a success receipt is now required to confirm).
    receiptScript.set("0xc1", { status: 1, block_number: 321n, tx_index: 0 });

    const res = await reconcilePendingOnce();
    expect(res.recorded).toBe(1);
    // Bridged rows stay tracked (rendered confirmed) until the feed retires them.
    expect(res.remaining).toBe(1);

    const notes = await listAllNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0]!.status).toBe("confirmed");
    expect(notes[0]!.txHash).toBe("0xc1");
    expect(notes[0]!.blockNumber).toBe(321);

    const tracked = await listPendingTxs();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.confirmedBlockHeight).toBe(321);
    expect(tracked[0]!.confirmedTxIndex).toBe(0);
  });

  it("confirms + bridges via a success receipt when txStatus hasn't surfaced", async () => {
    await enqueuePendingTx(tx({ txHash: "0xc2" }));
    receiptScript.set("0xc2", { status: 1, block_number: 88n, tx_index: 2 });

    await reconcilePendingOnce();
    const notes = await listAllNotifications();
    expect(notes[0]!.status).toBe("confirmed");
    expect(notes[0]!.blockNumber).toBe(88);

    const tracked = await listPendingTxs();
    expect(tracked[0]!.confirmedBlockHeight).toBe(88);
    expect(tracked[0]!.confirmedTxIndex).toBe(2);
  });

  it("skips a bridged row on later ticks — no re-record, no re-toast", async () => {
    await enqueuePendingTx(tx({ txHash: "0xc3" }));
    txStatusScript.set("0xc3", { status: "found", blockNumber: 5 });
    receiptScript.set("0xc3", { status: 1, block_number: 5n, tx_index: 0 });
    await reconcilePendingOnce();
    expect(toastSpy).toHaveBeenCalledTimes(1);

    const res = await reconcilePendingOnce(); // bridged → skipped
    expect(res.recorded).toBe(0);
    expect(res.remaining).toBe(1);
    expect(await listAllNotifications()).toHaveLength(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
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
    // A reverted receipt's on-chain reason is dropped by the SDK normaliser, so
    // the record carries the honest "reason exists but unread" marker (F4 reads
    // the real text) — never a silent absence.
    expect(notes[0]!.reason).toBe("reason-unavailable");
    expect(await listPendingTxs()).toHaveLength(0);
  });
});

describe("reconcilePendingOnce — F4 real revert reason", () => {
  it("surfaces the chain's classified reason + a bounded detail, not the unavailable marker", async () => {
    await enqueuePendingTx(tx({ txHash: "0xr1", opKind: "delegate" }));
    receiptScript.set("0xr1", { status: 0, block_number: 20n });
    rawReceiptScript.set("0xr1", {
      status: 0,
      revert_reason: "precompile call is not payable; attached value rejected",
    });

    await reconcilePendingOnce();
    const notes = await listAllNotifications();
    expect(notes[0]!.status).toBe("failed");
    // The three-way distinction: a REAL reason was read, so the record must not
    // carry the "unavailable" marker; the sanitised excerpt is surfaced verbatim.
    expect(notes[0]!.reason).not.toBe("reason-unavailable");
    expect(notes[0]!.reasonDetail).toBe(
      "precompile call is not payable; attached value rejected",
    );
  });

  it("a coded revert carries the numeric revert code (0x02NN)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xr2" }));
    receiptScript.set("0xr2", { status: 0, block_number: 21n });
    rawReceiptScript.set("0xr2", { status: 0, revert_reason: "execution reverted: 0x0214" });

    await reconcilePendingOnce();
    const notes = await listAllNotifications();
    expect(notes[0]!.reason).toBe("transaction-reverted");
    expect(notes[0]!.reasonCode).toBe(0x0214);
  });

  it("falls back to the unavailable marker when the raw read yields nothing (fail-safe)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xr3" }));
    receiptScript.set("0xr3", { status: 0, block_number: 22n });
    // No rawReceiptScript entry → the raw call returns null. The three-way
    // distinction holds: an honest "unavailable", never a silent absence or guess.

    await reconcilePendingOnce();
    const notes = await listAllNotifications();
    expect(notes[0]!.status).toBe("failed");
    expect(notes[0]!.reason).toBe("reason-unavailable");
    expect(notes[0]!.reasonDetail).toBeUndefined();
    expect(notes[0]!.reasonCode).toBeUndefined();
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

  it("an INCLUDED tx with no receipt yet stays pending, then resolves next tick", async () => {
    // "found" is inclusion, not success — with no receipt this round the outcome
    // is unestablished, so no terminal record fires; the tx keeps tracking.
    await enqueuePendingTx(tx({ txHash: "0xinc" }));
    txStatusScript.set("0xinc", { status: "found", blockNumber: 9 });

    const t1 = await reconcilePendingOnce();
    expect(t1.recorded).toBe(0);
    expect(t1.remaining).toBe(1);
    expect(await listAllNotifications()).toHaveLength(0);
    // V-A: it was observed included, so it is flagged — the time-ladder must not
    // later age it into a false "didn't confirm" when its nonce is passed.
    expect((await listPendingTxs())[0]!.seenIncluded).toBe(true);

    // The receipt lands next tick → the outcome resolves (here: success).
    receiptScript.set("0xinc", { status: 1, block_number: 9n, tx_index: 0 });
    const t2 = await reconcilePendingOnce();
    expect(t2.recorded).toBe(1);
    expect((await listAllNotifications())[0]!.status).toBe("confirmed");
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

describe("reconcilePendingOnce — lifecycle retention (honest absence)", () => {
  it("does NOT drop a slow tx; records + bridges it when the chain confirms", async () => {
    const now = Date.now();
    // Older than the slow threshold but well within the retention window — the
    // old blind 5-min silent drop is gone, so the tx is followed, recorded, and
    // bridged (kept, rendered confirmed) rather than vanishing.
    await enqueuePendingTx(
      tx({ txHash: "0xs1", submittedAt: now - PENDING_SLOW_MS - 1_000 }),
    );
    txStatusScript.set("0xs1", { status: "found", blockNumber: 5 });
    receiptScript.set("0xs1", { status: 1, block_number: 5n, tx_index: 0 });

    const res = await reconcilePendingOnce(now);
    expect(res.recorded).toBe(1);
    expect(res.expired).toBe(0);
    expect(res.remaining).toBe(1); // bridged, kept
    expect(await listAllNotifications()).toHaveLength(1);
    const tracked = await listPendingTxs();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.confirmedBlockHeight).toBe(5);
  });

  it("silently removes a still-pending tx past the retention window (no record)", async () => {
    const now = Date.now();
    await enqueuePendingTx(
      tx({ txHash: "0xe1", submittedAt: now - PENDING_TERMINAL_RETAIN_MS - 1_000 }),
    );
    // No terminal answer this round — it ages out of the retention window.

    const res = await reconcilePendingOnce(now);
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
    receiptScript.set("0xd1", { status: 1, block_number: 1n, tx_index: 0 });
    await reconcilePendingOnce();
    expect(await listAllNotifications()).toHaveLength(1);

    // Same hash tracked again (e.g. a stale re-submit) + terminal again.
    await enqueuePendingTx(tx({ txHash: "0xd1" }));
    const res = await reconcilePendingOnce();
    // The first confirm bridged it (still tracked, remaining 1), but the store
    // dedupes on ${chainIdHex}:${txHash}, so no second record is added.
    expect(res.remaining).toBe(1);
    expect(await listAllNotifications()).toHaveLength(1);
  });
});

describe("reconcilePendingOnce — OS toast fires once per new record", () => {
  it("fires the OS toast exactly once for a newly-recorded confirmed tx", async () => {
    await enqueuePendingTx(tx({ txHash: "0xt1" }));
    txStatusScript.set("0xt1", { status: "found", blockNumber: 7 });
    receiptScript.set("0xt1", { status: 1, block_number: 7n, tx_index: 0 });

    await reconcilePendingOnce();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    // It's handed the record that was just recorded (same hash + status).
    const arg = toastSpy.mock.calls[0]![0] as { txHash: string; status: string };
    expect(arg.txHash).toBe("0xt1");
    expect(arg.status).toBe("confirmed");
  });

  it("fires for a failed tx too", async () => {
    await enqueuePendingTx(tx({ txHash: "0xt2", opKind: "delegate" }));
    receiptScript.set("0xt2", { status: 0, block_number: 4n });

    await reconcilePendingOnce();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect((toastSpy.mock.calls[0]![0] as { status: string }).status).toBe(
      "failed",
    );
  });

  it("does NOT re-toast a re-observed (deduped) terminal hash", async () => {
    await enqueuePendingTx(tx({ txHash: "0xt3" }));
    txStatusScript.set("0xt3", { status: "found", blockNumber: 1 });
    receiptScript.set("0xt3", { status: 1, block_number: 1n, tx_index: 0 });
    await reconcilePendingOnce();
    expect(toastSpy).toHaveBeenCalledTimes(1);

    // Same hash tracked + terminal again — recordNotification dedupes
    // (added: false), so the toast must NOT fire a second time.
    await enqueuePendingTx(tx({ txHash: "0xt3" }));
    await reconcilePendingOnce();
    expect(toastSpy).toHaveBeenCalledTimes(1);
  });

  it("does not toast when nothing reaches a terminal state", async () => {
    await enqueuePendingTx(tx({ txHash: "0xt4" }));
    // No script entries → stays pending.
    await reconcilePendingOnce();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("does not toast a tx silently removed past the retention window", async () => {
    const now = Date.now();
    await enqueuePendingTx(
      tx({ txHash: "0xt5", submittedAt: now - PENDING_TERMINAL_RETAIN_MS - 1 }),
    );
    // No terminal answer — it's removed by retention, never recorded → no toast.
    await reconcilePendingOnce(now);
    expect(toastSpy).not.toHaveBeenCalled();
  });
});

describe("reconcilePendingOnce — mixed batch in one tick", () => {
  it("bridges one, fails one, keeps one, expires one", async () => {
    const now = Date.now();
    await enqueuePendingTx(tx({ txHash: "0xok" }));
    await enqueuePendingTx(tx({ txHash: "0xrevert" }));
    await enqueuePendingTx(tx({ txHash: "0xwait" }));
    await enqueuePendingTx(
      tx({ txHash: "0xold", submittedAt: now - PENDING_TERMINAL_RETAIN_MS - 1 }),
    );
    txStatusScript.set("0xok", { status: "found", blockNumber: 10 });
    receiptScript.set("0xok", { status: 1, block_number: 10n, tx_index: 0 });
    receiptScript.set("0xrevert", { status: 0, block_number: 11n });

    const res = await reconcilePendingOnce(now);
    expect(res.recorded).toBe(2);
    expect(res.expired).toBe(1);
    // 0xok bridged (kept, rendered confirmed) + 0xwait still pending; 0xrevert
    // removed (failed) and 0xold removed (retention).
    expect(res.remaining).toBe(2);

    const byHash = Object.fromEntries(
      (await listAllNotifications()).map((n) => [n.txHash, n.status]),
    );
    expect(byHash).toEqual({ "0xok": "confirmed", "0xrevert": "failed" });
    expect((await listPendingTxs()).map((t) => t.txHash)).toEqual(["0xok", "0xwait"]);
  });
});

describe("reconcilePendingOnce — chain scope isolation", () => {
  // The active chain in this suite is the builtin ("0x10f2c"): no wallet.chain.active
  // is set, so scopeChainKey() falls back to the builtin. A tracked tx on a
  // DIFFERENT chain must be left wholly untouched — never probed against the
  // active RPC (which never saw its hash) and never aged or removed.
  it("does NOT probe or record a tx on a non-active chain, even if its hash would confirm", async () => {
    await enqueuePendingTx(tx({ txHash: "0xactive", chainIdHex: "0x10f2c" }));
    await enqueuePendingTx(tx({ txHash: "0xoffchain", chainIdHex: "0x539" }));
    // BOTH hashes would confirm if probed — only the active-chain one may be.
    txStatusScript.set("0xactive", { status: "found", blockNumber: 10 });
    receiptScript.set("0xactive", { status: 1, block_number: 10n, tx_index: 0 });
    txStatusScript.set("0xoffchain", { status: "found", blockNumber: 10 });

    const res = await reconcilePendingOnce();

    // Only the active-chain tx was recorded; the off-chain one was never probed.
    expect(res.recorded).toBe(1);
    const byHash = Object.fromEntries(
      (await listAllNotifications()).map((n) => [n.txHash, n.status]),
    );
    expect(byHash).toEqual({ "0xactive": "confirmed" });
    // The off-chain row survives untouched (still tracked, not bridged/relabeled),
    // to be reconciled when its own chain is active again.
    const off = (await listPendingTxs()).find((t) => t.txHash === "0xoffchain");
    expect(off).toBeDefined();
    expect(off!.confirmedBlockHeight).toBeUndefined();
    expect(off!.lifecycle).toBeUndefined();
  });

  it("counts only the active chain's rows as remaining (poller idles per chain)", async () => {
    await enqueuePendingTx(tx({ txHash: "0xoffchain", chainIdHex: "0x539" }));
    // Nothing on the active chain: the tick has no active-chain work.
    const res = await reconcilePendingOnce();
    expect(res.remaining).toBe(0);
    // …but the off-chain row is still on disk, awaiting its chain.
    expect((await listPendingTxs()).map((t) => t.txHash)).toEqual(["0xoffchain"]);
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

  it("threads a token unit onto the tracked tx (so it isn't mislabeled LYTH)", async () => {
    await trackOperationTx(
      { kind: "send", amountDecimal: "1.5", unit: "USDC", counterparty: "mono1to" },
      "0xtok",
    );
    const tracked = await listPendingTxs();
    expect(tracked[0]!.unit).toBe("USDC");
  });

  it("leaves the unit absent for a native LYTH send (renders LYTH)", async () => {
    await trackOperationTx(
      { kind: "send", amountDecimal: "1", counterparty: "mono1to" },
      "0xnat",
    );
    const tracked = await listPendingTxs();
    expect(tracked[0]!.unit).toBeUndefined();
  });
});
