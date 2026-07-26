// Two detection paths, one set of arrivals.
//
// Incoming detection now runs from two places: the Activity page's refresh and
// the app-level poller. They can overlap freely — the user opens Activity while
// a poll is mid-flight, or a poll fires seconds after a manual refresh — and
// both see the same indexed rows.
//
// Nothing coordinates them, and nothing needs to: they share the per-scope
// watermark and the `${chainIdHex}:${txHash}` record dedupe, so a second pass
// over the same arrival writes nothing and raises nothing. This test drives both
// paths against one store to show that holds, because the failure would be a
// user notified twice for money that arrived once.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IncomingWatermark } from "../notifications";

// ── An in-memory stand-in with the real store's contract ──────────────────
// recordNotification is idempotent on the record id; the watermark is per
// (address, chain).
const records = new Map<string, unknown>();
const watermarks = new Map<string, IncomingWatermark>();
const toasts: unknown[] = [];

const recordNotification = vi.hoisted(() => vi.fn());
const getIncomingWatermark = vi.hoisted(() => vi.fn());
const setIncomingWatermark = vi.hoisted(() => vi.fn());
const toastTerminalNotification = vi.hoisted(() => vi.fn());
const readIncomingEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock("../notifications-store", () => ({
  recordNotification,
  getIncomingWatermark,
  setIncomingWatermark,
}));
vi.mock("../os-toast", () => ({ toastTerminalNotification }));
vi.mock("../feature-flags", () => ({ readIncomingEnabled }));

import { detectAndNotifyIncoming } from "../incoming-detect";
import type { LiveAddressActivityRow } from "../live";

const SCOPE = { address: "mono1self", chain: "0x10f2c" };

function wmKey(a: string, c: string) {
  return `${a}.${c}`;
}

beforeEach(() => {
  records.clear();
  watermarks.clear();
  toasts.length = 0;
  vi.clearAllMocks();
  readIncomingEnabled.mockReturnValue(true);

  recordNotification.mockImplementation(
    async (input: { chainIdHex: string; txHash: string }) => {
      const id = `${input.chainIdHex}:${input.txHash}`;
      if (records.has(id)) return { added: false, record: null };
      const record = { ...input, id };
      records.set(id, record);
      return { added: true, record };
    },
  );
  getIncomingWatermark.mockImplementation(
    async (a: string, c: string) => watermarks.get(wmKey(a, c)) ?? null,
  );
  setIncomingWatermark.mockImplementation(
    async (a: string, c: string, w: IncomingWatermark) => {
      watermarks.set(wmKey(a, c), w);
    },
  );
  toastTerminalNotification.mockImplementation((r: unknown) => {
    toasts.push(r);
  });
});

function inbound(over: Partial<LiveAddressActivityRow> = {}): LiveAddressActivityRow {
  return {
    blockHeight: 100n,
    txIndex: 0,
    logIndex: 0,
    kind: "transfer",
    direction: "in",
    counterparty: "mono1sender",
    tokenId: null,
    amount: "2000000000000000000",
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
    ...over,
  };
}

/** The Activity page's refresh path and the poller's path are the same call —
 *  that is the point. Named apart here so the intent of each pass is legible. */
const activityPagePass = (rows: LiveAddressActivityRow[]) =>
  detectAndNotifyIncoming(SCOPE.address, SCOPE.chain, rows);
const pollerPass = (rows: LiveAddressActivityRow[]) =>
  detectAndNotifyIncoming(SCOPE.address, SCOPE.chain, rows);

describe("overlap between the two detection paths", () => {
  it("records and toasts ONE arrival exactly once across both paths", async () => {
    const rows = [inbound()];
    const first = await activityPagePass(rows);
    const second = await pollerPass(rows);

    expect(first.recorded).toBe(1);
    expect(second.recorded).toBe(0);
    expect(records.size).toBe(1);
    expect(toasts).toHaveLength(1);
  });

  it("holds in the other order too (poller first, then the page)", async () => {
    const rows = [inbound()];
    expect((await pollerPass(rows)).recorded).toBe(1);
    expect((await activityPagePass(rows)).recorded).toBe(0);
    expect(records.size).toBe(1);
    expect(toasts).toHaveLength(1);
  });

  it("survives many interleaved passes over an unchanged feed", async () => {
    const rows = [inbound({ txIndex: 0 }), inbound({ txIndex: 1, amount: "5000000000000000000" })];
    for (let i = 0; i < 6; i++) {
      await (i % 2 === 0 ? activityPagePass(rows) : pollerPass(rows));
    }
    expect(records.size).toBe(2);
    expect(toasts).toHaveLength(2);
  });

  it("a genuinely NEW arrival after an overlap is still detected", async () => {
    const first = [inbound({ blockHeight: 100n })];
    await activityPagePass(first);
    await pollerPass(first);
    expect(records.size).toBe(1);

    const withNewer = [...first, inbound({ blockHeight: 101n, amount: "7000000000000000000" })];
    const out = await pollerPass(withNewer);
    expect(out.recorded).toBe(1);
    expect(records.size).toBe(2);
  });

  it("two same-block arrivals stay distinct rather than collapsing into one", async () => {
    // Same block, same sentinel indices — only the folded id keeps them apart.
    const rows = [
      inbound({ amount: "1000000000000000000" }),
      inbound({ amount: "3000000000000000000" }),
    ];
    await activityPagePass(rows);
    await pollerPass(rows);
    expect(records.size).toBe(2);
    expect(toasts).toHaveLength(2);
  });

  it("keeps the watermark from regressing when the paths interleave", async () => {
    await pollerPass([inbound({ blockHeight: 200n })]);
    const high = watermarks.get(wmKey(SCOPE.address, SCOPE.chain));
    expect(high?.blockHeight).toBe(200);

    // A page whose newest row is older must not pull the watermark back.
    await activityPagePass([inbound({ blockHeight: 150n })]);
    expect(watermarks.get(wmKey(SCOPE.address, SCOPE.chain))?.blockHeight).toBe(200);
  });

  it("the in-app record is written even when OS toasts are disabled", async () => {
    readIncomingEnabled.mockReturnValue(false);
    await pollerPass([inbound()]);
    expect(records.size).toBe(1);
    expect(toasts).toHaveLength(0);
  });

  it("a different chain scope is tracked separately", async () => {
    const rows = [inbound()];
    await detectAndNotifyIncoming(SCOPE.address, "0x10f2c", rows);
    await detectAndNotifyIncoming(SCOPE.address, "0x539", rows);
    // Same arrival shape, two chains — two records, two watermarks.
    expect(records.size).toBe(2);
    expect(watermarks.size).toBe(2);
  });
});
