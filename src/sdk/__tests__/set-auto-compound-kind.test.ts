// The `set-auto-compound` operation kind, end to end.
//
// The Delegate page already submits the real setAutoCompound(bool) call; before
// this kind existed the notification recorded as a generic contract call, so the
// user saw "Transaction confirmed" for an action that changed a standing
// preference about their rewards.
//
// The other half is the settled figure: enabling auto-compound while rewards are
// pending settles them in the SAME transaction, which emits a Claimed log. So
// the amount rule keys on the decoded FIELD rather than the kind — otherwise a
// real settlement would be recorded and then never shown.

import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_LABELS,
  PENDING_OP_LABELS,
  isTxOpKind,
  notificationAmountLabel,
  notificationTitle,
  notificationToast,
  pendingOpLabel,
  parseHistoryEnvelope,
  type NotificationRecord,
} from "../notifications";
import { asPendingTx } from "../pending-tx";

function rec(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 12,
    kind: "set-auto-compound",
    amountDecimal: "0",
    counterparty: "mono1delegation",
    createdAtMs: 1_000,
    read: false,
    schemaVersion: 0,
    ...over,
  };
}

describe("the kind itself", () => {
  it("is accepted by the runtime guard", () => {
    expect(isTxOpKind("set-auto-compound")).toBe(true);
  });

  it("carries the verbatim titles and the present-tense label", () => {
    expect(notificationTitle("set-auto-compound", "confirmed")).toBe(
      "Auto-compound updated",
    );
    expect(notificationTitle("set-auto-compound", "failed")).toBe(
      "Auto-compound update failed",
    );
    expect(pendingOpLabel("set-auto-compound")).toBe("Updating auto-compound…");
  });

  it("is present in both label tables (neither can be missed on a union change)", () => {
    expect(NOTIFICATION_LABELS["set-auto-compound"]).toBeDefined();
    expect(PENDING_OP_LABELS["set-auto-compound"]).toBeDefined();
  });
});

describe("the settled figure is keyed on the field, not the kind", () => {
  it("shows a decoded settlement on an auto-compound record", () => {
    const r = rec({ claimedAmount: "3.25" });
    expect(notificationAmountLabel(r)).toBe("+3.25 LYTH");
    expect(notificationToast(r).body).toBe("+3.25 LYTH");
    expect(notificationToast(r).title).toBe("Auto-compound updated");
  });

  it("shows NO figure when nothing was pending (no Claimed log is emitted)", () => {
    const r = rec();
    expect(notificationAmountLabel(r)).toBeNull();
    // The title alone — never a fabricated 0.
    expect(notificationToast(r).body).not.toContain("0 LYTH");
    expect(notificationToast(r).title).toBe("Auto-compound updated");
  });

  it("still shows a decoded settlement on a plain claim", () => {
    const r = rec({ kind: "claim", claimedAmount: "1.5" });
    expect(notificationAmountLabel(r)).toBe("+1.5 LYTH");
  });

  it("treats a decoded zero as no settlement", () => {
    expect(notificationAmountLabel(rec({ claimedAmount: "0" }))).toBeNull();
    expect(notificationAmountLabel(rec({ claimedAmount: "0.000" }))).toBeNull();
  });
});

describe("G5 — the kind is additive in both directions", () => {
  it("a NEW blob carrying the kind round-trips through the record parser", () => {
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...rec({ claimedAmount: "2" }) }],
    });
    expect(parsed?.entries[0]?.kind).toBe("set-auto-compound");
    expect(parsed?.entries[0]?.claimedAmount).toBe("2");
  });

  it("a LEGACY blob that predates the kind still parses unchanged", () => {
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...rec({ kind: "contract_call" }) }],
    });
    expect(parsed?.entries[0]?.kind).toBe("contract_call");
    expect(parsed?.entries[0]?.claimedAmount).toBeUndefined();
  });

  it("an UNKNOWN kind literal is dropped, not trusted, on both stores", () => {
    // A downgraded build must not be able to inject a literal the label tables
    // do not know.
    const parsed = parseHistoryEnvelope({
      schemaVersion: 0,
      entries: [{ ...rec(), kind: "set-auto-compound-v2" }],
    });
    expect(parsed?.entries).toHaveLength(0);
    expect(
      asPendingTx({
        txHash: "0x1",
        chainIdHex: "0x10f2c",
        addressLower: "mono1a",
        opKind: "set-auto-compound-v2",
        amountDecimal: "0",
        counterparty: "mono1d",
        submittedAt: 1,
      }),
    ).toBeNull();
  });

  it("the tracked-tx store accepts the new kind", () => {
    expect(
      asPendingTx({
        txHash: "0x1",
        chainIdHex: "0x10f2c",
        addressLower: "mono1a",
        opKind: "set-auto-compound",
        amountDecimal: "0",
        counterparty: "mono1d",
        submittedAt: 1,
      })?.opKind,
    ).toBe("set-auto-compound");
  });
});
