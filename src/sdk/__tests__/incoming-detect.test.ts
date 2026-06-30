import { describe, expect, it } from "vitest";
import {
  incomingCandidatesFromRows,
  incomingTransferId,
  planIncomingNotifications,
  type IncomingCandidate,
} from "../incoming-detect";
import type { LiveAddressActivityRow } from "../live";
import type { IncomingWatermark } from "../notifications";

function row(over: Partial<LiveAddressActivityRow>): LiveAddressActivityRow {
  return {
    blockHeight: 1n,
    txIndex: 0,
    logIndex: 0,
    kind: "transfer",
    direction: "in",
    counterparty: "mono1from",
    tokenId: null,
    amount: "2000000000000000000", // 2 LYTH in raw lythoshi (indexer wire form)
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
    ...over,
  };
}

function cand(
  b: number,
  t: number,
  l: number,
  cp = "x",
  amount = "1",
): IncomingCandidate {
  return { anchor: { blockHeight: b, txIndex: t, logIndex: l }, amountDecimal: amount, counterparty: cp };
}

describe("incomingCandidatesFromRows", () => {
  it("keeps inbound native LYTH (null OR zero-address id), converts to display LYTH, ignores outgoing + MRC-20", () => {
    const rows = [
      row({ direction: "in", tokenId: null }),
      row({ direction: "in", tokenId: "0x" + "00".repeat(32) }), // native zero-address — kept
      row({ direction: "out", tokenId: null }),
      row({ direction: "in", tokenId: "0xtoken" }), // MRC-20 — skipped
    ];
    const c = incomingCandidatesFromRows(rows);
    expect(c).toHaveLength(2);
    // Raw lythoshi converted to display LYTH (not the raw 2e18 integer).
    expect(c[0]!.amountDecimal).toBe("2");
    expect(c[1]!.amountDecimal).toBe("2");
  });

  it("falls back to '0' / '' when amount or counterparty is absent", () => {
    const c = incomingCandidatesFromRows([row({ amount: null, counterparty: null })]);
    expect(c[0]!.amountDecimal).toBe("0");
    expect(c[0]!.counterparty).toBe("");
  });
});

describe("planIncomingNotifications", () => {
  it("first run baselines to the newest anchor (seeding its blockIds) and records nothing", () => {
    const plan = planIncomingNotifications(null, [cand(5, 0, 0), cand(7, 1, 0)]);
    expect(plan.toRecord).toHaveLength(0);
    expect(plan.baseline).toEqual({
      blockHeight: 7,
      txIndex: 1,
      logIndex: 0,
      blockIds: ["in:7.1.0:x:1:0"],
    });
    expect(plan.newWatermark).toBeNull();
  });

  it("records only candidates strictly after the watermark, oldest first", () => {
    const wm: IncomingWatermark = { blockHeight: 5, txIndex: 0, logIndex: 0 };
    const plan = planIncomingNotifications(wm, [cand(5, 0, 0), cand(6, 0, 0), cand(7, 0, 0)]);
    expect(plan.toRecord.map((c) => c.anchor.blockHeight)).toEqual([6, 7]);
    expect(plan.newWatermark).toEqual({
      blockHeight: 7,
      txIndex: 0,
      logIndex: 0,
      blockIds: ["in:7.0.0:x:1:0"],
    });
  });

  it("records nothing new at the top block, but upgrades the watermark's blockIds", () => {
    // Legacy watermark already at the newest block (no blockIds): nothing is
    // strictly newer, so nothing is recorded — but the watermark gains the
    // block's accounted ids so a later same-block arrival is detected.
    const wm: IncomingWatermark = { blockHeight: 7, txIndex: 0, logIndex: 0 };
    const plan = planIncomingNotifications(wm, [cand(5, 0, 0), cand(7, 0, 0)]);
    expect(plan.toRecord).toHaveLength(0);
    expect(plan.newWatermark).toEqual({
      blockHeight: 7,
      txIndex: 0,
      logIndex: 0,
      blockIds: ["in:7.0.0:x:1:0"],
    });
  });

  it("is a no-op when there are no candidates", () => {
    expect(planIncomingNotifications(null, [])).toEqual({
      baseline: null,
      toRecord: [],
      newWatermark: null,
    });
  });
});

describe("planIncomingNotifications — same-block accounting (blockIds + folded id)", () => {
  const SENTINEL = 4294967295; // u32::MAX — the live native-receive logIndex

  it("records two same-block native receives (same sentinel anchor) as distinct rows", () => {
    const wm: IncomingWatermark = { blockHeight: 9, txIndex: 0, logIndex: SENTINEL, blockIds: [] };
    const a = cand(10, 0, SENTINEL, "mono1aaa", "5");
    const b = cand(10, 0, SENTINEL, "mono1bbb", "7");
    const plan = planIncomingNotifications(wm, [a, b]);
    expect(plan.toRecord).toHaveLength(2);
    const ids = plan.toRecord.map((c) => c.id);
    expect(new Set(ids).size).toBe(2); // distinct ids despite the identical anchor
    expect(plan.newWatermark?.blockIds).toEqual(expect.arrayContaining(ids));
  });

  it("assigns a distinct seq to two identical (block,cp,amount) receives", () => {
    const wm: IncomingWatermark = { blockHeight: 9, txIndex: 0, logIndex: SENTINEL, blockIds: [] };
    const dup = () => cand(10, 0, SENTINEL, "mono1same", "3");
    const plan = planIncomingNotifications(wm, [dup(), dup()]);
    expect(plan.toRecord.map((c) => c.id)).toEqual([
      incomingTransferId({ blockHeight: 10, txIndex: 0, logIndex: SENTINEL }, "mono1same", "3", 0),
      incomingTransferId({ blockHeight: 10, txIndex: 0, logIndex: SENTINEL }, "mono1same", "3", 1),
    ]);
  });

  it("treats a LEGACY watermark's boundary block as history (no re-toast on upgrade)", () => {
    const legacy: IncomingWatermark = { blockHeight: 10, txIndex: 0, logIndex: SENTINEL };
    const plan = planIncomingNotifications(legacy, [
      cand(10, 0, SENTINEL, "mono1aaa", "5"),
      cand(10, 0, SENTINEL, "mono1bbb", "7"),
    ]);
    expect(plan.toRecord).toHaveLength(0); // boundary block is history
    expect(plan.newWatermark?.blockIds).toHaveLength(2); // …but seeded for next time
  });

  it("re-admits nothing already accounted, but admits a genuinely new same-block id", () => {
    const a = cand(10, 0, SENTINEL, "mono1aaa", "5");
    const aId = incomingTransferId(a.anchor, "mono1aaa", "5", 0);
    const wm: IncomingWatermark = { blockHeight: 10, txIndex: 0, logIndex: SENTINEL, blockIds: [aId] };
    const b = cand(10, 0, SENTINEL, "mono1bbb", "7");
    const bId = incomingTransferId(b.anchor, "mono1bbb", "7", 0);
    const plan = planIncomingNotifications(wm, [a, b]);
    expect(plan.toRecord.map((c) => c.id)).toEqual([bId]); // a accounted, b new
    expect(plan.newWatermark?.blockIds).toEqual(expect.arrayContaining([aId, bId]));
  });
});
