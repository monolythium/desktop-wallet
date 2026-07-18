// Local address-book store for wallet contacts — v2, keyed by ADDRESS.
//
// Contacts are a wallet-level feature, not a names-surface feature. Native
// builds persist through Tauri plugin-store; browser preview uses localStorage
// so the management surface stays usable without the Tauri host.
//
// v2 keys entries by lowercased bech32m address rather than by contact name. A
// contact identifies a COUNTERPARTY: keying by name let one address appear under
// several labels and made adds collide on the label instead of the thing that
// matters. The v1→v2 migration is deterministic and label-preserving — a losing
// duplicate's name is folded into the winner's note rather than silently
// destroyed.
//
// Scope: GLOBAL — one book shared across every vault, account and chain.
// Contacts are labels for counterparties, not per-account data, so removing a
// vault does NOT purge them.

import { Store } from "@tauri-apps/plugin-store";
import { requireTypedUserAddress } from "./address";

const STORE_FILE = "addressbook.v1.json";
const STATE_KEY = "state";
const BROWSER_KEY = "wallet.addressbook.v1";

/** Character limits, post-trim. Shared with the Contacts page so the input
 *  `maxLength` and the store validation cannot drift apart. */
export const MAX_NAME_LEN = 64;
export const MAX_NOTE_LEN = 256;

export class AddressBookCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressBookCallError";
  }
}

export interface ContactRecord {
  /** Canonical typed bech32m, as validated. */
  address: string;
  /** 1–64 chars, trimmed at write time. */
  name: string;
  /** 0–256 chars, trimmed; persisted only when non-empty. */
  note?: string | null;
  /** Legacy render-only field — no UI writes it; preserved across migration. */
  tags?: string[] | null;
  /** ms epoch, set at creation. */
  addedAt: number;
  /** ms epoch — bumped ONLY on a successful send to this contact. */
  lastUsedAt?: number;
}

/** Legacy name kept so existing imports keep compiling. */
export type AddressBookEntry = ContactRecord;

export interface AddressBookAddInput {
  name: string;
  address: string;
  note?: string | null;
}

interface AddressBookState {
  version: 2;
  entries: Record<string, ContactRecord>;
}

const EMPTY_STATE: AddressBookState = { version: 2, entries: {} };

let storePromise: Promise<Store> | null = null;
let cache: AddressBookState | null = null;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tags = value.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  return tags.length > 0 ? tags : null;
}

// ── v2 normalization ────────────────────────────────────────────────────────

/** Parse one stored v2 record, or null when malformed. A corrupt row is DROPPED
 *  — it must never blank the whole book or crash a page. */
function normalizeRecord(value: unknown): ContactRecord | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.name !== "string" || typeof o.address !== "string") return null;
  const name = o.name.trim();
  const address = o.address.trim();
  if (name === "" || address === "") return null;
  if (typeof o.addedAt !== "number" || !Number.isFinite(o.addedAt)) return null;
  const lastUsedAt =
    typeof o.lastUsedAt === "number" && Number.isFinite(o.lastUsedAt) ? o.lastUsedAt : undefined;
  const note = typeof o.note === "string" && o.note.trim() !== "" ? o.note.trim() : null;
  return {
    address,
    name: clamp(name, MAX_NAME_LEN),
    note,
    tags: normalizeTags(o.tags),
    addedAt: o.addedAt,
    ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
  };
}

// ── v1 → v2 migration ───────────────────────────────────────────────────────

/** True when the payload is a v1 (name-keyed, untimestamped) book. */
function looksLikeV1(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.version === 2) return false;
  if (o.version === 1) return true;
  const entries = o.entries;
  if (!entries || typeof entries !== "object") return false;
  // Version-less payload: treat as v1 when any entry lacks `addedAt`.
  return Object.values(entries as Record<string, unknown>).some(
    (v) => !v || typeof v !== "object" || typeof (v as Record<string, unknown>).addedAt !== "number",
  );
}

/**
 * Deterministic v1→v2 migration.
 *
 * Re-keys by lowercased address, dropping any entry whose address no longer
 * validates (trust-but-verify: a corrupt row must not wedge the store). When two
 * v1 names share an address the winner is the case-insensitive
 * lexicographically-first name, and every losing label is folded into the
 * winner's note rather than discarded.
 *
 * Pure and order-independent: the same logical input yields identical output
 * regardless of the object's key enumeration order.
 */
