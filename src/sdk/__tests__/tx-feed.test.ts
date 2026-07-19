// The indexer-off fallback feed.
//
// This view is structurally partial — it can only ever show native transfers.
// The mapper is therefore conservative by design: anything it cannot represent
// faithfully is DROPPED rather than mislabelled, because a delegation rendered
// as "Outgoing transfer" would be a fabricated claim about what happened.

import { describe, expect, it } from "vitest";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import {
  canonicalTypedAddress,
  hasEmptyCalldata,
  isPositiveValue,
  mapTxFeedToRows,
  txFeedFallbackEnabled,
  NATIVE_TRANSFER_LOG_INDEX,
  TXFEED_DISCLOSURE,
} from "../tx-feed";

const WALLET_HEX = "0x" + "aa".repeat(20);
const PEER_HEX = "0x" + "bb".repeat(20);
const WALLET = addressToTypedBech32("user", WALLET_HEX);
const PEER = addressToTypedBech32("user", PEER_HEX);

function entry(over: Record<string, unknown> = {}) {
  return {
    txHash: "0xdead",
    blockNumber: 100,
    blockTimestamp: 1_700_000_000,
    txIndex: 3,
    from: WALLET,
    to: PEER_HEX, // the live feed renders `to` as raw hex
    value: "1000000000000000000",
    input: "0x",
    ...over,
  };
}

describe("hasEmptyCalldata — tolerant of every 'empty' shape", () => {
  it("accepts absent, 0x, empty string and empty array", () => {
    for (const v of [undefined, null, "0x", "0X", "", "  ", []]) {
      expect(hasEmptyCalldata(v)).toBe(true);
    }
  });

  it("rejects real calldata", () => {
    expect(hasEmptyCalldata("0xa9059cbb")).toBe(false);
    expect(hasEmptyCalldata([1, 2])).toBe(false);
    expect(hasEmptyCalldata(7)).toBe(false);
  });
});

describe("isPositiveValue — unreadable is NOT positive (fail-safe)", () => {
  it("accepts positive decimal, hex, number and bigint", () => {
    expect(isPositiveValue("1")).toBe(true);
    expect(isPositiveValue("0x10")).toBe(true);
    expect(isPositiveValue(5)).toBe(true);
    expect(isPositiveValue(5n)).toBe(true);
  });

  it("rejects zero, negatives and junk", () => {
    for (const v of ["0", "0x0", 0, 0n, -1, "abc", "", null, undefined, {}]) {
      expect(isPositiveValue(v)).toBe(false);
    }
  });
});

describe("canonicalTypedAddress", () => {
  it("converts raw 0x hex to typed bech32m, case-insensitively", () => {
    expect(canonicalTypedAddress(PEER_HEX)).toBe(PEER);
    expect(canonicalTypedAddress(PEER_HEX.toUpperCase())).toBe(PEER);
  });

  it("round-trips an already-typed address", () => {
    expect(canonicalTypedAddress(WALLET)).toBe(WALLET.toLowerCase());
  });

  it("returns null for anything it cannot verify", () => {
    for (const v of ["not-an-address", "0xzz", "", "   ", null, 7, {}]) {
      expect(canonicalTypedAddress(v)).toBeNull();
    }
  });
});

