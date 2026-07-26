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

describe("incomingCandidatesFromRows — an arrival from oneself is not an arrival", () => {
  // The chain serves a self-transfer as two rows, and the inbound one is a real
  // `direction: "in"` row. Announcing it tells the user they received money they
  // sent themselves.
  const SELF = "mono1selfaddress";

  it("suppresses the inbound leg of a self-transfer", () => {
    const c = incomingCandidatesFromRows([row({ direction: "in", counterparty: SELF })], SELF);
    expect(c).toHaveLength(0);
  });

  it("still announces a genuine arrival from someone else", () => {
    const c = incomingCandidatesFromRows([row({ direction: "in", counterparty: "mono1someoneelse" })], SELF);
    expect(c).toHaveLength(1);
  });

  it("matches regardless of case — bech32m is case-insensitive", () => {
    // Normalising can never make two DIFFERENT addresses equal, so this cannot
    // silence a real arrival; it only stops a case variant slipping through.
    const c = incomingCandidatesFromRows([row({ direction: "in", counterparty: SELF.toUpperCase() })], SELF);
    expect(c).toHaveLength(0);
  });
});

describe("incomingCandidatesFromRows — FAIL DIRECTION: every doubt must NOTIFY", () => {
  // A spurious notification is an annoyance. A silenced real one is invisible:
  // there is no chain signal for it and nothing downstream surfaces it, so the
  // user simply never learns money arrived. Every uncertain input must notify.
  const SELF = "mono1selfaddress";

  it("notifies when the wallet's own address is not supplied at all", () => {
    expect(incomingCandidatesFromRows([row({ direction: "in", counterparty: SELF })])).toHaveLength(1);
  });

  it("notifies when the own address is null, undefined or blank", () => {
    for (const own of [null, undefined, "", "   "]) {
      const c = incomingCandidatesFromRows([row({ direction: "in", counterparty: SELF })], own);
      expect(c, `own=${JSON.stringify(own)} must not suppress`).toHaveLength(1);
    }
  });

  it("notifies when the row carries no counterparty to compare", () => {
    for (const cp of [null, "", "   "]) {
      const c = incomingCandidatesFromRows([row({ direction: "in", counterparty: cp })], SELF);
      expect(c, `counterparty=${JSON.stringify(cp)} must not suppress`).toHaveLength(1);
    }
  });

  it("notifies when the counterparty is not a string at all", () => {
    // The row shape is decoded from an untrusted wire payload; a non-string here
    // is a comparison we cannot make, not a self-transfer.
    const bad = { ...row({ direction: "in" }), counterparty: 42 as unknown as string };
    expect(incomingCandidatesFromRows([bad], SELF)).toHaveLength(1);
  });

  it("notifies for an own-address that is not a usable string, even a hostile one", () => {
    // Guards the suppressing branch against a value that only looks string-like.
    // It must be rejected outright, never coerced into a comparison.
    const hostile = { toLowerCase() { throw new Error("boom"); }, trim() { throw new Error("boom"); } };
    const c = incomingCandidatesFromRows(
      [row({ direction: "in", counterparty: SELF })],
      hostile as unknown as string,
    );
    expect(c).toHaveLength(1);
  });
});

describe("planIncomingNotifications", () => {
  it("first run with a SMALL receive set notifies them all (fresh-wallet fix)", () => {
    // A fresh / newly-migrated wallet's genuine recent arrivals — record +
    // notify (oldest-first) and advance the watermark to the newest (carrying
    // its block's accounted ids), instead of silently baselining and swallowing
    // the first incoming as history.
    const plan = planIncomingNotifications(null, [cand(7, 1, 0), cand(5, 0, 0)]);
    expect(plan.baseline).toBeNull();
    expect(plan.toRecord.map((c) => c.anchor.blockHeight)).toEqual([5, 7]);
    expect(plan.newWatermark).toEqual({
      blockHeight: 7,
      txIndex: 1,
      logIndex: 0,
      blockIds: ["in:7.1.0:x:1:0"],
    });
  });

  it("first run with a LARGE receive history only baselines — no toast-storm", () => {
    // > INCOMING_FIRST_RUN_NOTIFY_CAP (10): an established / imported wallet —
    // baseline to the newest anchor silently (seeding its blockIds) so the whole
    // history never dumps into notifications on first use.
    const history = Array.from({ length: 11 }, (_, i) => cand(200 - i, 0, 0));
    const plan = planIncomingNotifications(null, history);
    expect(plan.toRecord).toHaveLength(0);
    expect(plan.baseline).toEqual({
      blockHeight: 200,
      txIndex: 0,
      logIndex: 0,
      blockIds: ["in:200.0.0:x:1:0"],
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
