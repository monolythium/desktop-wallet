// The insufficient-funds body for a transaction that moves nothing.
//
// A delegation carries value = 0. The generic body said the wallet could not
// cover "the amount plus the network fee" — describing a transfer the user never
// made, and hiding that the entire shortfall is fee. The amount is not unknown
// here; it is known to be zero, and the sentence should say so.

import { describe, expect, it } from "vitest";
import { classifySendError } from "../send-error";

const INSUFFICIENT = "insufficient balance for max execution-unit cost";

describe("insufficient-funds body when the transaction moves no tokens", () => {
  it("does not claim an amount was being sent", () => {
    const c = classifySendError(INSUFFICIENT, { amountLythoshi: 0n });
    expect(c.body).not.toContain("amount plus");
  });

  it("says the fee is the whole cost", () => {
    const c = classifySendError(INSUFFICIENT, { amountLythoshi: 0n });
    expect(c.body.toLowerCase()).toContain("fee");
    expect(c.body.toLowerCase()).toContain("no tokens");
  });

  it("still classifies as insufficient funds", () => {
    expect(classifySendError(INSUFFICIENT, { amountLythoshi: 0n }).kind).toBe(
      "insufficient-funds",
    );
  });

  it("gives real figures when the balance is known, with no amount term", () => {
    const c = classifySendError(INSUFFICIENT, {
      amountLythoshi: 0n,
      balanceLythoshi: 10n ** 17n,
      maxFeeLythoshi: 10n ** 18n,
    });
    expect(c.body).toContain("Shortfall");
    expect(c.body).not.toContain("amount +");
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    const c = classifySendError(INSUFFICIENT, { amountLythoshi: 0n });
    expect(c.body.toLowerCase()).not.toContain("revert");
  });

  describe("the transfer path is untouched", () => {
    it("keeps the generic body when no context is supplied", () => {
      expect(classifySendError(INSUFFICIENT).body).toContain("amount plus");
    });

    it("keeps the enriched transfer body when a real amount is sent", () => {
      const c = classifySendError(INSUFFICIENT, {
        amountLythoshi: 5n * 10n ** 18n,
        balanceLythoshi: 10n ** 18n,
        maxFeeLythoshi: 10n ** 17n,
      });
      expect(c.body).toContain("amount +");
      expect(c.body).toContain("Shortfall");
    });
  });
});
