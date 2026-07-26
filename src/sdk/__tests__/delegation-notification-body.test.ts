// Delegation notification bodies — the one assembler behind the OS toast, the
// in-flight row and the failed row.
//
// Two rules carry the weight here. The percent renders only for a weight the
// wallet actually captured: an unknown weight shows the cluster alone rather
// than "0.00%", because a zero-percent delegation is not something the user did.
// And a redelegate names its DESTINATION when the combined label will not fit,
// because the destination is the outcome — losing it to truncation would leave
// the user reading only where their weight came from.

import { describe, expect, it } from "vitest";
import {
  REDELEGATE_CLUSTER_BUDGET,
  delegationBodyLabel,
  delegationPercentLabel,
  notificationToast,
  parseHistoryEnvelope,
  type NotificationRecord,
} from "../notifications";
import { asPendingTx, type PendingTx } from "../pending-tx";

function rec(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 12,
    kind: "delegate",
    amountDecimal: "0",
    counterparty: "mono1delegationmoduleprecompileaddress",
    createdAtMs: 1_000,
    read: false,
    schemaVersion: 0,
    ...over,
  };
}

describe("delegationPercentLabel — the weight guard", () => {
  it("formats a valid weight (100 bps = 1.00%)", () => {
    expect(delegationPercentLabel(100)).toBe("1.00%");
    expect(delegationPercentLabel(2550)).toBe("25.50%");
    expect(delegationPercentLabel(10_000)).toBe("100.00%");
    expect(delegationPercentLabel(1)).toBe("0.01%");
  });

  it("refuses anything it cannot honestly state", () => {
    // Zero especially: rendering "0.00%" would describe a delegation of nothing.
    for (const bad of [undefined, 0, -1, 10_001, 1.5, NaN, Infinity]) {
      expect(delegationPercentLabel(bad as number | undefined)).toBeNull();
    }
  });
});

describe("delegate / undelegate bodies", () => {
  it("names the cluster and the percent when both are known", () => {
    expect(
      delegationBodyLabel(rec({ clusterName: "atlas", delegationWeightBps: 2550 })),
    ).toBe("atlas · 25.50%");
  });

  it("falls back to Cluster #id when no name was captured", () => {
    expect(
      delegationBodyLabel(rec({ clusterId: 7, delegationWeightBps: 100 })),
    ).toBe("Cluster #7 · 1.00%");
  });

  it("shows the cluster ALONE when the weight is unknown — never 0%", () => {
    const body = delegationBodyLabel(rec({ clusterName: "atlas" }));
    expect(body).toBe("atlas");
    expect(body).not.toContain("%");
  });

  it("shows the cluster alone when the weight is a zero the chain never set", () => {
    expect(
      delegationBodyLabel(rec({ clusterName: "atlas", delegationWeightBps: 0 })),
    ).toBe("atlas");
  });

  it("shows the percent alone when no cluster metadata exists", () => {
    expect(delegationBodyLabel(rec({ delegationWeightBps: 500 }))).toBe("5.00%");
  });

  it("falls back to the truncated counterparty for a legacy record", () => {
    expect(delegationBodyLabel(rec(), "mono1trunc…ated")).toBe("mono1trunc…ated");
  });

  it("returns null when nothing at all is known (caller shows the title alone)", () => {
    expect(delegationBodyLabel(rec())).toBeNull();
  });

  it("applies the same rules to undelegate (the row's full removed weight)", () => {
    expect(
      delegationBodyLabel(
        rec({ kind: "undelegate", clusterName: "atlas", delegationWeightBps: 4000 }),
      ),
    ).toBe("atlas · 40.00%");
  });

  it("is inert for a non-delegation kind", () => {
    expect(delegationBodyLabel(rec({ kind: "send" }))).toBeNull();
    expect(delegationBodyLabel(rec({ kind: "claim" }))).toBeNull();
  });
});

describe("redelegate — the from → to budget", () => {
  const redeleg = (over: Partial<NotificationRecord> = {}) =>
    rec({ kind: "redelegate", ...over });

  it("renders the movement when both ends are known and it fits", () => {
    expect(
      delegationBodyLabel(
        redeleg({
          clusterName: "atlas",
          toClusterName: "borealis",
          delegationWeightBps: 2550,
        }),
      ),
    ).toBe("atlas → borealis · 25.50%");
  });

  // " → " — the separator the assembler inserts between the two ends.
  const ARROW = " → ";
  const from = "a".repeat(18);
  /** A destination sized so the combined label lands exactly on `total`. */
  const toFor = (total: number) =>
    "b".repeat(total - ARROW.length - from.length);

  it("keeps the combined label at EXACTLY the budget", () => {
    const to = toFor(REDELEGATE_CLUSTER_BUDGET);
    expect(`${from}${ARROW}${to}`).toHaveLength(REDELEGATE_CLUSTER_BUDGET);
    expect(delegationBodyLabel(redeleg({ clusterName: from, toClusterName: to }))).toBe(
      `${from}${ARROW}${to}`,
    );
  });

  it("drops to the DESTINATION alone one character past the budget", () => {
    const to = toFor(REDELEGATE_CLUSTER_BUDGET + 1);
    expect(`${from}${ARROW}${to}`).toHaveLength(REDELEGATE_CLUSTER_BUDGET + 1);
    expect(delegationBodyLabel(redeleg({ clusterName: from, toClusterName: to }))).toBe(
      to,
    );
  });

  it("still appends the percent when the combined label was dropped", () => {
    const long = "x".repeat(40);
    expect(
      delegationBodyLabel(
        redeleg({
          clusterName: long,
          toClusterName: "borealis",
          delegationWeightBps: 1000,
        }),
      ),
    ).toBe("borealis · 10.00%");
  });

  it("falls back to the SOURCE alone when the destination is unknown", () => {
    expect(
      delegationBodyLabel(redeleg({ clusterName: "atlas", delegationWeightBps: 500 })),
    ).toBe("atlas · 5.00%");
  });

  it("uses Cluster #id on either end when a name is missing", () => {
    expect(
      delegationBodyLabel(redeleg({ clusterId: 1, toClusterId: 2 })),
    ).toBe("Cluster #1 → Cluster #2");
  });
});

