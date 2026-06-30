import { describe, expect, it } from "vitest";
import {
  incomingCandidatesFromRows,
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

function cand(b: number, t: number, l: number): IncomingCandidate {
  return { anchor: { blockHeight: b, txIndex: t, logIndex: l }, amountDecimal: "1", counterparty: "x" };
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
  it("first run baselines to the newest anchor and records nothing", () => {
    const plan = planIncomingNotifications(null, [cand(5, 0, 0), cand(7, 1, 0)]);
    expect(plan.toRecord).toHaveLength(0);
    expect(plan.baseline).toEqual({ blockHeight: 7, txIndex: 1, logIndex: 0 });
    expect(plan.newWatermark).toBeNull();
  });

  it("records only candidates strictly after the watermark, oldest first", () => {
    const wm: IncomingWatermark = { blockHeight: 5, txIndex: 0, logIndex: 0 };
    const plan = planIncomingNotifications(wm, [cand(5, 0, 0), cand(6, 0, 0), cand(7, 0, 0)]);
    expect(plan.toRecord.map((c) => c.anchor.blockHeight)).toEqual([6, 7]);
    expect(plan.newWatermark).toEqual({ blockHeight: 7, txIndex: 0, logIndex: 0 });
  });

  it("records nothing when the watermark already covers the newest anchor", () => {
    const wm: IncomingWatermark = { blockHeight: 7, txIndex: 0, logIndex: 0 };
    const plan = planIncomingNotifications(wm, [cand(5, 0, 0), cand(7, 0, 0)]);
    expect(plan.toRecord).toHaveLength(0);
    expect(plan.newWatermark).toBeNull();
  });

  it("is a no-op when there are no candidates", () => {
    expect(planIncomingNotifications(null, [])).toEqual({
      baseline: null,
      toRecord: [],
      newWatermark: null,
    });
  });
});
