// Vault catalog — multi-vault address book backed by Tauri plugin-store.
//
// The OS keychain owns the encrypted vault blobs (one per account slot);
// the catalog tracks the *list* of slots with user-facing labels and
// derived addresses so the UI can render a Wallets picker without
// touching key material.
//
// Schema (file `vaults.v1.json`):
//
//   {
//     "version": 1,
//     "vaults": {
//       "<slot>": {
//         "slot":         string,   // keychain account slot
//         "name":         string,   // user label
//         "addressHex":   string | null,  // hex `0x…`, null if not yet captured
//         "createdAt":    number,   // ms epoch
//         "kind":         "local"   // future: "ledger" | "passkey"
//       },
//       ...
//     },
//     "activeSlot": string | null
//   }
//
// Address is captured at create / import time (we derive from the seed
// in-memory before writing) so the UI can render `mono1…` for every
// vault without a password prompt. Legacy installs whose keychain holds
// a vault but whose catalog is empty get an `addressHex: null` entry
// that fills in lazily on first unlock.

import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "vaults.v1.json";
const STATE_KEY = "state";

export type VaultKind = "local";

export interface VaultEntry {
  /** Keychain account slot (e.g. "kc:lyth:primary:v1"). */
  slot: string;
  /** User-facing label. */
  name: string;
  /** Internal 20-byte address (`0x…`). null until first unlock captures it. */
  addressHex: string | null;
  createdAt: number;
  kind: VaultKind;
}

export interface CatalogState {
  version: 1;
  vaults: Record<string, VaultEntry>;
  activeSlot: string | null;
}

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

const EMPTY_STATE: CatalogState = {
  version: 1,
  vaults: {},
  activeSlot: null,
};

export async function loadCatalog(): Promise<CatalogState> {
  const store = await getStore();
  const raw = await store.get<CatalogState>(STATE_KEY);
  if (!raw || typeof raw !== "object") return { ...EMPTY_STATE };
  return {
    version: 1,
    vaults: (raw.vaults && typeof raw.vaults === "object") ? raw.vaults : {},
    activeSlot:
      typeof raw.activeSlot === "string" && raw.activeSlot in raw.vaults
        ? raw.activeSlot
        : Object.keys(raw.vaults ?? {})[0] ?? null,
  };
}

async function saveCatalog(state: CatalogState): Promise<void> {
  const store = await getStore();
  await store.set(STATE_KEY, state);
  await store.save();
}

export async function listVaults(): Promise<VaultEntry[]> {
  const state = await loadCatalog();
  return Object.values(state.vaults).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getActiveVault(): Promise<VaultEntry | null> {
  const state = await loadCatalog();
  if (state.activeSlot && state.activeSlot in state.vaults) {
    return state.vaults[state.activeSlot]!;
  }
  // Empty catalog or active slot pointing nowhere.
  return null;
}

export interface RegisterVaultInput {
  slot: string;
  name: string;
  addressHex: string;
}

/**
 * Add a vault entry to the catalog and (if it's the first one OR the
 * caller asks) set it as active. Idempotent on `slot` — existing
 * entries are replaced.
 */
export async function registerVault(
  input: RegisterVaultInput,
  options: { setActive?: boolean } = {},
): Promise<CatalogState> {
  const state = await loadCatalog();
  const entry: VaultEntry = {
    slot: input.slot,
    name: input.name.trim(),
    addressHex: input.addressHex.toLowerCase(),
    createdAt: Date.now(),
    kind: "local",
  };
  state.vaults[input.slot] = entry;
  if (options.setActive || state.activeSlot === null) {
    state.activeSlot = input.slot;
  }
  await saveCatalog(state);
  return state;
}

/**
 * Migration helper: when the catalog is empty but a legacy
 * PRIMARY_ACCOUNT keychain entry exists, drop a placeholder vault in
 * the catalog with `addressHex: null`. The first unlock fills it in
 * via `captureAddressOnUnlock`.
 */
export async function ensureLegacyVaultRegistered(
  legacySlot: string,
): Promise<CatalogState> {
  const state = await loadCatalog();
  if (Object.keys(state.vaults).length > 0) return state;
  state.vaults[legacySlot] = {
    slot: legacySlot,
    name: "Main wallet",
    addressHex: null,
    createdAt: Date.now(),
    kind: "local",
  };
  state.activeSlot = legacySlot;
  await saveCatalog(state);
  return state;
}

/**
 * Lazy address fill — when an unlock surfaces the seed, we know the
 * address; persist it back to the catalog so future renders avoid a
 * keychain round-trip.
 */
export async function captureAddressOnUnlock(
  slot: string,
  addressHex: string,
): Promise<void> {
  const state = await loadCatalog();
  const entry = state.vaults[slot];
  if (!entry) return;
  if (entry.addressHex === addressHex.toLowerCase()) return;
  entry.addressHex = addressHex.toLowerCase();
  await saveCatalog(state);
}

export async function setActiveVault(slot: string): Promise<void> {
  const state = await loadCatalog();
  if (!(slot in state.vaults)) {
    throw new Error(`vault slot not in catalog: ${slot}`);
  }
  state.activeSlot = slot;
  await saveCatalog(state);
}

export async function renameVault(slot: string, newName: string): Promise<void> {
  const state = await loadCatalog();
  const entry = state.vaults[slot];
  if (!entry) return;
  const trimmed = newName.trim();
  if (trimmed.length === 0) throw new Error("name is required");
  if (trimmed.length > 64) throw new Error("name must be 64 characters or fewer");
  entry.name = trimmed;
  await saveCatalog(state);
}

export async function removeVaultFromCatalog(slot: string): Promise<void> {
  const state = await loadCatalog();
  if (!(slot in state.vaults)) return;
  delete state.vaults[slot];
  if (state.activeSlot === slot) {
    state.activeSlot = Object.keys(state.vaults)[0] ?? null;
  }
  await saveCatalog(state);
}

/** Generate a fresh `kc:lyth:<short-id>:v1` slot id. */
export function mintVaultSlot(): string {
  const rand = new Uint8Array(8);
  crypto.getRandomValues(rand);
  let hex = "";
  for (const b of rand) hex += b.toString(16).padStart(2, "0");
  return `kc:lyth:${hex}:v1`;
}
