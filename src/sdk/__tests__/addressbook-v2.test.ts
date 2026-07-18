// Contacts store v2 — address-keyed, timestamped, with a deterministic
// label-preserving migration.
//
// The migration is the risky part: it rewrites the user's saved labels. It must
// never lose one silently, and must produce the same result regardless of the
// stored object's key order.

import { beforeEach, describe, expect, it } from "vitest";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import {
  addressbookAdd,
  addressbookEditNote,
  addressbookGetByAddress,
  addressbookLookup,
  addressbookRemove,
  addressbookRename,
  markContactUsed,
  migrateV1ToV2,
  MAX_NAME_LEN,
  MAX_NOTE_LEN,
  __resetAddressBookCacheForTest,
} from "../addressbook";

const BROWSER_KEY = "wallet.addressbook.v1";
const A = addressToTypedBech32("user", "0x" + "aa".repeat(20));
const B = addressToTypedBech32("user", "0x" + "bb".repeat(20));
const C = addressToTypedBech32("user", "0x" + "cc".repeat(20));

beforeEach(() => {
  localStorage.clear();
  __resetAddressBookCacheForTest();
});

describe("add — validation order, first failure wins", () => {
  it("requires a name", async () => {
    await expect(addressbookAdd({ name: "   ", address: A })).rejects.toThrow("Name is required.");
  });

  it("caps the name at 64 characters", async () => {
    await expect(addressbookAdd({ name: "x".repeat(65), address: A })).rejects.toThrow(
      "Name must be 64 characters or fewer.",
    );
  });

  it("caps the note at 256 characters", async () => {
    await expect(
      addressbookAdd({ name: "Alice", address: A, note: "x".repeat(257) }),
    ).rejects.toThrow("Note must be 256 characters or fewer.");
  });

  it("checks the name BEFORE the address (order matters)", async () => {
    // Both are invalid; the name error must win.
    await expect(addressbookAdd({ name: "", address: "not-an-address" })).rejects.toThrow(
      "Name is required.",
    );
  });

  it("rejects a raw 0x address with the typed validator's own message", async () => {
    await expect(
      addressbookAdd({ name: "Alice", address: "0x" + "aa".repeat(20) }),
    ).rejects.toThrow(/bech32m|typed/i);
  });

  it("rejects a duplicate ADDRESS, whatever the label", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await expect(addressbookAdd({ name: "Alice at work", address: A })).rejects.toThrow(
      "This address is already in your contacts.",
    );
  });

  it("detects the duplicate case-insensitively", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await expect(addressbookAdd({ name: "Other", address: A.toUpperCase() })).rejects.toThrow(
      "This address is already in your contacts.",
    );
  });

  it("accepts a name at exactly the limit", async () => {
    const record = await addressbookAdd({ name: "x".repeat(MAX_NAME_LEN), address: A });
    expect(record.name).toHaveLength(MAX_NAME_LEN);
  });

  it("stores a trimmed note, or null when blank", async () => {
    await addressbookAdd({ name: "Alice", address: A, note: "  hello  " });
    expect((await addressbookGetByAddress(A))?.note).toBe("hello");
    await addressbookAdd({ name: "Bob", address: B, note: "   " });
    expect((await addressbookGetByAddress(B))?.note).toBeNull();
  });
});

