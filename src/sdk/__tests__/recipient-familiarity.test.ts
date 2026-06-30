import { describe, expect, it } from "vitest";
import { classifyRecipient } from "../recipient-familiarity";

const FROM = "mono1from";
const R = "mono1recipient";

describe("classifyRecipient", () => {
  it("is 'known' for a saved contact (no history needed)", () => {
    expect(
      classifyRecipient({ recipientLower: R, fromLower: FROM, isContact: true, rows: null, pending: null }),
    ).toBe("known");
  });

  it("is 'known' when a prior OUTGOING confirmed send to the address exists", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        isContact: false,
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
        isContact: false,
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
        isContact: false,
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
        isContact: false,
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
        isContact: false,
        rows: [],
        pending: [{ counterparty: R, addressLower: "mono1otheraccount" }],
      }),
    ).toBe("new");
  });

  it("is 'unknown' when no history source could be read (no false 'new')", () => {
    expect(
      classifyRecipient({ recipientLower: R, fromLower: FROM, isContact: false, rows: null, pending: null }),
    ).toBe("unknown");
  });

  it("is 'unknown' when the CONFIRMED history is unreadable even if pending is readable-but-empty", () => {
    // pending ([]) can't prove "never sent before" — only confirmed history can.
    // A readable-empty pending must NOT upgrade an unreadable history to "new".
    expect(
      classifyRecipient({ recipientLower: R, fromLower: FROM, isContact: false, rows: null, pending: [] }),
    ).toBe("unknown");
  });

  it("still resolves 'known' from a pending send even when confirmed history is unreadable", () => {
    expect(
      classifyRecipient({
        recipientLower: R,
        fromLower: FROM,
        isContact: false,
        rows: null,
        pending: [{ counterparty: R, addressLower: FROM }],
      }),
    ).toBe("known");
  });

  it("is 'unknown' for an empty/invalid recipient", () => {
    expect(
      classifyRecipient({ recipientLower: "", fromLower: FROM, isContact: false, rows: [], pending: [] }),
    ).toBe("unknown");
  });
});
