import { describe, expect, it } from "vitest";
import type { LiveAddressActivityRow } from "../live";
import {
  activityCounterparty,
  activityDirection,
  activityKindToTxKind,
  activityRowToTx,
  activityWhen,
  parseActivityAmount,
} from "../activity-rows";

function row(partial: Partial<LiveAddressActivityRow>): LiveAddressActivityRow {
  return {
    blockHeight: 1000n,
    txIndex: 2,
    logIndex: 0,
    kind: "transfer",
    direction: "out",
    counterparty: "mono1cccccccccccccccccccccccccccccccccccccc",
    tokenId: null,
    amount: "12.5",
    cluster: null,
    weightBps: null,
    subKind: null,
    ...partial,
  };
}

describe("activityKindToTxKind", () => {
  it("recognises reward and delegation/stake families, else transfer", () => {
    expect(activityKindToTxKind("reward")).toBe("reward");
    expect(activityKindToTxKind("staking-reward")).toBe("reward");
    expect(activityKindToTxKind("delegation")).toBe("stake");
    expect(activityKindToTxKind("undelegate")).toBe("stake");
    expect(activityKindToTxKind("stake")).toBe("stake");
    expect(activityKindToTxKind("transfer")).toBe("transfer");
    expect(activityKindToTxKind("anything-else")).toBe("transfer");
  });
});

describe("activityDirection", () => {
  it("maps in/out and defaults null to out", () => {
    expect(activityDirection("in")).toBe("in");
    expect(activityDirection("out")).toBe("out");
    expect(activityDirection(null)).toBe("out");
    expect(activityDirection("weird")).toBe("out");
  });
});

describe("parseActivityAmount", () => {
  it("parses decimals and thousands separators", () => {
    expect(parseActivityAmount("12.5")).toBe(12.5);
    expect(parseActivityAmount("1,000")).toBe(1000);
  });

  it("returns null (not 0) for missing / empty / non-numeric amounts", () => {
    expect(parseActivityAmount(null)).toBeNull();
    expect(parseActivityAmount("")).toBeNull();
    expect(parseActivityAmount("   ")).toBeNull();
    expect(parseActivityAmount("not-a-number")).toBeNull();
  });
});

describe("activityWhen", () => {
  it("shows the indexer block coordinate (no fabricated wall-clock time)", () => {
    expect(activityWhen(row({ blockHeight: 42n, txIndex: 7 }))).toBe("block 42 · tx 7");
  });
});

describe("activityCounterparty", () => {
  it("uses the address when present", () => {
    expect(activityCounterparty(row({ counterparty: "mono1abc" }))).toBe("mono1abc");
  });

  it("falls back to the cluster name when a cluster is set", () => {
    expect(activityCounterparty(row({ counterparty: null, cluster: 4 }))).toBe(
      "C-005.cluster.mono",
    );
  });

  it("renders an em-dash when neither is present (no fabrication)", () => {
    expect(activityCounterparty(row({ counterparty: null, cluster: null }))).toBe("—");
  });
});

describe("activityRowToTx", () => {
  it("maps a transfer row onto a Tx with parsed amount and empty memo", () => {
    const tx = activityRowToTx(
      row({ kind: "transfer", direction: "in", amount: "3.25", counterparty: "mono1xyz" }),
      "public",
    );
    expect(tx).toMatchObject({
      id: "1000-2-0",
      when: "block 1000 · tx 2",
      amount: 3.25,
      token: "LYTH",
      direction: "in",
      counterparty: "mono1xyz",
      memo: "",
      kind: "transfer",
      denom: "public",
    });
  });

  it("leaves amount null for a weight-only delegation row (TxRow shows em-dash)", () => {
    const tx = activityRowToTx(
      row({ kind: "delegation", amount: null, weightBps: 500, cluster: 1, counterparty: null }),
      "public",
    );
    expect(tx.amount).toBeNull();
    expect(tx.kind).toBe("stake");
    expect(tx.counterparty).toBe("C-002.cluster.mono");
  });

  it("uses the indexer token id as the token label when present", () => {
    const tx = activityRowToTx(row({ tokenId: "0xdeadbeef", amount: "1" }), "public");
    expect(tx.token).toBe("0xdeadbeef");
  });

  it("threads the page denom through unchanged", () => {
    expect(activityRowToTx(row({}), "private").denom).toBe("private");
  });
});
