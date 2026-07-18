// Sent-recipients model + integrity crypto (T6). Uses real WebCrypto; no store.
// The security-load-bearing tests are the cross-binding (C5), the fail-safe
// verify directions (C3), and the zeroize-on-clear byte assertion (C2).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SENT_RECIPIENTS_CAP,
  __sentRecipientKeyRefForTest,
  clearSentRecipientIntegrityKeys,
  computeSentRecipientTag,
  constantTimeEqualHex,
  hasSentRecipientKey,
  parseSentRecipientsEnvelope,
  sentRecipientMacMessage,
  upsertSentEntry,
  verifySentRecipientTag,
} from "../sent-recipients";

const US = String.fromCharCode(0x1f);
const VAULT_A = "0x" + "aa".repeat(20);
const VAULT_B = "0x" + "bb".repeat(20);
const RCPT_1 = "0x" + "11".repeat(20);
const RCPT_2 = "0x" + "22".repeat(20);
const CHAIN = "0x10f2c";
const seedA = new Uint8Array(32).fill(7);
const seedB = new Uint8Array(32).fill(9);

beforeEach(() => clearSentRecipientIntegrityKeys());
afterEach(() => clearSentRecipientIntegrityKeys());

describe("sentRecipientMacMessage — canonical bytes", () => {
  it("joins domain|vault|chain|recipient with the 0x1f unit separator", () => {
    const msg = sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_1);
    expect(msg).toBe(["mono-sent-addr.v1", VAULT_A, CHAIN, RCPT_1].join(US));
    expect(msg.split(US)).toHaveLength(4);
  });
});

describe("parseSentRecipientsEnvelope — tolerant, fail-safe empty", () => {
  it("collapses null / wrong-v / non-array / foreign shape to empty", () => {
    for (const raw of [null, undefined, 42, { v: 2, entries: [] }, { v: 1, entries: "x" }, { addrs: [RCPT_1] }]) {
      expect(parseSentRecipientsEnvelope(raw).entries).toEqual([]);
    }
  });
  it("keeps only well-formed members", () => {
    const env = parseSentRecipientsEnvelope({
      v: 1,
      entries: [{ a: RCPT_1, t: "ab" }, { a: "", t: "x" }, { a: RCPT_2 }, null, 5],
    });
    expect(env.entries).toEqual([{ a: RCPT_1, t: "ab" }]);
  });
});

describe("upsertSentEntry — cap + move-to-front dedupe", () => {
  it("dedupes by `a`, moving it to the front with the new tag", () => {
    const start = [{ a: RCPT_1, t: "old" }, { a: RCPT_2, t: "t2" }];
    const next = upsertSentEntry(start, { a: RCPT_1, t: "new" });
    expect(next).toEqual([{ a: RCPT_1, t: "new" }, { a: RCPT_2, t: "t2" }]);
  });
  it("caps at 500, dropping the tail (oldest)", () => {
    let entries: { a: string; t: string }[] = [];
    for (let i = 0; i <= SENT_RECIPIENTS_CAP; i++) {
      entries = upsertSentEntry(entries, { a: "0x" + i.toString(16).padStart(40, "0"), t: "t" });
    }
    expect(entries).toHaveLength(SENT_RECIPIENTS_CAP);
    expect(entries[0]!.a).toBe("0x" + SENT_RECIPIENTS_CAP.toString(16).padStart(40, "0")); // newest at front
    expect(entries.some((e) => e.a === "0x" + (0).toString(16).padStart(40, "0"))).toBe(false); // oldest fell off
  });
});

describe("computeSentRecipientTag / verify — cross-binding (C5)", () => {
  it("a tag verifies for its own (vault, chain, recipient) triple", async () => {
    const msg = sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_1);
    const tag = await computeSentRecipientTag(seedA, VAULT_A, msg);
    expect(tag).toHaveLength(64); // 32-byte HMAC, hex
    expect(await verifySentRecipientTag(VAULT_A, msg, tag)).toBe(true);
  });

  it("fails under a different recipient, chain, or vault key", async () => {
    const msgA = sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_1);
    const tag = await computeSentRecipientTag(seedA, VAULT_A, msgA);
    // recipient B / chain B → different message, same key → mismatch
    expect(await verifySentRecipientTag(VAULT_A, sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_2), tag)).toBe(false);
    expect(await verifySentRecipientTag(VAULT_A, sentRecipientMacMessage(VAULT_A, "0xbeef", RCPT_1), tag)).toBe(false);
    // vault B → a DIFFERENT derived key (from seedB) → mismatch
    await computeSentRecipientTag(seedB, VAULT_B, sentRecipientMacMessage(VAULT_B, CHAIN, RCPT_1));
    expect(await verifySentRecipientTag(VAULT_B, sentRecipientMacMessage(VAULT_B, CHAIN, RCPT_1), tag)).toBe(false);
  });
});

describe("verify failure directions are fail-safe (C3)", () => {
  it("no cached session key → false (a fresh session before the first unlock)", async () => {
    const msg = sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_1);
    expect(await verifySentRecipientTag(VAULT_A, msg, "de".repeat(32))).toBe(false);
  });
  it("wrong-length tag → false via the constant-time compare", async () => {
    const msg = sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_1);
    const tag = await computeSentRecipientTag(seedA, VAULT_A, msg);
    expect(await verifySentRecipientTag(VAULT_A, msg, tag.slice(0, -2))).toBe(false);
    expect(constantTimeEqualHex("aa", "aabb")).toBe(false);
    expect(constantTimeEqualHex("aabb", "aabb")).toBe(true);
    expect(constantTimeEqualHex("aabb", "aabc")).toBe(false);
  });
});

describe("clearSentRecipientIntegrityKeys — zeroize on lock (C2)", () => {
  it("zeroizes the cached sub-key bytes IN PLACE and drops the entry", async () => {
    await computeSentRecipientTag(seedA, VAULT_A, sentRecipientMacMessage(VAULT_A, CHAIN, RCPT_1));
    const ref = __sentRecipientKeyRefForTest(VAULT_A)!;
    expect(ref).toBeInstanceOf(Uint8Array);
    expect(ref.some((b) => b !== 0)).toBe(true); // a real 32-byte key was cached
    clearSentRecipientIntegrityKeys();
    expect(hasSentRecipientKey(VAULT_A)).toBe(false); // entry gone
    expect(ref.every((b) => b === 0)).toBe(true); // the same buffer is now all-zero
  });
});