export function migrateV1ToV2(raw: unknown, nowMs: number): AddressBookState {
  if (!raw || typeof raw !== "object") return { version: 2, entries: {} };
  const rawEntries = (raw as Record<string, unknown>).entries;
  if (!rawEntries || typeof rawEntries !== "object") return { version: 2, entries: {} };

  interface V1Row {
    name: string;
    address: string;
    note: string | null;
    tags: string[] | null;
  }

  const rows: V1Row[] = [];
  for (const value of Object.values(rawEntries as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const o = value as Record<string, unknown>;
    if (typeof o.name !== "string" || typeof o.address !== "string") continue;
    const name = o.name.trim();
    if (name === "") continue;
    let address: string;
    try {
      address = requireTypedUserAddress(o.address.trim(), "address book entry");
    } catch {
      continue; // an address that no longer validates is dropped
    }
    rows.push({
      name,
      address,
      note: typeof o.note === "string" && o.note.trim() !== "" ? o.note.trim() : null,
      tags: normalizeTags(o.tags),
    });
  }

  const byAddress = new Map<string, V1Row[]>();
  for (const row of rows) {
    const k = row.address.toLowerCase();
    const list = byAddress.get(k);
    if (list) list.push(row);
    else byAddress.set(k, [row]);
  }

  const entries: Record<string, ContactRecord> = {};
  // Sort the address keys too, so the emitted object's own key order is stable.
  for (const k of [...byAddress.keys()].sort()) {
    const group = byAddress.get(k)!;
    const sorted = [...group].sort((a, b) => {
      const ci = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return ci !== 0 ? ci : a.name.localeCompare(b.name);
    });
    const winner = sorted[0]!;
    const losers = sorted.slice(1).map((r) => r.name);
    const parts: string[] = [];
    if (winner.note) parts.push(winner.note);
    if (losers.length > 0) parts.push(`also saved as: ${losers.join(", ")}`);
    entries[k] = {
      address: winner.address,
      name: clamp(winner.name, MAX_NAME_LEN),
      note: parts.length > 0 ? clamp(parts.join(" · "), MAX_NOTE_LEN) : null,
      tags: winner.tags,
      addedAt: nowMs,
    };
  }
  return { version: 2, entries };
}

function normalizeState(raw: unknown, nowMs: number): AddressBookState {
  if (looksLikeV1(raw)) return migrateV1ToV2(raw, nowMs);
  if (!raw || typeof raw !== "object") return { version: 2, entries: {} };
  const o = raw as Record<string, unknown>;
  const rawEntries =
    o.entries && typeof o.entries === "object" ? (o.entries as Record<string, unknown>) : {};
  const entries: Record<string, ContactRecord> = {};
  for (const value of Object.values(rawEntries)) {
    const record = normalizeRecord(value);
    if (record) entries[record.address.toLowerCase()] = record;
  }
  return { version: 2, entries };
}

// ── Persistence ─────────────────────────────────────────────────────────────

async function loadState(): Promise<AddressBookState> {
  if (cache) return cache;
  const now = Date.now();
  if (!isTauri()) {
    cache = loadBrowserState(now);
    return cache;
  }
  let raw: unknown;
  try {
    const store = await getStore();
    raw = await store.get<unknown>(STATE_KEY);
  } catch (cause) {
    throw new AddressBookCallError((cause as Error)?.message ?? String(cause));
  }
  const migrated = looksLikeV1(raw);
  cache = normalizeState(raw, now);
  // Persist the migrated shape immediately so the one-time conversion is not
  // redone on every launch.
  if (migrated) await saveState(cache);
  return cache;
}

async function saveState(state: AddressBookState): Promise<void> {
  cache = state;
  if (!isTauri()) {
    saveBrowserState(state);
    return;
  }
  try {
    const store = await getStore();
    await store.set(STATE_KEY, state);
    await store.save();
  } catch (cause) {
    throw new AddressBookCallError((cause as Error)?.message ?? String(cause));
  }
}

function loadBrowserState(nowMs: number): AddressBookState {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null"), nowMs);
  } catch {
    return { ...EMPTY_STATE, entries: {} };
  }
}

function saveBrowserState(state: AddressBookState): void {
  try {
    localStorage.setItem(BROWSER_KEY, JSON.stringify(state));
  } catch (cause) {
    throw new AddressBookCallError((cause as Error)?.message ?? String(cause));
  }
}

/** Test seam — drops the in-memory cache so a suite can observe a cold read. */
export function __resetAddressBookCacheForTest(): void {
  cache = null;
  storePromise = null;
}

