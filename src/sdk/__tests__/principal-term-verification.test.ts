// SA-08-014 — a signed term must be verified, not merely displayed.
//
// `args.principal` is a term the user's key commits to, and it originates from
// the vault catalog: plaintext JSON, caller-writable, validated only for
// object-ness. The confirm diff already renders it (there is a "Principal" row),
// so displayed equals signed — but display is not verification, and the audit's
// own standard for a term nobody can check is that it must at least be visible.
// Here it can be checked, so it is.
//
// The check is possible for a reason worth stating: unlike the agent address —
// which `agent-subaccount.ts` documents as "a fresh vault slot, NOT a derivation
// of the principal" — this one IS reproducible at the moment it matters. Every
// policy operation unlocks the principal vault, so the seed about to sign is in
// hand exactly when the term is about to be committed to.
//
// THE FIXTURES ARE DERIVED, NOT INVENTED. The expected address is computed from
// the seed by the real backend, not written down beside it. The previous pass
// shipped a regression precisely because every fixture carried a shape the
// production path does not produce, so nothing here asserts a correspondence the
// code does not actually make.

import { describe, expect, it } from "vitest";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import {
  PRINCIPAL_MISMATCH_MESSAGE,
  assertPrincipalMatchesSeed,
} from "../agent-ownership";
import { withSigningBackend } from "../signing-backend";
import {
  clearDerivedAddresses,
  isAddressDerived,
} from "../address-provenance";

/** A seed with no special structure — what matters is that the address below is
 *  DERIVED from it rather than asserted alongside it. */
function seed(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

/** The real derivation, run exactly as the shipped path runs it. */
function realAddressFor(s: Uint8Array): { hex: string; bech32m: string } {
  const hex = withSigningBackend(s, (backend) => backend.getAddress().toLowerCase());
  return { hex, bech32m: addressToTypedBech32("user", hex) };
}

describe("the principal term is checked against what the seed derives", () => {
  it("accepts the address the seed actually produces", () => {
    clearDerivedAddresses();
    const s = seed(7);
    const { bech32m } = realAddressFor(s);
    // Anti-vacuity for every rejection below: the happy path must exist, and it
    // must accept a value this codebase genuinely computes.
    expect(() => assertPrincipalMatchesSeed(s, bech32m)).not.toThrow();
  });

  it("records the derivation, so the display surfaces can ask too", () => {
    clearDerivedAddresses();
    const s = seed(7);
    const { hex, bech32m } = realAddressFor(s);
    expect(isAddressDerived(hex)).toBe(false);
    assertPrincipalMatchesSeed(s, bech32m);
    expect(isAddressDerived(hex)).toBe(true);
  });

  it("REFUSES a well-formed principal that belongs to a different vault", () => {
    // The attack: both addresses are valid, both parse, both render. Only the
    // derivation tells them apart — which is the whole point of the finding.
    const mine = seed(7);
    const theirs = realAddressFor(seed(9));
    expect(() => assertPrincipalMatchesSeed(mine, theirs.bech32m)).toThrow(
      PRINCIPAL_MISMATCH_MESSAGE,
    );
  });

  it("the two fixture seeds really do derive different addresses", () => {
    // Keeps the case above from passing because the fixtures happen to collide.
    expect(realAddressFor(seed(7)).hex).not.toBe(realAddressFor(seed(9)).hex);
  });

  it("refuses a malformed or empty principal rather than coercing it", () => {
    const s = seed(7);
    for (const bad of ["", "not-an-address", "0x" + "a".repeat(40)]) {
      expect(() => assertPrincipalMatchesSeed(s, bad), bad).toThrow();
    }
  });

  it("records NOTHING when the check fails", () => {
    // A refused term must not leave the address blessed for another surface.
    clearDerivedAddresses();
    const mine = seed(7);
    const theirs = realAddressFor(seed(9));
    expect(() => assertPrincipalMatchesSeed(mine, theirs.bech32m)).toThrow();
    expect(isAddressDerived(theirs.hex)).toBe(false);
    expect(isAddressDerived(realAddressFor(mine).hex)).toBe(false);
  });
});
