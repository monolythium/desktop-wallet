import { describe, expect, it } from "vitest";
import {
  PENDING_ABSOLUTE_CAP_MS,
  PENDING_DROP_GRACE_MS,
  PENDING_SLOW_MS,
  PENDING_TERMINAL_RETAIN_MS,
  PENDING_TX_STORE_KEY,
  asPendingTx,
  classifyPending,
  classifyStalePending,
  parsePendingTxEnvelope,
  pendingLifecycleNote,
  pendingTxIndex,
  scopePendingTxs,
  transitionPending,
  type ChainProbe,
  type PendingTx,
} from "../pending-tx";

function tx(over: Partial<PendingTx> = {}): PendingTx {
  return {
    txHash: "0xabc",
    chainIdHex: "0x10f2c",
    addressLower: "mono1self",
    opKind: "send",
    amountDecimal: "1.00",
    counterparty: "mono1to",
    submittedAt: 1_700_000_000_000,
    ...over,
  };
}

function probe(over: Partial<ChainProbe> = {}): ChainProbe {
  return {
    txStatus: { kind: "not_found" },
    receipt: { kind: "null" },
    ...over,
  };
}

describe("classifyPending — terminal detection (status fidelity)", () => {
  it("confirms on lyth_txStatus=found, carrying the inclusion slot (block + txIndex)", () => {
    const v = classifyPending(
      probe({ txStatus: { kind: "found", blockNumber: 4242, txIndex: 7 } }),
    );
    expect(v.kind).toBe("confirmed");
    expect(v.kind === "confirmed" && v.blockNumber).toBe(4242);
    expect(v.kind === "confirmed" && v.txIndex).toBe(7);
  });

  it("confirms on found even when block/txIndex are absent (null)", () => {
    const v = classifyPending(
      probe({ txStatus: { kind: "found", blockNumber: null, txIndex: null } }),
    );
    expect(v.kind).toBe("confirmed");
    expect(v.kind === "confirmed" && v.blockNumber).toBeNull();
    expect(v.kind === "confirmed" && v.txIndex).toBeNull();
  });

  it("confirms on a receipt status===1 (with its slot) when txStatus has not surfaced", () => {
    const v = classifyPending(
      probe({
        txStatus: { kind: "not_found" },
        receipt: { kind: "receipt", status: 1, blockNumber: 99, txIndex: 3 },
      }),
    );
    expect(v.kind).toBe("confirmed");
    expect(v.kind === "confirmed" && v.blockNumber).toBe(99);
    expect(v.kind === "confirmed" && v.txIndex).toBe(3);
  });

  it("FAILS on a receipt status===0 (the reverted-tx path the old poll never reached)", () => {
    const v = classifyPending(
      probe({
        txStatus: { kind: "not_found" },
        receipt: { kind: "receipt", status: 0, blockNumber: 7, txIndex: 0 },
      }),
    );
    expect(v.kind).toBe("failed");
    expect(v.kind === "failed" && v.blockNumber).toBe(7);
  });

  it("found short-circuits a (hypothetical) reverted receipt — indexer inclusion wins", () => {
    const v = classifyPending({
      txStatus: { kind: "found", blockNumber: 5, txIndex: 1 },
      receipt: { kind: "receipt", status: 0, blockNumber: 5, txIndex: 1 },
    });
    expect(v.kind).toBe("confirmed");
  });
});

describe("classifyPending — never synthesizes a verdict (keeps pending)", () => {
  it("stays pending on not_found + null receipt", () => {
    expect(classifyPending(probe()).kind).toBe("pending");
  });

  it("stays pending when both RPCs threw", () => {
    expect(
      classifyPending(
        probe({ txStatus: { kind: "throw" }, receipt: { kind: "throw" } }),
      ).kind,
    ).toBe("pending");
  });

  it("stays pending on a skipped receipt with a non-found txStatus", () => {
    expect(
      classifyPending(
        probe({ txStatus: { kind: "not_found" }, receipt: { kind: "skipped" } }),
      ).kind,
    ).toBe("pending");
  });

  it("stays pending on an unparseable receipt status bit (neither 0 nor 1)", () => {
    expect(
      classifyPending(
        probe({ receipt: { kind: "receipt", status: 2, blockNumber: 1, txIndex: 0 } }),
      ).kind,
    ).toBe("pending");
  });
});

describe("classifyStalePending — time-based lifecycle (no committed nonce)", () => {
  const base = tx({ submittedAt: 1_000_000 });

  it("is pending inside the slow threshold", () => {
    expect(classifyStalePending(base, null, 1_000_000)).toBe("pending");
    expect(classifyStalePending(base, null, 1_000_000 + PENDING_SLOW_MS - 1)).toBe("pending");
  });

  it("is slow from the slow threshold up to the absolute cap", () => {
    expect(classifyStalePending(base, null, 1_000_000 + PENDING_SLOW_MS)).toBe("slow");
    expect(classifyStalePending(base, null, 1_000_000 + PENDING_ABSOLUTE_CAP_MS - 1)).toBe("slow");
  });

  it("is expired at and past the absolute cap", () => {
    expect(classifyStalePending(base, null, 1_000_000 + PENDING_ABSOLUTE_CAP_MS)).toBe("expired");
  });
});

