import { describe, expect, it } from "vitest";
import {
  PENDING_TX_STORE_KEY,
  PENDING_TX_WINDOW_MS,
  asPendingTx,
  classifyPending,
  isPendingExpired,
  parsePendingTxEnvelope,
  pendingTxIndex,
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
  it("confirms on lyth_txStatus=found, carrying the block number", () => {
    const v = classifyPending(
      probe({ txStatus: { kind: "found", blockNumber: 4242 } }),
    );
    expect(v.kind).toBe("confirmed");
    expect(v.kind === "confirmed" && v.blockNumber).toBe(4242);
  });

  it("confirms on found even when the block number is absent (null)", () => {
    const v = classifyPending(
      probe({ txStatus: { kind: "found", blockNumber: null } }),
    );
    expect(v.kind).toBe("confirmed");
    expect(v.kind === "confirmed" && v.blockNumber).toBeNull();
  });

  it("confirms on a receipt status===1 when txStatus has not surfaced yet", () => {
    const v = classifyPending(
      probe({
        txStatus: { kind: "not_found" },
        receipt: { kind: "receipt", status: 1, blockNumber: 99 },
      }),
    );
    expect(v.kind).toBe("confirmed");
    expect(v.kind === "confirmed" && v.blockNumber).toBe(99);
  });

  it("FAILS on a receipt status===0 (the reverted-tx path the old poll never reached)", () => {
    const v = classifyPending(
      probe({
        txStatus: { kind: "not_found" },
        receipt: { kind: "receipt", status: 0, blockNumber: 7 },
      }),
    );
    expect(v.kind).toBe("failed");
    expect(v.kind === "failed" && v.blockNumber).toBe(7);
  });

  it("found short-circuits a (hypothetical) reverted receipt — indexer inclusion wins", () => {
    // The probe never fetches a receipt once txStatus=found (receipt:skipped),
    // but even if both were present, found must classify as confirmed.
    const v = classifyPending({
      txStatus: { kind: "found", blockNumber: 5 },
      receipt: { kind: "receipt", status: 0, blockNumber: 5 },
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
        probe({ receipt: { kind: "receipt", status: 2, blockNumber: 1 } }),
      ).kind,
    ).toBe("pending");
  });
});

describe("isPendingExpired — tracking window", () => {
  it("is false inside the window", () => {
    const base = tx({ submittedAt: 1_000 });
    expect(isPendingExpired(base, 1_000)).toBe(false);
    expect(isPendingExpired(base, 1_000 + PENDING_TX_WINDOW_MS - 1)).toBe(false);
  });

  it("is true at and past the window edge", () => {
    const base = tx({ submittedAt: 1_000 });
    expect(isPendingExpired(base, 1_000 + PENDING_TX_WINDOW_MS)).toBe(true);
    expect(isPendingExpired(base, 1_000 + PENDING_TX_WINDOW_MS + 10_000)).toBe(
      true,
    );
  });

  it("honors a caller-supplied window override", () => {
    const base = tx({ submittedAt: 0 });
    expect(isPendingExpired(base, 50, 100)).toBe(false);
    expect(isPendingExpired(base, 100, 100)).toBe(true);
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