describe("the toast reads the same as the rows", () => {
  it("carries the cluster and percent into the toast body", () => {
    const r = rec({ clusterName: "atlas", delegationWeightBps: 2550 });
    expect(notificationToast(r).body).toBe("atlas · 25.50%");
    expect(notificationToast(r).title).toBe("Delegated");
  });

  it("never leaks the bare delegation-module address when a cluster is known", () => {
    const r = rec({ kind: "redelegate", clusterName: "atlas", toClusterName: "bor" });
    const { body } = notificationToast(r);
    expect(body).toBe("atlas → bor");
    expect(body).not.toContain("mono1delegation");
  });

  it("is redacted entirely when details are off", () => {
    const r = rec({ clusterName: "atlas", delegationWeightBps: 2550 });
    expect(notificationToast(r, false)).toEqual({
      title: "Monolythium Wallet",
      body: "",
    });
  });
});

describe("G5 — the three fields survive a store round-trip in both directions", () => {
  const FIELDS = {
    delegationWeightBps: 2550,
    toClusterId: 9,
    toClusterName: "borealis",
  };

  it("a NEW notification blob round-trips every field", () => {
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...rec({ kind: "redelegate", clusterName: "atlas", ...FIELDS }) }],
    });
    const out = parsed?.entries[0];
    expect(out?.delegationWeightBps).toBe(2550);
    expect(out?.toClusterId).toBe(9);
    expect(out?.toClusterName).toBe("borealis");
    // And the body still assembles after the rebuild — the failure mode is a
    // field the validator quietly drops, which only shows up as a thinner label.
    expect(delegationBodyLabel(out!)).toBe("atlas → borealis · 25.50%");
  });

  it("a LEGACY notification blob without them parses with them absent", () => {
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...rec({ clusterName: "atlas" }) }],
    });
    const out = parsed?.entries[0];
    expect(out?.delegationWeightBps).toBeUndefined();
    expect(out?.toClusterId).toBeUndefined();
    expect(out?.toClusterName).toBeUndefined();
    expect(delegationBodyLabel(out!)).toBe("atlas");
  });

  it("a NEW tracked row round-trips every field", () => {
    const row: PendingTx = {
      txHash: "0x1",
      chainIdHex: "0x10f2c",
      addressLower: "mono1a",
      opKind: "redelegate",
      amountDecimal: "0",
      counterparty: "mono1d",
      clusterId: 1,
      clusterName: "atlas",
      submittedAt: 1,
      ...FIELDS,
    };
    const out = asPendingTx(JSON.parse(JSON.stringify(row)));
    expect(out?.delegationWeightBps).toBe(2550);
    expect(out?.toClusterId).toBe(9);
    expect(out?.toClusterName).toBe("borealis");
  });

  it("a LEGACY tracked row without them parses with them absent", () => {
    const out = asPendingTx({
      txHash: "0x1",
      chainIdHex: "0x10f2c",
      addressLower: "mono1a",
      opKind: "delegate",
      amountDecimal: "0",
      counterparty: "mono1d",
      clusterId: 1,
      submittedAt: 1,
    });
    expect(out).not.toBeNull();
    expect(out?.delegationWeightBps).toBeUndefined();
    expect(out?.toClusterId).toBeUndefined();
    expect(out?.toClusterName).toBeUndefined();
  });

  it("a malformed value drops to absent rather than poisoning the row", () => {
    const out = asPendingTx({
      txHash: "0x1",
      chainIdHex: "0x10f2c",
      addressLower: "mono1a",
      opKind: "delegate",
      amountDecimal: "0",
      counterparty: "mono1d",
      submittedAt: 1,
      delegationWeightBps: "2550",
      toClusterId: NaN,
      toClusterName: 7,
    });
    expect(out).not.toBeNull();
    expect(out?.delegationWeightBps).toBeUndefined();
    expect(out?.toClusterId).toBeUndefined();
    expect(out?.toClusterName).toBeUndefined();
  });
});
