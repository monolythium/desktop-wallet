// The reset possession proof: the destructive wipe requires a recovery phrase
// that proves ownership (in addition to typing RESET), so a user who never
// backed up their phrase can't erase the only local copy — while a
// phrase-holding user who forgot the password still can. Pure + deterministic;
// uses the real keychain derivation (a separate file from reset.test.ts, which
// mocks keychain to test the wipe orchestration).

import { describe, expect, it } from "vitest";
import { generateMnemonic } from "@monolythium/core-sdk/crypto";
import { deriveAddressHexFromMnemonic } from "../keychain";
import { resetPhraseProofMatches } from "../reset";

const phrase = generateMnemonic();
const addressHex = deriveAddressHexFromMnemonic(phrase);

describe("deriveAddressHexFromMnemonic", () => {
  it("derives a stable, lowercased 0x address from a valid phrase", () => {
    expect(addressHex).toMatch(/^0x[0-9a-f]{40}$/);
    expect(deriveAddressHexFromMnemonic(phrase)).toBe(addressHex); // deterministic
  });
  it("returns null for an invalid or empty phrase", () => {
    expect(deriveAddressHexFromMnemonic("not a valid bip39 phrase at all")).toBeNull();
    expect(deriveAddressHexFromMnemonic("")).toBeNull();
    expect(deriveAddressHexFromMnemonic(new Array(24).fill("abandon").join(" "))).toBeNull();
  });
});

describe("resetPhraseProofMatches", () => {
  it("accepts only THIS vault's phrase against a known address (case-insensitive, normalized)", () => {
    expect(resetPhraseProofMatches(phrase, addressHex)).toBe(true);
    expect(resetPhraseProofMatches(phrase, addressHex!.toUpperCase())).toBe(true);
    expect(resetPhraseProofMatches(`  ${phrase.toUpperCase()}  `, addressHex)).toBe(true);
  });
  it("rejects a wrong phrase, a different valid phrase, and a different address", () => {
    expect(resetPhraseProofMatches("wrong phrase words here", addressHex)).toBe(false);
    expect(resetPhraseProofMatches(generateMnemonic(), addressHex)).toBe(false); // a different vault's phrase
    expect(resetPhraseProofMatches(phrase, `0x${"00".repeat(20)}`)).toBe(false); // a different vault
  });
  it("with no known address (a legacy vault never unlocked) accepts any valid phrase, rejects an invalid one", () => {
    expect(resetPhraseProofMatches(phrase, null)).toBe(true);
    expect(resetPhraseProofMatches("garbage words", null)).toBe(false);
  });
});
