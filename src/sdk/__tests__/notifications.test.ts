import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_HISTORY_CAP,
  NOTIFICATION_LABELS,
  MAX_REASON_LEN,
  REASON_UNAVAILABLE,
  appendCapped,
  delegationClusterLabel,
  humanizeReason,
  isTxOpKind,
  isZeroAmount,
  notificationAmountLabel,
  notificationId,
  notificationTitle,
  notificationToast,
  pendingOpLabel,
  PENDING_OP_LABELS,
  notificationsHistoryKey,
  notifiedSetKey,
  parseHistoryEnvelope,
  parseNotifiedSetEnvelope,
  type NotificationRecord,
} from "../notifications";

function rec(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 100,
    kind: "send",
    amountDecimal: "12.50",
    counterparty: "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    createdAtMs: 1_700_000_000_000,
    read: false,
    schemaVersion: 0,
    ...over,
  };
}

describe("notification key builders", () => {
  it("builds the per-scope history + dedupe keys", () => {
    expect(notificationsHistoryKey("mono1abc", "0x10f2c")).toBe(
      "mono.notifications.history.mono1abc.0x10f2c.v1",
    );
    expect(notifiedSetKey("mono1abc", "0x10f2c")).toBe(
      "mono.notifications.notified.mono1abc.0x10f2c.v1",
    );
  });

  it("derives the dedupe id from chain + hash (stable, chain-disambiguated)", () => {
    expect(notificationId("0x10f2c", "0xdead")).toBe("0x10f2c:0xdead");
    // Same hash, different chain ⇒ different id.
    expect(notificationId("0x1", "0xdead")).not.toBe(notificationId("0x2", "0xdead"));
  });
});

