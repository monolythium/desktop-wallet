// Recipient parser (T1) — table-driven over §1's ordered branches, with the
// BIP-350 case behaviour pinned against the INSTALLED SDK decoder
// (typedBech32ToAddress), not a hand-written expectation.

import { describe, expect, it } from "vitest";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import {
  MONO_NAME_MAX_LEN,
  PARTIAL_NAME_MAX_LEN,
  looksLikePartialMonoName,
  parseMonoName,
  parseRecipient,
} from "../recipient-parse";

const HEX = "0x000000000000000000000000000000000000dead";
const VALID = addressToTypedBech32("user", HEX); // mono1…qyd90f, 43 chars
const CLUSTER = addressToTypedBech32("cluster", HEX); // monok1…, 44 chars

const RETIRED = "raw 0x addresses are retired; use a typed mono1 address or .mono name";
const BAD_NAME = "not a valid mono name (e.g. alice.mono, treasury.contract.mono)";
const UNKNOWN = "address must start with mono1 or end in .mono";

describe("parseRecipient — empty / partial (quiet)", () => {
  it("empty and whitespace-only are quiet", () => {
    expect(parseRecipient("")).toMatchObject({ error: null, inputForm: "empty" });
    expect(parseRecipient("   ")).toMatchObject({ error: null, inputForm: "empty" });
  });

  it("a mono1 prefix shorter than 43 chars is a quiet partial (either case)", () => {
    expect(parseRecipient("mono1q")).toMatchObject({ error: null, inputForm: "partial" });
    expect(parseRecipient("MONO1QQQQ")).toMatchObject({ error: null, inputForm: "partial" });
  });

  it("a short monok1… prefix (≤ 40) is a quiet partial", () => {
    expect(parseRecipient("monok1qqq")).toMatchObject({ error: null, inputForm: "partial" });
  });

  it("a 40-char lowercase non-name is a quiet partial; 41 chars is unknown-shape", () => {
    expect(parseRecipient("a".repeat(40))).toMatchObject({ error: null, inputForm: "partial" });
    expect(parseRecipient("a".repeat(41))).toMatchObject({ error: UNKNOWN, inputForm: "unknown" });
  });
});

describe("parseRecipient — raw 0x is retired (even well-formed 40-hex)", () => {
  const cases = ["0x1234", "0XABCD", "0x" + "a".repeat(39), "0xnothex", "0x" + "0".repeat(40), HEX];
  for (const c of cases) {
    it(`rejects ${c.slice(0, 12)}… with the retired message`, () => {
      expect(parseRecipient(c)).toMatchObject({ error: RETIRED, inputForm: "0x", addr0x: null });
    });
  }
});

describe("parseRecipient — mono1 decode + BIP-350 case rules (SDK-pinned)", () => {
  it("a valid lowercase address decodes to the canonical pair", () => {
    const p = parseRecipient(VALID);
    expect(p.inputForm).toBe("mono1");
    expect(p.error).toBeNull();
    expect(p.bech).toBe(VALID.toLowerCase());
    expect(p.addr0x).toBe(HEX);
  });

  it("the SAME address ALL-UPPERCASE decodes to the identical canonical pair", () => {
    const p = parseRecipient(VALID.toUpperCase());
    expect(p.bech).toBe(VALID.toLowerCase());
    expect(p.addr0x).toBe(HEX);
    expect(p.error).toBeNull();
  });

  it("a MIXED-case variant errors with the codec's mixed-case message verbatim", () => {
    const mixed = VALID.slice(0, 6) + VALID[6]!.toUpperCase() + VALID.slice(7);
    expect(parseRecipient(mixed)).toMatchObject({
      error: "bech32m address cannot mix upper and lower case",
      inputForm: "mono1",
    });
  });

  it("a corrupted char errors with the checksum-mismatch message verbatim", () => {
    const i = 10;
    const repl = VALID[i] === "q" ? "p" : "q";
    const corrupt = VALID.slice(0, i) + repl + VALID.slice(i + 1);
    expect(parseRecipient(corrupt)).toMatchObject({
      error: "bech32m checksum mismatch",
      inputForm: "mono1",
    });
  });

  it("an invalid charset char surfaces the codec's message verbatim", () => {
    const badchar = VALID.slice(0, 10) + "b" + VALID.slice(11); // 'b' ∉ bech32 charset
    expect(parseRecipient(badchar)).toMatchObject({
      error: "invalid bech32m character 'b'",
      inputForm: "mono1",
    });
  });

  it("a full-length monok1… cluster address is unknown-shape (never a partial)", () => {
    expect(CLUSTER.length).toBeGreaterThan(PARTIAL_NAME_MAX_LEN);
    expect(parseRecipient(CLUSTER)).toMatchObject({ error: UNKNOWN, inputForm: "unknown" });
  });
});

describe("parseRecipient — .mono names (§3 categories)", () => {
  it("parses each accepted shape with correct fields", () => {
    expect(parseRecipient("alice.mono").monoName).toEqual({
      tld: "human", label: "alice", parent: null, canonical: "alice.mono",
    });
    expect(parseRecipient("bob.agent.alice.mono").monoName).toEqual({
      tld: "agent", label: "bob", parent: "alice.mono", canonical: "bob.agent.alice.mono",
    });
    expect(parseRecipient("x.cluster.mono").monoName).toMatchObject({ tld: "cluster", label: "x" });
    expect(parseRecipient("treasury.contract.mono").monoName).toMatchObject({ tld: "contract", label: "treasury" });
    expect(parseRecipient("x.system.mono").monoName).toMatchObject({ tld: "system", label: "x" });
  });

  it("all name inputs carry inputForm 'mono-name' and no addr0x", () => {
    const p = parseRecipient("alice.mono");
    expect(p.inputForm).toBe("mono-name");
    expect(p.addr0x).toBeNull();
  });

  const rejects = [
    "alice.dao.mono", // 3-part second label not cluster/contract/system
    "x.agent.mono", // agent without a parent
    "a.b.c.mono", // 4-part, position-2 ≠ agent
    "a.b.c.d.mono", // 5-part
    "Alice.mono", // uppercase
    `${"z".repeat(64)}.mono`, // > 63-char label
  ];
  for (const r of rejects) {
    it(`rejects ${r} with the name-example error`, () => {
      expect(parseRecipient(r)).toMatchObject({ error: BAD_NAME, inputForm: "mono-name" });
    });
  }

  it("rejects a name longer than 253 chars", () => {
    const long = `${"a".repeat(MONO_NAME_MAX_LEN)}.mono`;
    expect(parseMonoName(long)).toBeNull();
  });
});

describe("looksLikePartialMonoName — the 40-char cap boundary", () => {
  it("accepts ≤ 40 lowercase alnum, rejects > 40 and uppercase", () => {
    expect(looksLikePartialMonoName("alice")).toBe(true);
    expect(looksLikePartialMonoName("a".repeat(PARTIAL_NAME_MAX_LEN))).toBe(true);
    expect(looksLikePartialMonoName("a".repeat(PARTIAL_NAME_MAX_LEN + 1))).toBe(false);
    expect(looksLikePartialMonoName("Alice")).toBe(false);
    expect(looksLikePartialMonoName("")).toBe(false);
  });
});