describe("MRU ordering", () => {
  it("a freshly added contact surfaces first", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await new Promise((r) => setTimeout(r, 2));
    await addressbookAdd({ name: "Bob", address: B });
    expect((await addressbookLookup()).map((e) => e.name)).toEqual(["Bob", "Alice"]);
  });

  it("lastUsedAt beats addedAt", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await new Promise((r) => setTimeout(r, 2));
    await addressbookAdd({ name: "Bob", address: B });
    await new Promise((r) => setTimeout(r, 2));

    await markContactUsed(A);
    expect((await addressbookLookup()).map((e) => e.name)).toEqual(["Alice", "Bob"]);
  });

  it("a never-used contact falls back to addedAt", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await new Promise((r) => setTimeout(r, 2));
    await addressbookAdd({ name: "Bob", address: B });
    const rows = await addressbookLookup();
    expect(rows.every((r) => r.lastUsedAt === undefined)).toBe(true);
    expect(rows.map((e) => e.name)).toEqual(["Bob", "Alice"]);
  });

  it("markContactUsed on an unknown address is a silent no-op", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await expect(markContactUsed(C)).resolves.toBeUndefined();
    expect(await addressbookLookup()).toHaveLength(1);
  });

  it("the query filter preserves MRU order", async () => {
    await addressbookAdd({ name: "Alice Cooper", address: A });
    await new Promise((r) => setTimeout(r, 2));
    await addressbookAdd({ name: "Alice Smith", address: B });
    expect((await addressbookLookup("alice")).map((e) => e.name)).toEqual([
      "Alice Smith",
      "Alice Cooper",
    ]);
  });

  it("filters over name, address and note", async () => {
    await addressbookAdd({ name: "Alice", address: A, note: "exchange desk" });
    expect(await addressbookLookup("exchange")).toHaveLength(1);
    expect(await addressbookLookup(A.slice(0, 12))).toHaveLength(1);
    expect(await addressbookLookup("nope")).toHaveLength(0);
  });
});

describe("rename / edit-note / remove", () => {
  it("rename mutates only the name", async () => {
    await addressbookAdd({ name: "Alice", address: A, note: "keep me" });
    expect(await addressbookRename(A, "Alicia")).toEqual({ renamed: true });
    const r = await addressbookGetByAddress(A);
    expect(r?.name).toBe("Alicia");
    expect(r?.note).toBe("keep me");
  });

  it("editNote mutates only the note, and blanks remove it", async () => {
    await addressbookAdd({ name: "Alice", address: A, note: "first" });
    await addressbookEditNote(A, "second");
    expect((await addressbookGetByAddress(A))?.note).toBe("second");
    await addressbookEditNote(A, "  ");
    const r = await addressbookGetByAddress(A);
    expect(r?.note).toBeNull();
    expect(r?.name).toBe("Alice");
  });

  it("rename and editNote are no-ops for an unknown address", async () => {
    expect(await addressbookRename(C, "Nobody")).toEqual({ renamed: false });
    expect(await addressbookEditNote(C, "x")).toEqual({ edited: false });
  });

  it("rename enforces the same name rules", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    await expect(addressbookRename(A, "  ")).rejects.toThrow("Name is required.");
    await expect(addressbookRename(A, "x".repeat(65))).rejects.toThrow(
      "Name must be 64 characters or fewer.",
    );
  });

  it("remove is by ADDRESS and is idempotent", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    expect(await addressbookRemove(A)).toEqual({ removed: true });
    expect(await addressbookRemove(A)).toEqual({ removed: false });
    expect(await addressbookGetByAddress(A)).toBeNull();
  });

  it("remove by NAME matches nothing (v2 is address-keyed)", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    expect(await addressbookRemove("Alice")).toEqual({ removed: false });
    expect(await addressbookGetByAddress(A)).not.toBeNull();
  });
});

describe("getByAddress", () => {
  it("is case-insensitive and exact", async () => {
    await addressbookAdd({ name: "Alice", address: A });
    expect((await addressbookGetByAddress(A.toUpperCase()))?.name).toBe("Alice");
    expect(await addressbookGetByAddress(B)).toBeNull();
    expect(await addressbookGetByAddress("")).toBeNull();
  });
});

