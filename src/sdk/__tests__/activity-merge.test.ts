import { describe, expect, it } from "vitest";
import { mergeActivityNewestFirst } from "../activity-rows";
import type { LiveAddressActivityRow } from "../live";
import type { NotificationRecord } from "../notifications";
import type { PendingTx } from "../pending-tx";

function pending(txHash: string, submittedAt: number): PendingTx {
  return {
    txHash,
    chainIdHex: "0x10f2c",
    addressLower: "mono1self",
    opKind: "send",
    amountDecimal: "1",
    counterparty: "mono1to",
    submittedAt,
  };
}

function confirmed(blockHeight: bigint, ts: bigint | null): LiveAddressActivityRow {
  return {
    blockHeight,
    txIndex: 0,
    logIndex: 0,
    kind: "transfer",
    direction: "out",
    counterparty: "mono1to",
    tokenId: null,
    amount: "1",
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: ts,
    txHash: null,
    clusterName: null,
  };
}

function failed(id: string, blockNumber: number | null, createdAtMs: number): NotificationRecord {
  return {
    id,
    txHash: id,
    status: "failed",
    blockNumber,
    kind: "send",
    amountDecimal: "1",
    counterparty: "mono1to",
    createdAtMs,
    read: false,
    schemaVersion: 0,
  };
}

describe("mergeActivityNewestFirst", () => {
  it("floats unanchored pending rows to the top, newest ms first", () => {
    const merged = mergeActivityNewestFirst(
      [pending("0xa", 100), pending("0xb", 200)],
      [confirmed(50n, 5n)],
      [],
    );
    expect(merged.map((m) => m.tag)).toEqual(["pending", "pending", "confirmed"]);
    const first = merged[0]!;
    const second = merged[1]!;
    expect(first.tag === "pending" ? first.tx.txHash : null).toBe("0xb");
    expect(second.tag === "pending" ? second.tx.txHash : null).toBe("0xa");
  });

  it("orders confirmed rows by block height descending", () => {
    const merged = mergeActivityNewestFirst(
      [],
      [confirmed(10n, null), confirmed(30n, null), confirmed(20n, null)],
      [],
    );
    const blocks = merged.map((m) =>
      m.tag === "confirmed" ? Number(m.row.blockHeight) : -1,
    );
    expect(blocks).toEqual([30, 20, 10]);
  });

  it("interleaves a failed row by its block height (not pinned)", () => {
    const merged = mergeActivityNewestFirst(
      [],
      [confirmed(30n, null), confirmed(10n, null)],
      [failed("0xf", 20, 1)],
    );
    expect(merged.map((m) => m.tag)).toEqual(["confirmed", "failed", "confirmed"]);
  });

  it("never NaNs when several items share an Infinity block", () => {
    const merged = mergeActivityNewestFirst(
      [pending("0xa", 1), pending("0xb", 3)],
      [],
      [failed("0xf", null, 2)],
    );
    const ms = merged.map((m) =>
      m.tag === "pending"
        ? m.tx.submittedAt
        : m.tag === "failed"
          ? m.record.createdAtMs
          : 0,
    );
    expect(ms).toEqual([3, 2, 1]);
  });
});

function bridgedPending(
  txHash: string,
  submittedAt: number,
  block: number,
  txIndex: number,
): PendingTx {
  return {
    ...pending(txHash, submittedAt),
    confirmedBlockHeight: block,
    confirmedTxIndex: txIndex,
  };
}

function confirmedAt(blockHeight: bigint, txIndex: number): LiveAddressActivityRow {
  return { ...confirmed(blockHeight, null), txIndex };
}

describe("mergeActivityNewestFirst — receipt bridge (no duplicate, no drop)", () => {
  it("receipt BEFORE the indexer: the bridged row stays visible at its block (no drop)", () => {
    const merged = mergeActivityNewestFirst(
      [bridgedPending("0xb", 100, 7, 0)],
      [confirmedAt(5n, 0)], // no canonical row at (7,0) yet
      [],
    );
    // The bridged row is present (no drop) and interleaves at block 7 (above 5).
    expect(merged.map((m) => m.tag)).toEqual(["pending", "confirmed"]);
    const first = merged[0]!;
    expect(first.tag === "pending" ? first.tx.txHash : null).toBe("0xb");
  });

  it("receipt AFTER the indexer: the bridged twin is suppressed (no duplicate)", () => {
    const merged = mergeActivityNewestFirst(
      [bridgedPending("0xb", 100, 7, 0)],
      [confirmedAt(7n, 0)], // canonical row at the same slot has surfaced
      [],
    );
    expect(merged.map((m) => m.tag)).toEqual(["confirmed"]); // only one, not two
  });

  it("a non-bridged pending floats to the top; a bridged one interleaves by block", () => {
    const merged = mergeActivityNewestFirst(
      [pending("0xp", 100), bridgedPending("0xb", 200, 6, 0)],
      [confirmedAt(8n, 0)],
      [],
    );
    const shape = merged.map((m) =>
      m.tag === "pending"
        ? m.tx.txHash
        : m.tag === "confirmed"
          ? `c${Number(m.row.blockHeight)}`
          : "f",
    );
    expect(shape).toEqual(["0xp", "c8", "0xb"]);
  });
});
