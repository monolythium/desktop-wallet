import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_HISTORY_CAP,
  NOTIFICATION_LABELS,
  appendCapped,
  isTxOpKind,
  isZeroAmount,
  notificationId,
  notificationTitle,
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
    expect(notificationTitle("delegate", "confirmed")).toBe("Staked");
    expect(notificationTitle("claim", "confirmed")).toBe("Rewards claimed");
    expect(notificationTitle("contract_call", "failed")).toBe("Transaction failed");
  });
});

describe("pendingOpLabel", () => {
  it("renders a present-tense, in-flight label per kind", () => {
    expect(pendingOpLabel("send")).toBe("Sending…");
    expect(pendingOpLabel("delegate")).toBe("Staking…");
    expect(pendingOpLabel("undelegate")).toBe("Unstaking…");
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
