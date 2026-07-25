// Fee affordability for a delegation.
//
// The absence this closes was confirmed in both the specification's source and
// here: every delegation guard reasons about WEIGHT. A wallet holding weight but
// no balance passes every check and is refused at admission.
//
// The predicate is the TOKEN gate's shape, not the native one. A delegation
// carries value = 0, so the fee sits ON TOP OF the transfer rather than inside
// it: the comparison is `basis < reservation` with NO amount term. Reaching for
// the native gate's `amount + fee > balance` by analogy would produce a check
// that is wrong in an interesting way rather than merely absent.

import { describe, expect, it } from "vitest";
import { delegationFeeAffordability } from "../delegation-fee";

const LYTH = 10n ** 18n;

describe("delegationFeeAffordability", () => {
  it("is short when the balance cannot cover the reservation", () => {
    const v = delegationFeeAffordability({
      basisLythoshi: LYTH / 100n,
      reservationLythoshi: LYTH / 10n,
    });
    expect(v.status).toBe("short");
  });

  it("is ok when the balance covers the reservation", () => {
    const v = delegationFeeAffordability({
      basisLythoshi: LYTH,
      reservationLythoshi: LYTH / 10n,
    });
    expect(v).toEqual({ status: "ok" });
  });

  it("admits exact equality — covering the fee exactly is affordable", () => {
    const v = delegationFeeAffordability({
      basisLythoshi: LYTH / 10n,
      reservationLythoshi: LYTH / 10n,
    });
    expect(v).toEqual({ status: "ok" });
  });

  it("carries NO amount term — a large delegation weight is not part of the test", () => {
    // The whole point: value = 0. Only the fee is owed, whatever the weight.
    const v = delegationFeeAffordability({
      basisLythoshi: LYTH,
      reservationLythoshi: LYTH / 2n,
    });
    expect(v).toEqual({ status: "ok" });
  });

  describe("failing OPEN — an unevaluable condition says nothing", () => {
    it("is unknown when the balance could not be read strictly", () => {
      expect(
        delegationFeeAffordability({
          basisLythoshi: null,
          reservationLythoshi: LYTH,
        }),
      ).toEqual({ status: "unknown" });
    });

    it("is unknown when the fee quote did not resolve", () => {
      expect(
        delegationFeeAffordability({
          basisLythoshi: LYTH,
          reservationLythoshi: null,
        }),
      ).toEqual({ status: "unknown" });
    });

    it("never treats an unreadable input as zero", () => {
      // A fabricated zero balance would report every wallet as short.
      const v = delegationFeeAffordability({
        basisLythoshi: null,
        reservationLythoshi: null,
      });
      expect(v.status).toBe("unknown");
      expect(JSON.stringify(v)).not.toContain("short");
    });
  });

  describe("the message", () => {
    const short = delegationFeeAffordability({
      basisLythoshi: LYTH / 100n,
      reservationLythoshi: LYTH / 10n,
    });

    it("says the fee is the whole cost, because no tokens move", () => {
      expect(short.status === "short" && short.message.toLowerCase()).toContain("fee");
    });

    it("does not describe an amount the user never sent", () => {
      // The generic body says "the amount plus the network fee" — there is no
      // amount on a delegation.
      expect(short.status === "short" && short.message).not.toContain("amount plus");
    });

    it("carries no word the drawer's error classifier would read as a chain revert", () => {
      expect(
        short.status === "short" && short.message.toLowerCase().includes("revert"),
      ).toBe(false);
    });
  });
});
