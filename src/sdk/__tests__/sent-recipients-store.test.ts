// Sent-recipients store (T6) — record → verify round-trip over a mocked Tauri
// store, plus the disk-tamper / planted-entry / cross-vault-purge cases. Real
// WebCrypto; the Tauri store is an in-memory Map so a "disk edit" is a Map write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backing = vi.hoisted(() => ({ data: new Map<string, unknown>() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: async () => ({
      get: async (k: string) => backing.data.get(k),
      set: async (k: string, v: unknown) => {
        backing.data.set(k, v);
      },
      save: async () => {},
    }),
  },
}));

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { clearSentRecipientIntegrityKeys, sentRecipientsScopeKey } from "../sent-recipients";

/** The store persists the whole root under the "state" key; reach a scope's
 *  envelope through it (a "disk edit" mutates this object). */
function scopes(): Record<string, { v: 1; entries: { a: string; t: string }[] }> {
  const state = backing.data.get("state") as { scopes?: Record<string, { v: 1; entries: { a: string; t: string }[] }> };
  return state?.scopes ?? {};
}
import {
  __resetSentRecipientsStoreForTests,
  isSentRecipientVerified,
  purgeScopesForAddress,
  recordSentRecipient,
} from "../sent-recipients-store";

const hex = (b: string) => "0x" + b.repeat(20);
const FROM = addressToTypedBech32("user", hex("aa"));
const FROM_B = addressToTypedBech32("user", hex("bb"));
const TO_1 = addressToTypedBech32("user", hex("11"));
const TO_2 = addressToTypedBech32("user", hex("22"));
const CHAIN = "0x10f2c"; // scopeChainKey() default (builtin) in jsdom
const seedA = new Uint8Array(32).fill(7);
const seedB = new Uint8Array(32).fill(9);

beforeEach(() => {
  backing.data.clear();
  __resetSentRecipientsStoreForTests();
  clearSentRecipientIntegrityKeys();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  clearSentRecipientIntegrityKeys();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe("recordSentRecipient → isSentRecipientVerified", () => {
  it("a recorded recipient verifies in-session; a never-sent one does not", async () => {
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_1 })).toBe(true);
    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_2 })).toBe(false);
  });

  it("a repeat send dedupes to a single entry (move-to-front)", async () => {
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    const key = sentRecipientsScopeKey(FROM.toLowerCase(), CHAIN);
    expect(scopes()[key]!.entries).toHaveLength(1);
  });

  it("a disk-tampered tag fails verification (the warning fires)", async () => {
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    // Simulate an offline disk edit: rewrite the stored tag, then force a reload.
    const key = sentRecipientsScopeKey(FROM.toLowerCase(), CHAIN);
    scopes()[key] = { v: 1, entries: [{ a: hex("11"), t: "00".repeat(32) }] };
    __resetSentRecipientsStoreForTests();
    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_1 })).toBe(false);
  });

  it("a disk-PLANTED entry for a never-sent address fails verification", async () => {
    // The vault's key is cached (a prior send), but this entry was never signed.
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    const key = sentRecipientsScopeKey(FROM.toLowerCase(), CHAIN);
    scopes()[key] = { v: 1, entries: [{ a: hex("22"), t: "ab".repeat(32) }] }; // planted, fabricated tag
    __resetSentRecipientsStoreForTests();
    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_2 })).toBe(false);
  });
});

describe("purgeScopesForAddress — cross-vault no damage (C6)", () => {
  it("purging one vault's scope leaves another vault's log intact", async () => {
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    await recordSentRecipient({ seed: seedB, fromBech32m: FROM_B, toBech32m: TO_1 });
    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_1 })).toBe(true);
    expect(await isSentRecipientVerified({ fromBech32m: FROM_B, toBech32m: TO_1 })).toBe(true);

    await purgeScopesForAddress(FROM.toLowerCase());

    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_1 })).toBe(false); // purged
    expect(await isSentRecipientVerified({ fromBech32m: FROM_B, toBech32m: TO_1 })).toBe(true); // intact
  });
});

describe("outside Tauri — the store is a silent no-op", () => {
  it("records nothing and verifies false when the Tauri flag is absent", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await recordSentRecipient({ seed: seedA, fromBech32m: FROM, toBech32m: TO_1 });
    expect(backing.data.size).toBe(0);
    expect(await isSentRecipientVerified({ fromBech32m: FROM, toBech32m: TO_1 })).toBe(false);
  });
});