describe("classifyStalePending — nonce-based dropped detection", () => {
  const T0 = 1_000_000;
  // nonce 5, young enough that the time-based path alone would be "pending".
  const young = tx({ submittedAt: T0, nonce: 5 });

  it("stays on the time-based path when the committed nonce has NOT passed", () => {
    expect(classifyStalePending(young, 5, T0 + 1)).toBe("pending"); // committed == nonce
    expect(classifyStalePending(young, 4, T0 + 1)).toBe("pending"); // committed < nonce
  });

  it("is slow within the drop grace once the committed nonce passes", () => {
    // First observation (noncePassedAtMs unset) anchors the grace at `now`.
    expect(classifyStalePending(young, 6, T0 + 1)).toBe("slow");
    const stamped = tx({ submittedAt: T0, nonce: 5, noncePassedAtMs: T0 });
    expect(classifyStalePending(stamped, 6, T0 + PENDING_DROP_GRACE_MS - 1)).toBe("slow");
  });

  it("is dropped once the drop grace elapses after the nonce passed", () => {
    const stamped = tx({ submittedAt: T0, nonce: 5, noncePassedAtMs: T0 });
    expect(classifyStalePending(stamped, 6, T0 + PENDING_DROP_GRACE_MS)).toBe("dropped");
  });

  it("a null committed-nonce read never drops, and never un-drops a dropped row", () => {
    expect(classifyStalePending(young, null, T0 + 1)).toBe("pending"); // never advances to dropped
    const droppedRow = tx({ submittedAt: T0, nonce: 5, noncePassedAtMs: T0, lifecycle: "dropped" });
    expect(classifyStalePending(droppedRow, null, T0 + PENDING_DROP_GRACE_MS * 100)).toBe("dropped");
  });

  it("a real read showing the nonce NOT passed un-drops a dropped row", () => {
    const droppedRow = tx({ submittedAt: T0, nonce: 5, noncePassedAtMs: T0, lifecycle: "dropped" });
    expect(classifyStalePending(droppedRow, 5, T0 + 1)).toBe("pending"); // back to time-based
  });

  it("falls back to time-based when the tx carries no captured nonce", () => {
    const noNonce = tx({ submittedAt: T0 });
    expect(classifyStalePending(noNonce, 999, T0 + 1)).toBe("pending");
  });
});

describe("transitionPending — relabel + bounded terminal removal", () => {
  const NO_NONCES = new Map<string, number | null>();

  it("stamps the lifecycle and flags changed when it moves", () => {
    const { next, changed } = transitionPending(
      [tx({ submittedAt: 1_000_000 })],
      NO_NONCES,
      1_000_000 + PENDING_SLOW_MS,
    );
    expect(changed).toBe(true);
    expect(next[0]!.lifecycle).toBe("slow");
  });

  it("never removes a pending or slow row", () => {
    const { next } = transitionPending(
      [tx({ submittedAt: 1_000_000 })],
      NO_NONCES,
      1_000_000 + PENDING_SLOW_MS, // slow, not terminal
    );
    expect(next).toHaveLength(1);
  });

  it("keeps an expired row visible until the retention window, then removes it", () => {
    const kept = transitionPending([tx({ submittedAt: 0 })], NO_NONCES, PENDING_ABSOLUTE_CAP_MS);
    expect(kept.next).toHaveLength(1);
    expect(kept.next[0]!.lifecycle).toBe("expired");

    const removed = transitionPending(
      [tx({ submittedAt: 0, lifecycle: "expired" })],
      NO_NONCES,
      PENDING_TERMINAL_RETAIN_MS,
    );
    expect(removed.next).toHaveLength(0);
    expect(removed.changed).toBe(true);
  });

  it("is a no-op (changed=false) when every lifecycle is already current", () => {
    const slow = tx({ submittedAt: 1_000_000, lifecycle: "slow" });
    expect(transitionPending([slow], NO_NONCES, 1_000_000 + PENDING_SLOW_MS).changed).toBe(false);
  });

  it("passes a BRIDGED row through untouched — never relabels or removes it", () => {
    // Bridged + far past every time threshold: it must stay exactly as-is (the
    // feed retires it once the canonical confirmed row surfaces).
    const bridged = tx({
      submittedAt: 0,
      lifecycle: "pending",
      confirmedBlockHeight: 5,
      confirmedTxIndex: 0,
    });
    const out = transitionPending([bridged], NO_NONCES, PENDING_TERMINAL_RETAIN_MS * 10);
    expect(out.next).toHaveLength(1);
    expect(out.next[0]).toBe(bridged); // same reference — untouched
    expect(out.changed).toBe(false);
  });

  it("stamps noncePassedAtMs and moves to slow the first tick the committed nonce passes", () => {
    const now = 2_000_000;
    // Young (age 1s < slow), so a move to slow can only come from the nonce path.
    const row = tx({ submittedAt: now - 1_000, nonce: 5 });
    const nonces = new Map<string, number | null>([["mono1self", 6]]);
    const { next, changed } = transitionPending([row], nonces, now);
    expect(changed).toBe(true);
    expect(next[0]!.noncePassedAtMs).toBe(now);
    expect(next[0]!.lifecycle).toBe("slow"); // within grace this first tick
  });

  it("moves a nonce-passed row to dropped once the grace elapses", () => {
    const now = 2_000_000;
    const row = tx({
      submittedAt: now - 1_000, // young: time-based alone would be pending
      nonce: 5,
      noncePassedAtMs: now - PENDING_DROP_GRACE_MS,
    });
    const nonces = new Map<string, number | null>([["mono1self", 6]]);
    const { next } = transitionPending([row], nonces, now);
    expect(next).toHaveLength(1); // dropped but retained (well within retention)
    expect(next[0]!.lifecycle).toBe("dropped");
  });
});

