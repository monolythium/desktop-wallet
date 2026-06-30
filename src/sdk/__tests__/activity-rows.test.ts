import { describe, expect, it } from "vitest";
import type { LiveAddressActivityRow } from "../live";
import {
  activityCounterparty,
  activityDirection,
  activityKindToTxKind,
  activityRelativeTime,
  activityRowToTx,
  activityWhen,
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
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
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

describe("activityRelativeTime", () => {
  const now = 1_700_000_000_000; // fixed reference (ms)
  const nowSec = BigInt(Math.floor(now / 1000));

  it("returns null for a missing timestamp (old/pruned block — no fabrication)", () => {
    expect(activityRelativeTime(null, now)).toBeNull();
  });

  it("renders a real relative label across buckets", () => {
    expect(activityRelativeTime(nowSec, now)).toBe("just now");
    expect(activityRelativeTime(nowSec - 720n, now)).toBe("12m ago"); // 12 min
    expect(activityRelativeTime(nowSec - 7_200n, now)).toBe("2h ago"); // 2 h
    expect(activityRelativeTime(nowSec - 86_400n, now)).toBe("yesterday"); // 1 d
    expect(activityRelativeTime(nowSec - 259_200n, now)).toBe("3d ago"); // 3 d
  });

  it("never renders a negative/future time as a stale label", () => {
    expect(activityRelativeTime(nowSec + 600n, now)).toBe("just now");
  });
});

describe("activityWhen", () => {
  it("shows the indexer block coordinate when no timestamp is available", () => {
    expect(activityWhen(row({ blockHeight: 42n, txIndex: 7 }))).toBe("block 42 · tx 7");
  });

  it("shows a real relative time when enrichment resolved a timestamp", () => {
    const now = 1_700_000_000_000;
    const when = activityWhen(
      row({ blockTimestampSeconds: BigInt(Math.floor(now / 1000)) - 7_200n }),
      now,
    );
    expect(when).toBe("2h ago");
  });
});

describe("activityCounterparty", () => {
  it("prefers the resolved cluster name from enrichment when present", () => {
    expect(
      activityCounterparty(row({ counterparty: null, cluster: 4, clusterName: "atlas.cluster.mono" })),
    ).toBe("atlas.cluster.mono");
  });

  it("uses the address when present and no cluster name", () => {
    expect(activityCounterparty(row({ counterparty: "mono1abc" }))).toBe("mono1abc");
  });

  it("falls back to a plain cluster identifier when a cluster is set without a name", () => {
    expect(activityCounterparty(row({ counterparty: null, cluster: 4, clusterName: null }))).toBe(
      "Cluster #4",
    );
  });

  it("renders an em-dash when nothing is present (no fabrication)", () => {
    expect(activityCounterparty(row({ counterparty: null, cluster: null }))).toBe("—");
  });
});

describe("activityRowToTx", () => {
  it("converts a native transfer's raw lythoshi to display LYTH, signed by direction", () => {
    const tx = activityRowToTx(
      row({
        kind: "transfer",
        direction: "in",
        amount: "3250000000000000000", // 3.25 LYTH in lythoshi
        counterparty: "mono1xyz",
      }),
    );
    expect(tx).toMatchObject({
      id: "1000-2-0",
      when: "block 1000 · tx 2",
      amountText: "3.25",
      unit: "LYTH",
      signed: true,
      direction: "in",
      counterparty: "mono1xyz",
      memo: "",
      kind: "transfer",
    });
  });

  it("renders a large native amount in LYTH, not raw lythoshi (the lead bug)", () => {
    const tx = activityRowToTx(row({ kind: "transfer", amount: "185826729675356600000" }));
    expect(tx.amountText).toBe("185.8267"); // not 185,826,729,675,356,600,000
    expect(tx.unit).toBe("LYTH");
  });

  it("maps the native zero-address token id to the LYTH symbol", () => {
    const tx = activityRowToTx(row({ amount: "1000000000000000000", tokenId: "0x" + "00".repeat(32) }));
    expect(tx.unit).toBe("LYTH");
    expect(tx.amountText).toBe("1");
  });

  it("leaves amount null for a weight-only delegation row (TxRow shows em-dash)", () => {
    const tx = activityRowToTx(
      row({ kind: "delegation", amount: null, weightBps: 500, cluster: 1, counterparty: null }),
    );
    expect(tx.amountText).toBeNull();
    expect(tx.signed).toBe(false);
    expect(tx.kind).toBe("stake");
    expect(tx.counterparty).toBe("Cluster #1");
  });

  it("keeps an MRC-20 amount in base units with the token id as the unit", () => {
    const tx = activityRowToTx(row({ tokenId: "0xdeadbeef", amount: "1" }));
    expect(tx.unit).toBe("0xdeadbeef");
    expect(tx.amountText).toBe("1");
  });
});
