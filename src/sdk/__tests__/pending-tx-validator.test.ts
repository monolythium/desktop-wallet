// The tracked-tx row validator.
//
// The store is a durable JSON blob, so it is the boundary where a downgraded
// build's write, a partial file, or a corrupted value re-enters the app. The
// operation kind matters most: the label tables are keyed by that literal, so an
// unrecognised one indexes to undefined and throws while rendering the row —
// turning a bad byte on disk into a blank Activity page.

import { describe, expect, it } from "vitest";
import { asPendingTx, parsePendingTxEnvelope } from "../pending-tx";
import { NOTIFICATION_LABELS, PENDING_OP_LABELS } from "../notifications";

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    txHash: "0xabc",
    chainIdHex: "0x10f2c",
    addressLower: "mono1self",
    opKind: "send",
    amountDecimal: "1.5",
    counterparty: "mono1peer",
    submittedAt: 1_000,
    ...over,
  };
}

describe("asPendingTx — the operation kind", () => {
  it("accepts every kind the label tables know", () => {
    for (const kind of Object.keys(NOTIFICATION_LABELS)) {
      expect(asPendingTx(row({ opKind: kind }))?.opKind).toBe(kind);
    }
  });

  it("DROPS a row whose kind is unknown rather than trusting the string", () => {
    for (const opKind of ["", "garbage", "Send", "transfer", 7, null, {}]) {
      expect(asPendingTx(row({ opKind }))).toBeNull();
    }
  });

  it("a dropped row cannot reach a label table (the crash it prevents)", () => {
    // Demonstrates the failure the guard exists for: had the row survived, this
    // lookup is what the Activity row and the toast both perform.
    const parsed = asPendingTx(row({ opKind: "not-a-kind" }));
    expect(parsed).toBeNull();
    expect(
      NOTIFICATION_LABELS["not-a-kind" as keyof typeof NOTIFICATION_LABELS],
    ).toBeUndefined();
    expect(
      PENDING_OP_LABELS["not-a-kind" as keyof typeof PENDING_OP_LABELS],
    ).toBeUndefined();
  });

  it("drops only the bad row — the rest of the envelope survives", () => {
    const parsed = parsePendingTxEnvelope({
      schemaVersion: 0,
      txs: [row({ txHash: "0x1" }), row({ txHash: "0x2", opKind: "junk" }), row({ txHash: "0x3" })],
    });
    expect(parsed?.txs.map((t) => t.txHash)).toEqual(["0x1", "0x3"]);
  });
});
