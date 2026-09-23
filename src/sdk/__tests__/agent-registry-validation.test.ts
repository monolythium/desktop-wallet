// SA-08-002, the half that validation DOES close.
//
// `loadAgents` performed three checks — `!raw`, `typeof`, `!raw.agents` — and
// then a bare cast. Six fields reached the UI, a transaction target and a policy
// principal with nothing checked between the disk and the send.
//
// Validation is not the ownership check; the finding says so plainly and the
// flow test beside this one covers that. What it closes is corruption: a garbage
// target, a raw `0x`, a truncated address, a `createdAt` that makes the sort
// comparator return NaN — and the case where the record's own two encodings of
// one address disagree, which is what editing only the funding target produces.

import { describe, expect, it } from "vitest";
import { parseAgentEntry } from "../agent-registry";

const HEX = "0xa9e1f0000000000000000000000000000000a9e1";
const BECH32 = "mono148slqqqqqqqqqqqqqqqqqqqqqqqqp20prg6jyj";
const OTHER_HEX = "0xbadbadbadbadbadbadbadbadbadbadbadbadbadb";
const OTHER_BECH32 = "mono1htd6mwkm4kadhtd6mwkm4kadhtd6mwkmk95hd4";

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slot: "kc:lyth:agent01:v1",
    label: "buyer-bot",
    addressHex: HEX,
    bech32m: BECH32,
    principalBech32m: "",
    createdAt: 1,
    ...over,
  };
}

describe("a well-formed record survives", () => {
  it("accepts what this wallet writes", () => {
    // Anti-vacuity for every rejection below: without this, a parser that
    // returned null unconditionally would pass the whole file.
    const parsed = parseAgentEntry(entry());
    expect(parsed).not.toBeNull();
    expect(parsed!.bech32m).toBe(BECH32);
    expect(parsed!.addressHex).toBe(HEX);
  });

  it("accepts a populated principal", () => {
    expect(parseAgentEntry(entry({ principalBech32m: OTHER_BECH32 }))).not.toBeNull();
  });

  it("normalises the hex case, as the write path does", () => {
    const parsed = parseAgentEntry(entry({ addressHex: HEX.toUpperCase() }));
    expect(parsed?.addressHex).toBe(HEX);
  });
});

describe("the funding target", () => {
  it("rejects a bech32m that is not a typed user address", () => {
    for (const bad of ["", "not-an-address", "mono1EVIL", "0x" + "a".repeat(40)]) {
      expect(parseAgentEntry(entry({ bech32m: bad })), bad).toBeNull();
    }
  });

  it("rejects a record whose two encodings of the address DISAGREE", () => {
    // The shape an attacker who edits only the funding target produces. Both
    // strings are individually valid; the record is not.
    expect(parseAgentEntry(entry({ bech32m: OTHER_BECH32 }))).toBeNull();
    expect(parseAgentEntry(entry({ addressHex: OTHER_HEX }))).toBeNull();
  });

  it("rejects a malformed addressHex", () => {
    for (const bad of ["", "0x", "0xzz", HEX.slice(0, -2), `${HEX}ab`, "a9e1f0"]) {
      expect(parseAgentEntry(entry({ addressHex: bad })), bad).toBeNull();
    }
  });

  it("STILL ACCEPTS a well-formed address the attacker chose", () => {
    // Stated as a test so the limit is not mistaken for an oversight: a
    // consistent substitution passes validation, by construction. Ownership is
    // what rejects it, and that is proved by re-deriving from the slot.
    const substituted = parseAgentEntry(
      entry({ addressHex: OTHER_HEX, bech32m: OTHER_BECH32 }),
    );
    expect(substituted).not.toBeNull();
    expect(substituted!.bech32m).toBe(OTHER_BECH32);
  });
});

describe("the other fields", () => {
  it("rejects a non-finite createdAt, which made the sort comparator NaN", () => {
    for (const bad of [undefined, null, "1", NaN, Infinity]) {
      expect(parseAgentEntry(entry({ createdAt: bad })), String(bad)).toBeNull();
    }
  });

  it("rejects an empty or over-long label", () => {
    expect(parseAgentEntry(entry({ label: "" }))).toBeNull();
    expect(parseAgentEntry(entry({ label: "   " }))).toBeNull();
    expect(parseAgentEntry(entry({ label: "x".repeat(65) }))).toBeNull();
    expect(parseAgentEntry(entry({ label: "x".repeat(64) }))).not.toBeNull();
  });

  it("rejects an empty slot — it names the keychain entry to unlock", () => {
    expect(parseAgentEntry(entry({ slot: "" }))).toBeNull();
    expect(parseAgentEntry(entry({ slot: "   " }))).toBeNull();
    expect(parseAgentEntry(entry({ slot: 7 }))).toBeNull();
  });

  it("rejects a malformed principal when one is present", () => {
    expect(parseAgentEntry(entry({ principalBech32m: "mono1EVIL" }))).toBeNull();
    expect(parseAgentEntry(entry({ principalBech32m: 7 }))).toBeNull();
  });

  it("rejects a non-object", () => {
    for (const bad of [null, undefined, 7, "x", []]) {
      expect(parseAgentEntry(bad), String(bad)).toBeNull();
    }
  });
});
