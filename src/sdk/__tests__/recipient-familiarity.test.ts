import { describe, expect, it } from "vitest";
import { classifyRecipient } from "../recipient-familiarity";

const FROM = "mono1from";
const R = "mono1recipient";

describe("classifyRecipient", () => {
  // The saved-contact case is NOT tested here any more, and that is the point:
  // a contact never reaches this classifier. The Send surface short-circuits to
  // "known" before calling it, because a contact is the user's own declaration
  // rather than chain evidence — this function judges chain evidence.
  //
  // The real behaviour is covered where it actually happens:
  // `components/__tests__/SendComposeModal.test.tsx` — "a saved contact
  // (matched by address) shows the green box and beats the warning" — which
  // asserts both halves through the rendered UI. The assertion removed from
  // here only ever exercised a parameter no production caller passed.

  it("is 'known' when a prior OUTGOING confirmed send to the address exists", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: [{ counterparty: "MONO1RECIPIENT", direction: "out" }], // case-insensitive
        pending: [],
      }),
    ).toBe("known");
  });

  it("is 'known' when an in-flight pending send to the address exists", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: [],
        pending: [{ counterparty: R, addressLower: FROM }],
      }),
    ).toBe("known");
  });

  it("is 'new' when history is readable but shows no prior send", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: [{ counterparty: "mono1someoneelse", direction: "out" }],
        pending: [],
      }),
    ).toBe("new");
  });

  it("does NOT treat an INCOMING row from the address as a prior send (stays 'new')", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: [{ counterparty: R, direction: "in" }], // received FROM them, never sent TO them
        pending: [],
      }),
    ).toBe("new");
  });

  it("does NOT treat a pending send from a DIFFERENT account as known (stays 'new')", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: [],
        pending: [{ counterparty: R, addressLower: "mono1otheraccount" }],
      }),
    ).toBe("new");
  });

  it("is 'unknown' when no history source could be read (no false 'new')", () => {
    expect(
      classifyRecipient({ recipientLower: R, fromLower: FROM, rows: null, pending: null }),
    ).toBe("unknown");
  });

  it("is 'unknown' when the CONFIRMED history is unreadable even if pending is readable-but-empty", () => {
    // pending ([]) can't prove "never sent before" — only confirmed history can.
    // A readable-empty pending must NOT upgrade an unreadable history to "new".
    expect(
      classifyRecipient({ recipientLower: R, fromLower: FROM, rows: null, pending: [] }),
    ).toBe("unknown");
  });

  it("still resolves 'known' from a pending send even when confirmed history is unreadable", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: null,
        pending: [{ counterparty: R, addressLower: FROM }],
      }),
    ).toBe("known");
  });

  it("is 'unknown' for an empty/invalid recipient", () => {
    expect(
      classifyRecipient({ recipientLower: "", fromLower: FROM, rows: [], pending: [] }),
    ).toBe("unknown");
  });

  it("is 'known' from a verified sent-log hit, no contact/history needed (C4 forward)", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: null,
        pending: null,
        verifiedSentLogHit: true,
      }),
    ).toBe("known");
  });

  it("an ABSENT sent-log hit never fabricates 'new' — history still decides (C4 reverse)", () => {
    // No log hit + unreadable history → 'unknown' (not 'new'); the log only adds "known".
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: null,
        pending: null,
        verifiedSentLogHit: false,
      }),
    ).toBe("unknown");
    // No log hit + readable-empty history → 'new' comes from the history, not the log.
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        rows: [{ counterparty: "mono1someoneelse", direction: "out" }],
        pending: [],
        verifiedSentLogHit: false,
      }),
    ).toBe("new");
  });
});
