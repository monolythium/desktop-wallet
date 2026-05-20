// useVaults — tiny React hook over the multi-vault SDK.
//
// Maintains the list of vaults + the active vault id in component
// state, refreshes on demand. Exposes typed actions that wrap the
// Tauri commands so call-sites don't have to import the SDK module
// directly.
//
// The hook also tracks a module-level `lockedFlag` — the in-memory
// MEK existence is Rust-side state, so we mirror it here for the UI.
// `lock()` sets it true; successful `unlock()` sets it false; every
// new tab starts locked (the Rust process boots with mek=None too).

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  createVaultMulti,
  deleteVault,
  listVaults,
  lockVault,
  migrateLegacyVault,
  MultiVaultCallError,
  renameVault,
  selectVault,
  type VaultSummary,
  unlockVaultMulti,
} from "./vault-multi";

interface VaultsState {
  status: "loading" | "ready" | "error";
  vaults: VaultSummary[];
  error: MultiVaultCallError | null;
}

export interface UseVaultsApi {
  state: VaultsState;
  /** The active vault (`isActive: true`) or null when none. */
  active: VaultSummary | null;
  /** Derived UI state — true when the Rust-side MEK has been wiped
   *  (i.e. `lock()` ran) or the wallet was just launched. Successful
   *  `unlock()` flips this false; `lock()` flips it true. */
  isLocked: boolean;
  /** Re-pull the list from disk. */
  refresh: () => Promise<void>;
  /** Switch active vault by id. Auto-refreshes on success. */
  select: (id: string) => Promise<void>;
  /** Verify the master password + load the in-process MEK. */
  unlock: (password: string) => Promise<void>;
  /** Wipe the in-process MEK. */
  lock: () => Promise<void>;
  /** Create a new vault. The caller derives the 32-byte ML-DSA seed
   *  via the existing PQM-1 path and passes it in. */
  create: (args: {
    label: string;
    password: string;
    seed: Uint8Array;
    address: string;
  }) => Promise<void>;
  /** Rename. */
  rename: (id: string, newLabel: string) => Promise<void>;
  /** Delete. Caller supplies the confirmation token (last 4 chars
   *  of the lowercased address). */
  remove: (id: string, confirmToken: string) => Promise<void>;
  /** Migrate the legacy single-vault keystore into the v1 container. */
  migrateLegacy: (args: {
    seed: Uint8Array;
    password: string;
    label: string;
    address: string;
  }) => Promise<void>;
}

// ─── Module-level locked flag ──────────────────────────────────────
// Shared across every consumer of `useVaults` in the same tab.
// Initial value: true — both the Rust process and the lock screen
// start locked.

let lockedFlag = true;
const lockListeners = new Set<() => void>();

function subscribeLocked(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}

function getLockedSnapshot(): boolean {
  return lockedFlag;
}

function setLocked(v: boolean): void {
  if (lockedFlag === v) return;
  lockedFlag = v;
  for (const l of lockListeners) l();
}

/** Test-only — reset the lock flag back to default (locked). */
export function _resetLockedForTest(): void {
  setLocked(true);
}

export function useVaults(): UseVaultsApi {
  const [state, setState] = useState<VaultsState>({
    status: "loading",
    vaults: [],
    error: null,
  });

  const isLocked = useSyncExternalStore(subscribeLocked, getLockedSnapshot, getLockedSnapshot);

  const refresh = useCallback(async () => {
    try {
      const vaults = await listVaults();
      setState({ status: "ready", vaults, error: null });
    } catch (cause) {
      const err = cause instanceof MultiVaultCallError
        ? cause
        : new MultiVaultCallError({ code: "backend", message: String(cause) });
      setState({ status: "error", vaults: [], error: err });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(
    async (id: string) => {
      await selectVault(id);
      await refresh();
    },
    [refresh],
  );

  const unlock = useCallback(
    async (password: string) => {
      await unlockVaultMulti(password);
      setLocked(false);
      await refresh();
    },
    [refresh],
  );

  const lock = useCallback(async () => {
    await lockVault();
    setLocked(true);
    await refresh();
  }, [refresh]);

  const create = useCallback(
    async (args: {
      label: string;
      password: string;
      seed: Uint8Array;
      address: string;
    }) => {
      await createVaultMulti(args);
      // Successful create implies unlock — Rust side caches the MEK.
      setLocked(false);
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, newLabel: string) => {
      await renameVault(id, newLabel);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string, confirmToken: string) => {
      await deleteVault(id, confirmToken);
      await refresh();
    },
    [refresh],
  );

  const migrateLegacy = useCallback(
    async (args: {
      seed: Uint8Array;
      password: string;
      label: string;
      address: string;
    }) => {
      await migrateLegacyVault(args);
      setLocked(false);
      await refresh();
    },
    [refresh],
  );

  const active = state.vaults.find((v) => v.isActive) ?? null;

  return {
    state,
    active,
    isLocked,
    refresh,
    select,
    unlock,
    lock,
    create,
    rename,
    remove,
    migrateLegacy,
  };
}