// ── API ─────────────────────────────────────────────────────────────────────

function key(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Add a contact. Validation order is fixed and first-failure-wins, so the
 * message names the first thing actually wrong.
 *
 * There is deliberately no `overwrite` flag: replacing a contact is an explicit
 * edit, never an accidental side effect of re-adding.
 */
export async function addressbookAdd(input: AddressBookAddInput): Promise<ContactRecord> {
  const name = input.name.trim();
  if (name === "") throw new AddressBookCallError("Name is required.");
  if (name.length > MAX_NAME_LEN) {
    throw new AddressBookCallError("Name must be 64 characters or fewer.");
  }
  const note = input.note?.trim() ?? "";
  if (note.length > MAX_NOTE_LEN) {
    throw new AddressBookCallError("Note must be 256 characters or fewer.");
  }
  let address: string;
  try {
    address = requireTypedUserAddress(input.address.trim(), "address book entry");
  } catch (cause) {
    throw new AddressBookCallError((cause as Error)?.message ?? String(cause));
  }

  const state = await loadState();
  if (state.entries[key(address)]) {
    throw new AddressBookCallError("This address is already in your contacts.");
  }
  const record: ContactRecord = {
    address,
    name,
    note: note === "" ? null : note,
    tags: null,
    addedAt: Date.now(),
  };
  await saveState({ version: 2, entries: { ...state.entries, [key(address)]: record } });
  return record;
}

/** Rename a contact. Mutates only `name`; a missing key is a silent no-op. */
export async function addressbookRename(
  address: string,
  name: string,
): Promise<{ renamed: boolean }> {
  const trimmed = name.trim();
  if (trimmed === "") throw new AddressBookCallError("Name is required.");
  if (trimmed.length > MAX_NAME_LEN) {
    throw new AddressBookCallError("Name must be 64 characters or fewer.");
  }
  const state = await loadState();
  const existing = state.entries[key(address)];
  if (!existing) return { renamed: false };
  await saveState({
    version: 2,
    entries: { ...state.entries, [key(address)]: { ...existing, name: trimmed } },
  });
  return { renamed: true };
}

/** Edit a contact's note. An empty note removes the field. */
export async function addressbookEditNote(
  address: string,
  note: string,
): Promise<{ edited: boolean }> {
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_LEN) {
    throw new AddressBookCallError("Note must be 256 characters or fewer.");
  }
  const state = await loadState();
  const existing = state.entries[key(address)];
  if (!existing) return { edited: false };
  await saveState({
    version: 2,
    entries: {
      ...state.entries,
      [key(address)]: { ...existing, note: trimmed === "" ? null : trimmed },
    },
  });
  return { edited: true };
}

/** Remove a contact by ADDRESS. Idempotent. */
export async function addressbookRemove(address: string): Promise<{ removed: boolean }> {
  const k = key(address);
  if (k === "") throw new AddressBookCallError("Address is required.");
  const state = await loadState();
  if (!state.entries[k]) return { removed: false };
  const next = { ...state.entries };
  delete next[k];
  await saveState({ version: 2, entries: next });
  return { removed: true };
}

/** Most-recently-used first. A never-used contact falls back to `addedAt`, so a
 *  freshly added record surfaces at the top rather than sinking to the bottom. */
export async function addressbookLookup(query?: string): Promise<ContactRecord[]> {
  const state = await loadState();
  const rows = Object.values(state.entries).sort(
    (a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt),
  );
  const q = query?.trim().toLowerCase() ?? "";
  if (q === "") return rows;
  return rows.filter((entry) =>
    [entry.name, entry.address, entry.note ?? "", ...(entry.tags ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}

/** O(1) exact lookup — the seam every address-labelling surface uses. */
export async function addressbookGetByAddress(address: string): Promise<ContactRecord | null> {
  const k = key(address);
  if (k === "") return null;
  const state = await loadState();
  return state.entries[k] ?? null;
}

/** Bump `lastUsedAt`. Called ONLY from the send SUCCESS path — never on a
 *  failure or a rejection, so the MRU order reflects real sends. A missing key
 *  is a silent no-op. */
export async function markContactUsed(address: string): Promise<void> {
  const k = key(address);
  if (k === "") return;
  const state = await loadState();
  const existing = state.entries[k];
  if (!existing) return;
  await saveState({
    version: 2,
    entries: { ...state.entries, [k]: { ...existing, lastUsedAt: Date.now() } },
  });
}
