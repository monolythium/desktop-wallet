// Claim amounts: the decoded log, or nothing.
//
// The wallet used to announce "Claimed {X} LYTH" at broadcast-accept, from the
// pending total read just before signing. That figure is wrong twice over: it is
// measured before execution settles further rewards (a real incident showed
// 0.882914150695720660 actually claimed against 0.635221843003412968 displayed —
// a 1.39x under-report), and broadcast is not settlement at all.
//
// So the submit-time figure never reaches a surface. The tracked row now stores
// amountDecimal "0" because the amount is genuinely unknown until the receipt
// decodes, and that "0" is a STORAGE ARTIFACT: no path may render it as a claim
// of zero. This file tests the not-yet-decoded case and the undecodable case
// separately, because they arrive by different routes and only one of them ever
// resolves.

import { describe, expect, it } from "vitest";
import {
  notificationAmountLabel,
  notificationToast,
  type NotificationRecord,
} from "../notifications";

/** A claim record as the submit path now writes it: value 0, no decode yet. */
function claimRecord(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xclaim",
    txHash: "0xclaim",
    status: "confirmed",
    blockNumber: 900,
    kind: "claim",
    amountDecimal: "0",
    counterparty: "mono1delegationprecompile",
    createdAtMs: 1_000,
    read: false,
    schemaVersion: 0,
    ...over,
  };
}

describe("P1 case A — not yet decoded (the stored '0')", () => {
  it("renders NO figure, and never a zero claim", () => {
    const r = claimRecord();
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r).body).toBe("");
    expect(notificationToast(r).body).not.toContain("0 LYTH");
  });

  it("keeps the bare title", () => {
    expect(notificationToast(claimRecord()).title).toBe("Rewards claimed");
  });

  it("the stored artifact is present but unrendered", () => {
    // The field is genuinely "0" on the record — the surfaces refuse it rather
    // than the store hiding it.
    const r = claimRecord();
    expect(r.amountDecimal).toBe("0");
    expect(notificationAmountLabel(r)).toBeNull();
  });
});

describe("P1 case B — decoded, but undecodable/implausible (no amount ever arrives)", () => {
  it("renders NO figure when the log could not be decoded", () => {
    // claimedAmount stays absent; this record will never gain one.
    const r = claimRecord({ claimedAmount: undefined });
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r).body).toBe("");
  });

  it("renders NO figure when the decode produced a zero", () => {
    for (const zero of ["0", "0.0", "0.000", ""]) {
      const r = claimRecord({ claimedAmount: zero });
      expect(notificationAmountLabel(r)).toBeNull();
      expect(notificationToast(r).body).toBe("");
    }
  });

  it("a FAILED claim shows no figure either", () => {
    const r = claimRecord({ status: "failed" });
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r)).toEqual({ title: "Claim failed", body: "" });
  });
});

describe("a decoded claim shows the decoded figure", () => {
  it("renders the settled amount", () => {
    const r = claimRecord({ claimedAmount: "0.882914150695720660" });
    expect(notificationAmountLabel(r)).toBe("+0.882914150695720660 LYTH");
    expect(notificationToast(r).body).toBe("+0.882914150695720660 LYTH");
  });

  it("keeps FULL precision on the record", () => {
    // Display sites truncate; the stored value does not.
    const full = "0.882914150695720660";
    const r = claimRecord({ claimedAmount: full });
    expect(r.claimedAmount).toBe(full);
    expect(notificationAmountLabel(r)).toContain(full);
  });

  it("shows the decoded figure, never the submit-time one", () => {
    // The measured incident: the real settlement exceeded the snapshot by 1.39x.
    const r = claimRecord({
      amountDecimal: "0.635221843003412968", // what a legacy row might carry
      claimedAmount: "0.882914150695720660",
    });
    expect(notificationAmountLabel(r)).toBe("+0.882914150695720660 LYTH");
    expect(notificationAmountLabel(r)).not.toContain("0.635221843003412968");
  });
});

describe("a LEGACY claim record carrying a submit-time figure", () => {
  it("still refuses to render it", () => {
    // Rows written before this change hold the claimable in amountDecimal. The
    // law is enforced at render, so old records are corrected too.
    const r = claimRecord({ amountDecimal: "4.2" });
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r).body).not.toContain("4.2");
  });
});