describe("notificationToast", () => {
  it("uses the in-app title and an amount + short-bech32m body", () => {
    const t = notificationToast(rec({ kind: "send", status: "confirmed" }));
    // Title is verbatim the in-app friendly title.
    expect(t.title).toBe(notificationTitle("send", "confirmed"));
    expect(t.title).toBe("Sent");
    // Body = "<amount> LYTH · <short>" with the SAME 10/6 middle-truncation the
    // Notifications row's `truncMiddle` applies.
    expect(t.body).toBe(
      "12.50 LYTH · mono1qqqqq…qqqqqq",
    );
  });

  it("uses the failed title and respects status", () => {
    const t = notificationToast(rec({ kind: "delegate", status: "failed" }));
    expect(t.title).toBe("Delegate failed");
  });

  it("omits the amount when it is zero (body = short address only)", () => {
    // The subject here is the zero-amount rule, not the kind. It used to be
    // written with `claim`, which now suppresses its body outright (§8c), so the
    // case is expressed with a kind that still renders a counterparty.
    const t = notificationToast(
      rec({ kind: "send", status: "confirmed", amountDecimal: "0" }),
    );
    expect(t.body).toBe("mono1qqqqq…qqqqqq");
    expect(t.body).not.toContain("LYTH");
  });

  it("does not truncate a short counterparty", () => {
    const t = notificationToast(
      rec({ amountDecimal: "1", counterparty: "mono1short" }),
    );
    expect(t.body).toBe("1 LYTH · mono1short");
  });

  it("carries no secrets — body holds only amount + a bech32m address", () => {
    const t = notificationToast(
      rec({ amountDecimal: "3.14", counterparty: "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" }),
    );
    // No contact name, no raw seed/payload — just the public amount + address.
    expect(t.body).toMatch(/^3\.14 LYTH · mono1[a-z0-9]+…[a-z0-9]+$/);
  });

  it("redacts to a generic title and an empty body when details are off", () => {
    const t = notificationToast(
      rec({ kind: "send", status: "confirmed", amountDecimal: "12.50" }),
      false,
    );
    // Generic app-name title — never the action (Sent/Delegated/…) — and no body,
    // so neither the operation nor the amount/address leaks on a shared screen.
    expect(t.title).toBe("Monolythium Wallet");
    expect(t.title).not.toBe(notificationTitle("send", "confirmed"));
    expect(t.body).toBe("");
  });

  it("names the cluster (not the module address) for a delegation body", () => {
    // A delegate's counterparty is the bare precompile + amount is zero; the body
    // should read the cluster, matching the in-app row — never "0x…/mono1module".
    const t = notificationToast(
      rec({
        kind: "delegate",
        status: "confirmed",
        amountDecimal: "0",
        counterparty: "mono1module",
        clusterId: 5,
      }),
    );
    expect(t.body).toBe("Cluster #5");
    const named = notificationToast(
      rec({ kind: "redelegate", amountDecimal: "0", clusterName: "atlas.cluster.mono" }),
    );
    expect(named.body).toBe("atlas.cluster.mono");
  });

  it("falls back to the truncated address when a delegation has no cluster metadata", () => {
    const t = notificationToast(
      rec({
        kind: "undelegate",
        amountDecimal: "0",
        counterparty: "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      }),
    );
    expect(t.body).toBe("mono1qqqqq…qqqqqq");
  });

  it("renders a claim's decoded settled amount as +<amount> LYTH", () => {
    const t = notificationToast(
      rec({ kind: "claim", status: "confirmed", amountDecimal: "0", claimedAmount: "12.3456" }),
    );
    expect(t.body).toBe("+12.3456 LYTH");
  });

  it("shows the BARE TITLE for a claim with no decoded reward", () => {
    // Behaviour change (§8c): this used to fall back to the submit-time
    // claimable. That figure is measured before execution settles further
    // rewards, so presenting it as the claimed amount under-reports income.
    const t = notificationToast(rec({ kind: "claim", amountDecimal: "5" }));
    expect(t.body).toBe("");
    expect(t.body).not.toContain("5 LYTH");
    expect(t.title).toBe("Rewards claimed");
  });
});

describe("notificationAmountLabel", () => {
  it("renders a claim's decoded reward as +<amt> LYTH", () => {
    expect(
      notificationAmountLabel(rec({ kind: "claim", amountDecimal: "0", claimedAmount: "9.1" })),
    ).toBe("+9.1 LYTH");
  });

  it("renders a plain amount for non-claims and omits a zero amount", () => {
    expect(notificationAmountLabel(rec({ kind: "send", amountDecimal: "3.5" }))).toBe("3.5 LYTH");
    expect(notificationAmountLabel(rec({ kind: "send", amountDecimal: "0" }))).toBeNull();
  });

  it("shows NO amount for a claim with no decoded reward", () => {
    // Behaviour change (§8c): the submit-time claimable is never shown as the
    // claimed amount. See claim-figure-law.test.ts for the full law.
    expect(notificationAmountLabel(rec({ kind: "claim", amountDecimal: "5" }))).toBeNull();
  });

  it("uses the token symbol as the unit for an MRC-20 send (not LYTH)", () => {
    expect(notificationAmountLabel(rec({ kind: "send", amountDecimal: "1.5", unit: "USDC" }))).toBe(
      "1.5 USDC",
    );
  });

  it("defaults a unit-less (legacy) record to LYTH", () => {
    expect(notificationAmountLabel(rec({ kind: "send", amountDecimal: "3.5" }))).toBe("3.5 LYTH");
  });
});

describe("delegationClusterLabel", () => {
  it("prefers the captured name, then #id, for delegation kinds", () => {
    expect(delegationClusterLabel(rec({ kind: "delegate", clusterName: "alpha", clusterId: 2 }))).toBe("alpha");
    expect(delegationClusterLabel(rec({ kind: "undelegate", clusterId: 9 }))).toBe("Cluster #9");
  });

  it("is null for a delegation with no cluster metadata and for non-delegation kinds", () => {
    expect(delegationClusterLabel(rec({ kind: "redelegate" }))).toBeNull();
    expect(delegationClusterLabel(rec({ kind: "send", clusterId: 3 }))).toBeNull();
    expect(delegationClusterLabel(rec({ kind: "claim", clusterId: 3 }))).toBeNull();
  });
});

describe("isTxOpKind", () => {
  it("accepts every known kind and rejects others", () => {
    for (const k of Object.keys(NOTIFICATION_LABELS)) {
      expect(isTxOpKind(k)).toBe(true);
    }
    expect(isTxOpKind("bridge")).toBe(false);
    expect(isTxOpKind(undefined)).toBe(false);
    expect(isTxOpKind(7)).toBe(false);
  });
});

describe("notificationTitle", () => {
  it("renders friendly titles per kind × status", () => {
    expect(notificationTitle("send", "confirmed")).toBe("Sent");
    expect(notificationTitle("send", "failed")).toBe("Send failed");
    expect(notificationTitle("delegate", "confirmed")).toBe("Delegated");
    expect(notificationTitle("claim", "confirmed")).toBe("Rewards claimed");
    expect(notificationTitle("contract_call", "failed")).toBe("Transaction failed");
  });
});

describe("pendingOpLabel", () => {
  it("renders a present-tense, in-flight label per kind", () => {
    expect(pendingOpLabel("send")).toBe("Sending…");
    expect(pendingOpLabel("delegate")).toBe("Delegating…");
    expect(pendingOpLabel("undelegate")).toBe("Undelegating…");
    expect(pendingOpLabel("claim")).toBe("Claiming rewards…");
    expect(pendingOpLabel("contract_call")).toBe("Submitting transaction…");
  });

  it("is distinct from the terminal title for every kind (never reads as confirmed)", () => {
    for (const k of Object.keys(PENDING_OP_LABELS)) {
      const kind = k as keyof typeof PENDING_OP_LABELS;
      expect(pendingOpLabel(kind)).not.toBe(notificationTitle(kind, "confirmed"));
    }
  });
});

describe("isZeroAmount", () => {
  it("treats empty / zero strings as zero", () => {
    expect(isZeroAmount("")).toBe(true);
    expect(isZeroAmount("0")).toBe(true);
    expect(isZeroAmount("0.0")).toBe(true);
    expect(isZeroAmount("0.000")).toBe(true);
  });
  it("treats any nonzero amount as nonzero", () => {
    expect(isZeroAmount("0.01")).toBe(false);
    expect(isZeroAmount("12.50")).toBe(false);
    expect(isZeroAmount("100")).toBe(false);
  });
});

describe("appendCapped", () => {
  it("prepends newest-first", () => {
    const a = rec({ id: "a", createdAtMs: 1 });
    const b = rec({ id: "b", createdAtMs: 2 });
    const out = appendCapped([a], b);
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("slices to the cap, dropping the oldest", () => {
    const entries = Array.from({ length: NOTIFICATION_HISTORY_CAP }, (_, i) =>
      rec({ id: `old-${i}` }),
    );
    const out = appendCapped(entries, rec({ id: "new" }));
    expect(out.length).toBe(NOTIFICATION_HISTORY_CAP);
    expect(out[0]!.id).toBe("new");
    // The very oldest entry fell off the end.
    expect(out.some((r) => r.id === `old-${NOTIFICATION_HISTORY_CAP - 1}`)).toBe(false);
  });

  it("respects a custom cap", () => {
    const out = appendCapped([rec({ id: "x" })], rec({ id: "y" }), 1);
    expect(out.map((r) => r.id)).toEqual(["y"]);
  });
});

describe("parseHistoryEnvelope", () => {
  it("round-trips a valid envelope", () => {
    const env = { schemaVersion: 0, entries: [rec()] };
    const parsed = parseHistoryEnvelope(env);
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]!.txHash).toBe("0xabc");
  });

  it("round-trips claimedAmount and tolerates its absence (legacy records)", () => {
    const withClaim = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [rec({ kind: "claim", claimedAmount: "7.5" })],
    });
    expect(withClaim?.entries[0]!.claimedAmount).toBe("7.5");
    const without = parseHistoryEnvelope({ schemaVersion: 0, entries: [rec()] });
    expect(without?.entries[0]!.claimedAmount).toBeUndefined();
  });

  it("round-trips feeLythoshi and tolerates its absence (legacy records)", () => {
    const withFee = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [rec({ feeLythoshi: "2100000000000000" })],
    });
    expect(withFee?.entries[0]!.feeLythoshi).toBe("2100000000000000");
    const without = parseHistoryEnvelope({ schemaVersion: 0, entries: [rec()] });
    expect(without?.entries[0]!.feeLythoshi).toBeUndefined();
  });

  it("round-trips reason + reasonCode BOTH ways (a field-blind legacy record parses)", () => {
    // Forward: a record carrying the new fields survives write -> read.
    const withReason = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [rec({ status: "failed", reason: "transaction-reverted", reasonCode: -32047 })],
    });
    expect(withReason?.entries[0]!.reason).toBe("transaction-reverted");
    expect(withReason?.entries[0]!.reasonCode).toBe(-32047);
    // Backward: a legacy record without the fields still parses (undefined).
    const legacy = parseHistoryEnvelope({ schemaVersion: 0, entries: [rec({ status: "failed" })] });
    expect(legacy?.entries[0]!.reason).toBeUndefined();
    expect(legacy?.entries[0]!.reasonCode).toBeUndefined();
  });

  it("carries the reserved REASON_UNAVAILABLE marker", () => {
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [rec({ status: "failed", reason: REASON_UNAVAILABLE })],
    });
    expect(parsed?.entries[0]!.reason).toBe(REASON_UNAVAILABLE);
  });

  it("bounds the persisted reason: an over-length token is dropped, not stored", () => {
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [rec({ status: "failed", reason: "x".repeat(MAX_REASON_LEN + 1) })],
    });
    // The record still parses (reason is optional), but the oversized token is
    // discarded — no unbounded text ever lands in the store.
    expect(parsed?.entries).toHaveLength(1);
    expect(parsed?.entries[0]!.reason).toBeUndefined();
  });
});