describe("pendingLifecycleNote", () => {
  it("maps each lifecycle to its eyebrow note", () => {
    expect(pendingLifecycleNote("pending")).toBe("in flight");
    expect(pendingLifecycleNote("slow")).toBe("taking longer than usual");
    expect(pendingLifecycleNote("dropped")).toBe("didn't confirm");
    expect(pendingLifecycleNote("expired")).toBe("status unknown");
  });
});

describe("pendingTxIndex — dedupe key (chainIdHex, txHash)", () => {
  const set = [
    tx({ txHash: "0x1", chainIdHex: "0xa" }),
    tx({ txHash: "0x2", chainIdHex: "0xa" }),
  ];

  it("finds an existing tracked tx", () => {
    expect(pendingTxIndex(set, "0xa", "0x2")).toBe(1);
  });

  it("returns -1 for an untracked hash", () => {
    expect(pendingTxIndex(set, "0xa", "0x9")).toBe(-1);
  });

  it("treats the same hash on a different chain as distinct", () => {
    expect(pendingTxIndex(set, "0xb", "0x1")).toBe(-1);
  });
});

describe("parsers — tolerant of malformed persisted data", () => {
  it("round-trips a valid row", () => {
    expect(asPendingTx(tx())).toEqual(tx());
  });

  it("round-trips the bridge fields and tolerates their absence", () => {
    const withBridge = asPendingTx({ ...tx(), confirmedBlockHeight: 5, confirmedTxIndex: 2 });
    expect(withBridge?.confirmedBlockHeight).toBe(5);
    expect(withBridge?.confirmedTxIndex).toBe(2);
    expect(asPendingTx(tx())?.confirmedBlockHeight).toBeUndefined();
  });

  it("rejects rows missing required fields", () => {
    expect(asPendingTx({ txHash: "0x1" })).toBeNull();
    expect(asPendingTx(null)).toBeNull();
    expect(asPendingTx({ ...tx(), submittedAt: "soon" })).toBeNull();
  });

  it("parses an envelope, dropping malformed rows", () => {
    const env = parsePendingTxEnvelope({
      schemaVersion: 0,
      txs: [tx({ txHash: "0x1" }), { junk: true }, tx({ txHash: "0x2" })],
    });
    expect(env?.txs.map((t) => t.txHash)).toEqual(["0x1", "0x2"]);
  });

  it("rejects a wrong-schema envelope", () => {
    expect(parsePendingTxEnvelope({ schemaVersion: 9, txs: [] })).toBeNull();
    expect(parsePendingTxEnvelope({ txs: "nope" })).toBeNull();
    expect(parsePendingTxEnvelope(null)).toBeNull();
  });
});

describe("store key", () => {
  it("is the stable single-file key", () => {
    expect(PENDING_TX_STORE_KEY).toBe("mono.pending-tx.v1");
  });
});

describe("scopePendingTxs — cross-vault isolation", () => {
  const a = tx({ txHash: "0xa", addressLower: "mono1aaa" });
  const b = tx({ txHash: "0xb", addressLower: "mono1bbb" });
  const a2 = tx({ txHash: "0xa2", addressLower: "mono1aaa" });

  it("returns only the active wallet's tracked txs", () => {
    const scoped = scopePendingTxs([a, b, a2], "mono1aaa");
    expect(scoped.map((t) => t.txHash)).toEqual(["0xa", "0xa2"]);
  });

  it("never leaks another vault's in-flight tx into the active feed", () => {
    // The exact leak this closes: vault B is active, vault A has an in-flight
    // tx; A's row must not appear.
    expect(scopePendingTxs([a, a2], "mono1bbb")).toEqual([]);
  });

  it("matches address case-insensitively", () => {
    const upper = tx({ txHash: "0xu", addressLower: "MONO1AAA" });
    expect(scopePendingTxs([upper], "mono1aaa").map((t) => t.txHash)).toEqual(["0xu"]);
  });

  it("matches nothing when no wallet is ready (empty scope)", () => {
    expect(scopePendingTxs([a, b], "")).toEqual([]);
  });
});
