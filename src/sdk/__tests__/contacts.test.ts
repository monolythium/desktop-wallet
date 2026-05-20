// Contacts SDK CRUD — covers localStorage round-trip + malformed-data
// recovery.

import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetContactsForTest,
  addContact,
  deleteContact,
  listContacts,
  updateContact,
} from "../contacts";

beforeEach(() => {
  _resetContactsForTest();
});

describe("contacts SDK", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(listContacts()).toEqual([]);
  });

  it("adds a contact and lists it", () => {
    const c = addContact({
      nickname: "Alice",
      addressHex: "0xAAaa00000000000000000000000000000000aaaa",
      notes: "work",
    });
    expect(c.id).toMatch(/[0-9a-f-]{36}/);
    expect(c.nickname).toBe("Alice");
    expect(c.addressHex).toBe("0xaaaa00000000000000000000000000000000aaaa");
    expect(listContacts()).toHaveLength(1);
  });

  it("updates a contact in place", () => {
    const c = addContact({ nickname: "Alice", addressHex: "0xaa", notes: "" });
    const updated = updateContact(c.id, { nickname: "Alice B." });
    expect(updated?.nickname).toBe("Alice B.");
    expect(listContacts()[0]?.nickname).toBe("Alice B.");
  });

  it("returns null when updating a non-existent contact", () => {
    expect(updateContact("no-such-id", { nickname: "X" })).toBeNull();
  });

  it("deletes a contact", () => {
    const c = addContact({ nickname: "Alice", addressHex: "0xaa", notes: "" });
    expect(deleteContact(c.id)).toBe(true);
    expect(listContacts()).toHaveLength(0);
  });

  it("returns false when deleting a non-existent contact", () => {
    expect(deleteContact("missing")).toBe(false);
  });

  it("sorts list newest-first", async () => {
    const a = addContact({ nickname: "Alice", addressHex: "0xa1", notes: "" });
    // Sleep 5ms so the second addedAtMs > the first.
    await new Promise((r) => setTimeout(r, 5));
    const b = addContact({ nickname: "Bob", addressHex: "0xb2", notes: "" });
    const list = listContacts();
    expect(list[0]?.id).toBe(b.id);
    expect(list[1]?.id).toBe(a.id);
  });

  it("recovers from malformed storage", () => {
    localStorage.setItem("mono.contacts.v1", "{not-json");
    expect(listContacts()).toEqual([]);
  });

  it("filters out malformed rows but keeps valid ones", () => {
    localStorage.setItem(
      "mono.contacts.v1",
      JSON.stringify([
        { id: "1", nickname: "Alice", addressHex: "0xa1", notes: "", addedAtMs: 1 },
        { nickname: "Eve", addressHex: "0xee", notes: "" }, // missing id + addedAtMs
        "definitely-not-an-object",
      ]),
    );
    const list = listContacts();
    expect(list).toHaveLength(1);
    expect(list[0]?.nickname).toBe("Alice");
  });
});