describe("humanizeReason", () => {
  it("renders a hyphen-case token as a sentence-case phrase", () => {
    expect(humanizeReason("transaction-reverted")).toBe("Transaction reverted");
    expect(humanizeReason("insufficient-funds")).toBe("Insufficient funds");
    expect(humanizeReason(REASON_UNAVAILABLE)).toBe("Reason unavailable");
  });

  it("returns null for an absent token (the no-reason absence)", () => {
    expect(humanizeReason(undefined)).toBeNull();
    expect(humanizeReason(null)).toBeNull();
    expect(humanizeReason("")).toBeNull();
  });

  it("drops malformed entries but keeps the good ones", () => {
    const env = {
      schemaVersion: 0,
      entries: [
        rec({ id: "good" }),
        { id: "bad", status: "pending" }, // status not confirmed/failed
        { id: "bad2", status: "confirmed" }, // missing required fields
        rec({ id: "good2", kind: "delegate" }),
      ],
    };
    const parsed = parseHistoryEnvelope(env);
    expect(parsed?.entries.map((r) => r.id)).toEqual(["good", "good2"]);
  });

  it("rejects an optimistic 'pending' status outright (status fidelity)", () => {
    const env = { schemaVersion: 0, entries: [{ ...rec(), status: "pending" }] };
    const parsed = parseHistoryEnvelope(env);
    expect(parsed?.entries).toHaveLength(0);
  });

  it("accepts a null blockNumber but rejects a non-finite one", () => {
    expect(parseHistoryEnvelope({ schemaVersion: 0, entries: [rec({ blockNumber: null })] })?.entries).toHaveLength(1);
    expect(parseHistoryEnvelope({ schemaVersion: 0, entries: [{ ...rec(), blockNumber: Number.NaN }] })?.entries).toHaveLength(0);
  });

  it("returns null on a wrong schemaVersion or a non-object", () => {
    expect(parseHistoryEnvelope({ schemaVersion: 1, entries: [] })).toBeNull();
    expect(parseHistoryEnvelope(null)).toBeNull();
    expect(parseHistoryEnvelope("nope")).toBeNull();
    expect(parseHistoryEnvelope({ schemaVersion: 0 })).toBeNull();
  });
});

describe("parseNotifiedSetEnvelope", () => {
  it("keeps only string ids", () => {
    const parsed = parseNotifiedSetEnvelope({
      schemaVersion: 0,
      ids: ["a", 1, "b", null, "c"],
    });
    expect(parsed?.ids).toEqual(["a", "b", "c"]);
  });

  it("returns null on a wrong schema or non-array ids", () => {
    expect(parseNotifiedSetEnvelope({ schemaVersion: 1, ids: [] })).toBeNull();
    expect(parseNotifiedSetEnvelope({ schemaVersion: 0, ids: "x" })).toBeNull();
    expect(parseNotifiedSetEnvelope(null)).toBeNull();
  });
});