describe("v1 → v2 migration", () => {
  const v1 = (entries: Record<string, unknown>) => ({ version: 1, entries });

  it("re-keys name-keyed entries by lowercased address", () => {
    const out = migrateV1ToV2(v1({ Alice: { name: "Alice", address: A } }), 1_000);
    expect(Object.keys(out.entries)).toEqual([A.toLowerCase()]);
    expect(out.entries[A.toLowerCase()]).toMatchObject({ name: "Alice", addedAt: 1_000 });
  });

  it("drops an entry whose address no longer validates", () => {
    const out = migrateV1ToV2(
      v1({
        Alice: { name: "Alice", address: A },
        Broken: { name: "Broken", address: "0xdeadbeef" },
      }),
      1_000,
    );
    expect(Object.keys(out.entries)).toEqual([A.toLowerCase()]);
  });

  it("merges a duplicate address, keeping the lexicographically-first label", () => {
    const out = migrateV1ToV2(
      v1({
        zeta: { name: "Zeta", address: A },
        alpha: { name: "alpha", address: A },
        Mid: { name: "Mid", address: A },
      }),
      1_000,
    );
    const rec = out.entries[A.toLowerCase()]!;
    expect(rec.name).toBe("alpha"); // case-insensitive first
    // No label is destroyed.
    expect(rec.note).toBe("also saved as: Mid, Zeta");
  });

  it("appends the merged labels to an existing note", () => {
    const out = migrateV1ToV2(
      v1({
        a: { name: "Alpha", address: A, note: "cold storage" },
        b: { name: "Beta", address: A },
      }),
      1_000,
    );
    expect(out.entries[A.toLowerCase()]!.note).toBe("cold storage · also saved as: Beta");
  });

  it("clamps a merged note at 256 characters", () => {
    const out = migrateV1ToV2(
      v1({
        a: { name: "Alpha", address: A, note: "x".repeat(250) },
        b: { name: "Beta", address: A },
      }),
      1_000,
    );
    expect(out.entries[A.toLowerCase()]!.note!.length).toBe(MAX_NOTE_LEN);
  });

  it("is DETERMINISTIC — key order does not change the result", () => {
    const forward = migrateV1ToV2(
      v1({
        zeta: { name: "Zeta", address: A },
        alpha: { name: "alpha", address: A },
        bob: { name: "Bob", address: B },
      }),
      1_000,
    );
    const reversed = migrateV1ToV2(
      v1({
        bob: { name: "Bob", address: B },
        alpha: { name: "alpha", address: A },
        zeta: { name: "Zeta", address: A },
      }),
      1_000,
    );
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("preserves legacy tags", () => {
    const out = migrateV1ToV2(v1({ a: { name: "Alice", address: A, tags: ["vip"] } }), 1_000);
    expect(out.entries[A.toLowerCase()]!.tags).toEqual(["vip"]);
  });

  it("a malformed payload becomes an empty v2 book", () => {
    for (const bad of [null, undefined, 5, "x", {}, { entries: 7 }]) {
      expect(migrateV1ToV2(bad, 1_000)).toEqual({ version: 2, entries: {} });
    }
  });

  it("runs end-to-end through the store on a v1 payload", async () => {
    localStorage.setItem(
      BROWSER_KEY,
      JSON.stringify(v1({ Alice: { name: "Alice", address: A }, Bob: { name: "Bob", address: B } })),
    );
    const rows = await addressbookLookup();
    expect(rows.map((r) => r.name).sort()).toEqual(["Alice", "Bob"]);
    expect(rows.every((r) => typeof r.addedAt === "number")).toBe(true);
  });

  it("a v2 payload passes through untouched", async () => {
    const record = {
      address: A,
      name: "Alice",
      note: null,
      tags: null,
      addedAt: 42,
      lastUsedAt: 99,
    };
    localStorage.setItem(
      BROWSER_KEY,
      JSON.stringify({ version: 2, entries: { [A.toLowerCase()]: record } }),
    );
    expect(await addressbookGetByAddress(A)).toMatchObject({ addedAt: 42, lastUsedAt: 99 });
  });
});

describe("corrupt rows never blank the book (§13)", () => {
  it("drops only the malformed entries", async () => {
    localStorage.setItem(
      BROWSER_KEY,
      JSON.stringify({
        version: 2,
        entries: {
          good: { address: A, name: "Alice", addedAt: 1 },
          noName: { address: B, addedAt: 1 },
          noAddedAt: { address: C, name: "Carol" },
          notAnObject: 7,
          nullish: null,
        },
      }),
    );
    const rows = await addressbookLookup();
    expect(rows.map((r) => r.name)).toEqual(["Alice"]);
  });

  it("unparseable JSON yields an empty book rather than throwing", async () => {
    localStorage.setItem(BROWSER_KEY, "{not json");
    await expect(addressbookLookup()).resolves.toEqual([]);
  });
});
