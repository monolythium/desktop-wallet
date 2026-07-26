// The auto-compound enable-claims disclosure.
//
// `setAutoCompound(true)` reads like a preference toggle and is not one: the
// chain settles and pays out the wallet's ENTIRE pending rewards in the same
// transaction. A user turning on a setting does not expect to move funds, so
// the fact has to be visible before signing rather than discovered afterwards
// in the balance.
//
// The three cases that must stay silent matter as much as the one that speaks.
// A disclosure box that appears when nothing will be claimed trains people to
// dismiss it.

import { describe, expect, it } from "vitest";
import { autoCompoundClaimDisclosure } from "../delegation";

const LYTH = 10n ** 18n;

describe("when the disclosure appears", () => {
  it("appears when ENABLING with rewards pending", () => {
    const out = autoCompoundClaimDisclosure(true, 3n * LYTH);
    expect(out).not.toBeNull();
    expect(out).toContain("This also claims your pending 3 LYTH now.");
    expect(out).toContain("settles and pays out your current rewards");
  });

  it("formats a fractional amount at 4 dp, truncated", () => {
    expect(autoCompoundClaimDisclosure(true, 1_500_000_000_000_000_000n)).toContain(
      "pending 1.5 LYTH now",
    );
  });

  it("truncates rather than rounds up — never overstating the payout", () => {
    // 0.99999 LYTH must not read as 1 LYTH.
    const almost = 999_990_000_000_000_000n;
    expect(autoCompoundClaimDisclosure(true, almost)).toContain("pending 0.9999 LYTH");
  });

  it("keeps a large amount exact, grouped per the wallet's number rules", () => {
    expect(autoCompoundClaimDisclosure(true, 123_456n * LYTH)).toContain(
      "pending 123,456 LYTH",
    );
  });
});

describe("when it stays silent", () => {
  it("is silent when DISABLING, whatever is pending", () => {
    // Disabling has no side effect at all.
    for (const pending of [0n, 1n, 3n * LYTH, 10_000n * LYTH]) {
      expect(autoCompoundClaimDisclosure(false, pending)).toBeNull();
    }
  });

  it("is silent when enabling with nothing pending", () => {
    // No Claimed log is emitted; nothing moves.
    expect(autoCompoundClaimDisclosure(true, 0n)).toBeNull();
  });

  it("is silent for a negative/invalid amount", () => {
    expect(autoCompoundClaimDisclosure(true, -1n)).toBeNull();
  });

  it("is silent when the amount truncates to zero", () => {
    // Below the 4-dp display floor: "claims your pending 0 LYTH now" would be
    // a sentence that says nothing true.
    expect(autoCompoundClaimDisclosure(true, 1n)).toBeNull();
    expect(autoCompoundClaimDisclosure(true, 99_999_999_999_999n)).toBeNull();
  });
});

describe("the wording", () => {
  it("leads with the claim, not with the preference", () => {
    // The unexpected consequence goes first; the explanation follows.
    const out = autoCompoundClaimDisclosure(true, 2n * LYTH)!;
    expect(out.indexOf("claims your pending")).toBeLessThan(
      out.indexOf("Turning on auto-compound"),
    );
  });

  it("says the payout goes to the balance in the same transaction", () => {
    const out = autoCompoundClaimDisclosure(true, 2n * LYTH)!;
    expect(out).toContain("in the same transaction");
  });

  it("never promises a settled figure", () => {
    // The amount is a live preview; the settled figure comes from the receipt.
    const out = autoCompoundClaimDisclosure(true, 2n * LYTH)!;
    expect(out).not.toContain("claimed");
    expect(out).toContain("current rewards");
  });
});
