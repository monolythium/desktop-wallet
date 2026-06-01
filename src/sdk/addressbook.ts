// Local address-book store for wallet contacts.
//
// Contacts are a wallet-level feature, not a Stele-only feature. Native
// builds persist through Tauri plugin-store; browser preview uses localStorage
// so the management surface stays usable without the Tauri host.

import { Store } from "@tauri-apps/plugin-store";
import { requireTypedUserAddress } from "./address";

const STORE_FILE = "addressbook.v1.json";
const STATE_KEY = "state";
const BROWSER_KEY = "wallet.addressbook.v1";

export class AddressBookCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressBookCallError";
  }
}

export interface AddressBookEntry {
  name: string;
  address: string;
  note?: string | null;
  tags?: string[] | null;
}

export interface AddressBookAddInput {
  name: string;
  address: string;
  note?: string | null;
  tags?: string[] | null;
  overwrite?: boolean | null;
}

interface AddressBookState {
  version: 1;
  entries: Record<string, AddressBookEntry>;
}

const EMPTY_STATE: AddressBookState = { version: 1, entries: {} };

let storePromise: Promise<Store> | null = null;
let cache: AddressBookState | null = null;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

function normalizeState(raw: unknown): AddressBookState {
  if (!raw || typeof raw !== "object") return { version: 1, entries: {} };
  const obj = raw as Record<string, unknown>;
  const entries = obj.entries && typeof obj.entries === "object"
    ? obj.entries as Record<string, unknown>
    : {};
  const normalized: Record<string, AddressBookEntry> = {};
  for (const value of Object.values(entries)) {
    const entry = normalizeEntry(value);
    if (entry) normalized[entry.name] = entry;
  }
  return { version: 1, entries: normalized };
}

function normalizeEntry(value: unknown): AddressBookEntry | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.name !== "string" || typeof obj.address !== "string") return null;
  const name = obj.name.trim();
  const address = obj.address.trim();
  if (!name || !address) return null;
  return {
    name,
    address,
    note: typeof obj.note === "string" && obj.note.trim() ? obj.note.trim() : null,
    tags: Array.isArray(obj.tags)
      ? obj.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : null,
  };
}

async function loadState(): Promise<AddressBookState> {
  if (cache) return cache;
  if (!isTauri()) {
    cache = loadBrowserState();
    return cache;
  }
  try {
    const store = await getStore();
    cache = normalizeState(await store.get<AddressBookState>(STATE_KEY));
  } catch (cause) {
    throw new AddressBookCallError((cause as Error)?.message ?? String(cause));
  }
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

function loadBrowserState(): AddressBookState {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(BROWSER_KEY) ?? "null"));
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

export async function addressbookAdd(input: AddressBookAddInput): Promise<AddressBookEntry> {
  const name = input.name.trim();
  const note = input.note?.trim() || null;
  const tags = input.tags?.map((tag) => tag.trim()).filter(Boolean) ?? null;
  let address: string;
  try {
    address = requireTypedUserAddress(input.address.trim(), "address book entry");
  } catch (cause) {
    throw new AddressBookCallError((cause as Error)?.message ?? String(cause));
  }
  if (!name) throw new AddressBookCallError("contact name is required");

  const state = await loadState();
  if (state.entries[name] && !input.overwrite) {
    throw new AddressBookCallError(`contact already exists: ${name}`);
  }
  const entry: AddressBookEntry = { name, address, note, tags };
  await saveState({
    version: 1,
    entries: { ...state.entries, [name]: entry },
  });
  return entry;
}

export async function addressbookLookup(query?: string): Promise<AddressBookEntry[]> {
  const state = await loadState();
  const q = query?.trim().toLowerCase() ?? "";
  const rows = Object.values(state.entries).sort((a, b) => a.name.localeCompare(b.name));
  if (!q) return rows;
  return rows.filter((entry) => {
    const haystack = [
      entry.name,
      entry.address,
      entry.note ?? "",
      ...(entry.tags ?? []),
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

export async function addressbookRemove(name: string): Promise<{ removed: boolean }> {
  const key = name.trim();
  if (!key) throw new AddressBookCallError("contact name is required");
  const state = await loadState();
  if (!state.entries[key]) return { removed: false };
  const next = { ...state.entries };
  delete next[key];
  await saveState({ version: 1, entries: next });
  return { removed: true };
}
