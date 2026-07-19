// The claim-figure law.
//
// A claim's displayed amount may come only from the decoded `Claimed` log — the
// receipt's settled truth. The tracked row also carries the amount the wallet
// showed at submit time, and it is tempting to fall back to it, but it is a
// different quantity measured at a different moment: a claim settles further
// rewards during execution, so the submit-time snapshot understates what
// actually arrived. Rendering it as "the claimed amount" would under-report the
// user's income and look entirely plausible while doing so.
//
// So the rule is absolute: decoded log, or nothing. Never the submit-time
// figure, never a fabricated 0.

import { describe, expect, it } from "vitest";
import {
  notificationAmountLabel,
  notificationTitle,
  notificationToast,
  suppressesSubmitTimeAmount,
  type NotificationRecord,
} from "../notifications";

const SUBMIT_TIME_CLAIMABLE = "4.2";

function claim(over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "0x10f2c:0xabc",
    txHash: "0xabc",
    status: "confirmed",
    blockNumber: 12,
    kind: "claim",
    // What the Delegate page knew at submit — deliberately non-zero, so a
    // fallback would be visible rather than accidentally passing as absent.
    amountDecimal: SUBMIT_TIME_CLAIMABLE,
    counterparty: "mono1delegationprecompile",
    createdAtMs: 1_000,
    read: false,
    schemaVersion: 0,
    ...over,
  };
}

describe("the gate", () => {
  it("suppresses the submit-time amount for a claim and nothing else", () => {
    expect(suppressesSubmitTimeAmount("claim")).toBe(true);
    for (const kind of ["send", "delegate", "undelegate", "redelegate", "receive"] as const) {
      expect(suppressesSubmitTimeAmount(kind)).toBe(false);
    }
  });
});

describe("a claim WITH a decoded log", () => {
  it("shows the decoded figure on every surface", () => {
    const r = claim({ claimedAmount: "5.83" });
    expect(notificationAmountLabel(r)).toBe("+5.83 LYTH");
    expect(notificationToast(r)).toEqual({
      title: "Rewards claimed",
      body: "+5.83 LYTH",
    });
  });

  it("shows the DECODED figure, not the submit-time one", () => {
    // The observed real-world gap: the settled amount exceeds the snapshot.
    const r = claim({ claimedAmount: "5.83" });
    expect(notificationAmountLabel(r)).toContain("5.83");
    expect(notificationAmountLabel(r)).not.toContain(SUBMIT_TIME_CLAIMABLE);
  });
});

describe("a claim WITHOUT a decodable log — the bare title", () => {
  it("shows no amount label at all", () => {
    expect(notificationAmountLabel(claim())).toBeNull();
  });

  it("never falls back to the submit-time claimable", () => {
    const r = claim();
    // The row genuinely holds it — the surfaces simply refuse to render it.
    expect(r.amountDecimal).toBe(SUBMIT_TIME_CLAIMABLE);
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r).body).not.toContain(SUBMIT_TIME_CLAIMABLE);
    expect(notificationToast(r).body).toBe("");
  });

  it("never renders a fabricated zero", () => {
    for (const r of [claim(), claim({ claimedAmount: "0" }), claim({ claimedAmount: "" })]) {
      expect(notificationAmountLabel(r)).toBeNull();
      expect(notificationToast(r).body).toBe("");
    }
  });

  it("keeps the bare title on the toast", () => {
    expect(notificationToast(claim())).toEqual({
      title: "Rewards claimed",
      body: "",
    });
    expect(notificationTitle("claim", "confirmed")).toBe("Rewards claimed");
  });

  it("never leaks the delegation precompile as a stand-in body", () => {
    expect(notificationToast(claim()).body).not.toContain("mono1delegation");
  });

  it("applies to a FAILED claim too", () => {
    const r = claim({ status: "failed" });
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r)).toEqual({ title: "Claim failed", body: "" });
  });
});

describe("auto-compound with zero pending emits no log — so no figure", () => {
  it("shows the title alone", () => {
    // Enabling auto-compound with nothing pending settles nothing, so no
    // Claimed log is emitted and claimedAmount stays absent.
    const r = claim({ kind: "set-auto-compound", amountDecimal: "0" });
    expect(notificationAmountLabel(r)).toBeNull();
    expect(notificationToast(r)).toEqual({
      title: "Auto-compound updated",
      body: "",
    });
  });

  it("shows the settled figure when rewards WERE pending", () => {
    const r = claim({
      kind: "set-auto-compound",
      amountDecimal: "0",
      claimedAmount: "1.75",
    });
    expect(notificationAmountLabel(r)).toBe("+1.75 LYTH");
    expect(notificationToast(r).body).toBe("+1.75 LYTH");
  });
});

describe("other kinds keep their amounts", () => {
  it("a send still shows what it sent", () => {
    const r = claim({ kind: "send", amountDecimal: "12.5", counterparty: "mono1peer" });
    expect(notificationAmountLabel(r)).toBe("12.5 LYTH");
  });

  it("a token send keeps its unit", () => {
    const r = claim({
      kind: "send",
      amountDecimal: "3",
      unit: "USDC",
      counterparty: "mono1peer",
    });
    expect(notificationAmountLabel(r)).toBe("3 USDC");
  });
});
