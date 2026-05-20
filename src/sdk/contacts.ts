// Contacts SDK — local non-secret address book.
//
// Contacts are non-secret state (the address is a public identifier;
// the nickname / notes are user-private but not security-critical) so
// they live in `localStorage` alongside `wallet.route` / `wallet.denom`,
// not in the OS keychain.
//
// Schema is intentionally tiny:
//   id          — uuid generated at create-time (stable across edits)
//   nickname    — user-supplied display name; required
//   addressHex  — EIP-55 lowercase hex (canonicalized via SDK)
//   notes       — optional free-text
//   addedAtMs   — ms-since-epoch the contact was first saved
//
// Storage is keyed by `mono.contacts.v1` so a future schema bump can
// land as a v2 key alongside without clobbering. The module surfaces
// pure helpers + a tiny CRUD API; the page hook is in
// `useContacts.tsx` to keep this file framework-free.

const STORAGE_KEY = "mono.contacts.v1";

export interface Contact {
  /** Stable UUID. */
  id: string;
  /** User-supplied display name. */
  nickname: string;
  /** EIP-55 lowercased 0x hex form. */
  addressHex: string;
  /** Optional free-text notes. */
  notes: string;
  /** Creation timestamp (ms since epoch). */
  addedAtMs: number;
}

/** Generate a UUIDv4-shaped id. Uses `crypto.randomUUID` when present;
 *  falls back to a Math.random construction for the rare jsdom case
 *  where the API isn't polyfilled. */
function generateId(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (g?.randomUUID) return g.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function safeReadList(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Contact[] = [];
    for (const row of parsed) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      if (
        typeof r.id !== "string" ||
        typeof r.nickname !== "string" ||
        typeof r.addressHex !== "string" ||
        typeof r.notes !== "string" ||
        typeof r.addedAtMs !== "number"
      )
        continue;
      out.push({
        id: r.id,
        nickname: r.nickname,
        addressHex: r.addressHex,
        notes: r.notes,
        addedAtMs: r.addedAtMs,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function safeWriteList(list: Contact[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage may be unavailable in some environments (private mode,
    // quota exceeded). Fail soft — the in-memory list still works for
    // the current session.
  }
}

/** List all stored contacts, newest first. */
export function listContacts(): Contact[] {
  const list = safeReadList();
  return list.sort((a, b) => b.addedAtMs - a.addedAtMs);
}

/** Add a new contact. Returns the inserted row (with generated id +
 *  timestamp). */
export function addContact(args: {
  nickname: string;
  addressHex: string;
  notes?: string;
}): Contact {
  const c: Contact = {
    id: generateId(),
    nickname: args.nickname,
    addressHex: args.addressHex.toLowerCase(),
    notes: args.notes ?? "",
    addedAtMs: Date.now(),
  };
  const list = safeReadList();
  list.push(c);
  safeWriteList(list);
  return c;
}

/** Update an existing contact in place. Returns the updated row or
 *  null if no row with `id` exists. */
export function updateContact(
  id: string,
  patch: Partial<Pick<Contact, "nickname" | "addressHex" | "notes">>,
): Contact | null {
  const list = safeReadList();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const existing = list[idx] as Contact;
  const next: Contact = {
    ...existing,
    ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
    ...(patch.addressHex !== undefined
      ? { addressHex: patch.addressHex.toLowerCase() }
      : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  };
  list[idx] = next;
  safeWriteList(list);
  return next;
}

/** Delete a contact by id. Returns true if a row was removed. */
export function deleteContact(id: string): boolean {
  const list = safeReadList();
  const filtered = list.filter((c) => c.id !== id);
  if (filtered.length === list.length) return false;
  safeWriteList(filtered);
  return true;
}

/** Test-only: clear all contacts. Production code never calls this. */
export function _resetContactsForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