describe("mapTxFeedToRows — conservative by design", () => {
  it("maps an outgoing native transfer", () => {
    const [row] = mapTxFeedToRows([entry()], WALLET);
    expect(row).toMatchObject({
      direction: "out",
      counterparty: PEER,
      kind: "transfer",
      txIndex: 3,
      logIndex: NATIVE_TRANSFER_LOG_INDEX,
      txHash: "0xdead",
    });
    expect(row!.blockHeight).toBe(100n);
    expect(row!.blockTimestampSeconds).toBe(1_700_000_000n);
  });

  it("maps an incoming native transfer", () => {
    const [row] = mapTxFeedToRows([entry({ from: PEER_HEX, to: WALLET })], WALLET);
    expect(row).toMatchObject({ direction: "in", counterparty: PEER });
  });

  it("matches a raw-0x `to` against a typed wallet, case-insensitively", () => {
    const rows = mapTxFeedToRows([entry({ from: PEER, to: WALLET_HEX.toUpperCase() })], WALLET);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe("in");
  });

  it("maps a SELF-SEND to a single out leg", () => {
    const rows = mapTxFeedToRows([entry({ from: WALLET, to: WALLET_HEX })], WALLET);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe("out");
  });

  it("DROPS a contract call rather than mislabelling it", () => {
    // This is where a delegation would land — it must not become "transfer".
    expect(mapTxFeedToRows([entry({ input: "0xa9059cbb" })], WALLET)).toEqual([]);
  });

  it("DROPS a zero-value tx", () => {
    expect(mapTxFeedToRows([entry({ value: "0" })], WALLET)).toEqual([]);
    expect(mapTxFeedToRows([entry({ value: "0x0" })], WALLET)).toEqual([]);
  });

  it("DROPS a third party's tx", () => {
    expect(mapTxFeedToRows([entry({ from: PEER, to: PEER_HEX })], WALLET)).toEqual([]);
  });

  it("DROPS a row whose counterparty cannot be canonicalised", () => {
    // Rendering an unverifiable address would be worse than omitting the row.
    expect(mapTxFeedToRows([entry({ to: "garbage" })], WALLET)).toEqual([]);
  });

  it("DROPS a malformed entry without throwing", () => {
    const rows = mapTxFeedToRows(
      [null, 7, "x", {}, entry({ blockNumber: "nope" }), entry({ txIndex: -1 }), entry()],
      WALLET,
    );
    expect(rows).toHaveLength(1);
  });

  it("tolerates an absent timestamp", () => {
    const [row] = mapTxFeedToRows([entry({ blockTimestamp: null })], WALLET);
    expect(row!.blockTimestampSeconds).toBeNull();
  });

  it("keeps the real tx hash, or null — never synthesized", () => {
    expect(mapTxFeedToRows([entry({ txHash: "" })], WALLET)[0]!.txHash).toBeNull();
    expect(mapTxFeedToRows([entry({ txHash: 7 })], WALLET)[0]!.txHash).toBeNull();
  });

  it("returns [] for a non-array or an unusable wallet", () => {
    expect(mapTxFeedToRows(null, WALLET)).toEqual([]);
    expect(mapTxFeedToRows([entry()], "not-an-address")).toEqual([]);
  });
});

describe("txFeedFallbackEnabled — the full trigger table", () => {
  const base = {
    confirmedCount: 0,
    failedCount: 0,
    liveReadErrored: false,
    coverageKind: "indexer_disabled" as const,
  };

  it("fires for indexer_disabled with an empty feed", () => {
    expect(txFeedFallbackEnabled(base)).toBe(true);
  });

  it("fires for not_found with an empty feed", () => {
    expect(txFeedFallbackEnabled({ ...base, coverageKind: "not_found" })).toBe(true);
  });

  it("does NOT fire when confirmed rows exist", () => {
    expect(txFeedFallbackEnabled({ ...base, confirmedCount: 1 })).toBe(false);
  });

  it("does NOT fire when failed records exist", () => {
    expect(txFeedFallbackEnabled({ ...base, failedCount: 1 })).toBe(false);
  });

  it("does NOT fire when the live read ERRORED (the error band wins)", () => {
    // The most important row: a fallback over an error would present a partial
    // view as the whole answer.
    expect(txFeedFallbackEnabled({ ...base, liveReadErrored: true })).toBe(false);
  });

  it("does NOT fire while the coverage probe is unresolved", () => {
    expect(txFeedFallbackEnabled({ ...base, coverageKind: null })).toBe(false);
  });

  it("does NOT fire for pruned / private / unknown — each keeps its own state", () => {
    for (const kind of ["pruned", "private", "unknown", "found"] as const) {
      expect(txFeedFallbackEnabled({ ...base, coverageKind: kind })).toBe(false);
    }
  });
});

describe("the disclosure names what is absent", () => {
  it("is the verbatim string, and says which kinds cannot appear", () => {
    expect(TXFEED_DISCLOSURE).toBe(
      "Indexer off — showing native LYTH transfers from the public transaction feed. Delegations, claims, and token activity can't be listed here.",
    );
    expect(TXFEED_DISCLOSURE).toContain("Delegations, claims, and token activity");
  });
});
