// The wallet's own JSON store seam — a store is named by IDENTIFIER, never by path.
//
// This replaces `@tauri-apps/plugin-store`. The plugin's `load` command took the
// file path from the caller and resolved it with a bare push onto the app-data
// directory, so an absolute, UNC or drive-relative path discarded the base
// entirely and `..` survived — reaching both a read and a write. The plugin
// ships no scope mechanism, so no capability edit could constrain it; the only
// remedy was to stop sending it a path.
//
// Here the frontend sends one of a closed set of identifiers and the Rust side
// owns the filename and the directory. There is no argument through which a
// path could arrive.
//
// SHARED INSTANCES ARE LOAD-BEARING, not a cache optimisation. Each store module
// memoises its own handle, and `wipe-local-state.ts` opens every store a SECOND
// time to clear it. Under the plugin those two loads returned the same
// underlying store. If they returned independent in-memory documents here, a
// wipe could clear one copy while a module still held the old contents and
// later wrote them back — resurrecting data a reset had promised to remove. So
// `load` returns one instance per identifier, per process.

import { invoke } from "@tauri-apps/api/core";

/**
 * Every store this wallet owns. Must stay in step with `STORES` in
 * `src-tauri/src/wallet_store.rs`; a Rust test pins the filenames and a
 * frontend guard pins this list against the identifiers Rust accepts.
 */
export const WALLET_STORE_IDS = [
  "vaults",
  "addressbook",
  "notifications",
  "activity",
  "chain-health",
  "sent-recipients",
  "names",
  "pending-tx",
  "balance",
  "agents",
] as const;

export type WalletStoreId = (typeof WALLET_STORE_IDS)[number];

/** The on-disk shape: a flat map of key to JSON value. */
type StoreDocument = Record<string, unknown>;

const instances = new Map<WalletStoreId, Promise<WalletStore>>();

/**
 * A single JSON store, loaded once per identifier per process.
 *
 * The surface is deliberately the four operations the wallet actually performs
 * — `get`, `set`, `save`, `clear`. The plugin exposed thirteen commands; the
 * wallet used four, and every unused one was a command a compromised renderer
 * could reach.
 */
export class WalletStore {
  private constructor(
    private readonly id: WalletStoreId,
    private document: StoreDocument,
  ) {}

  /** Load a store by identifier. Repeat calls return the same instance. */
  static load(id: WalletStoreId): Promise<WalletStore> {
    const existing = instances.get(id);
    if (existing) return existing;
    const created = (async () => {
      const document = await invoke<StoreDocument>("wallet_store_read", { storeId: id });
      return new WalletStore(id, document ?? {});
    })();
    instances.set(id, created);
    // A failed load must not poison the identifier forever — drop the rejected
    // promise so the next caller retries rather than inheriting the failure.
    void created.catch(() => instances.delete(id));
    return created;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.document[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.document[key] = value;
  }

  async save(): Promise<void> {
    await invoke("wallet_store_write", { storeId: this.id, contents: this.document });
  }

  /** Drop every key. The caller still has to `save()` to persist it, matching
   *  the semantics the wipe path was written against. */
  async clear(): Promise<void> {
    this.document = {};
  }
}

/** Test seam: forget every loaded instance. Only tests call this — the running
 *  app holds its stores for the life of the process. */
export function __resetWalletStoresForTest(): void {
  instances.clear();
}
