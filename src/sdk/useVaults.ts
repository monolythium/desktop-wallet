// useVaults — tiny React hook over the multi-vault SDK.
//
// Maintains the list of vaults + the active vault id in component
// state, refreshes on demand. Exposes typed actions that wrap the
// Tauri commands so call-sites don't have to import the SDK module
// directly.
//
// The hook intentionally avoids a global event-bus pattern: every
// mutating action calls `refresh()` after it resolves, and callers
// that want cross-component reactivity bump a shared `refreshKey`
// (Phase 3 contacts / Phase 4 tokens convention).

import { useCallback, useEffect, useState } from "react";
import {
  createVaultMulti,
  deleteVault,
  listVaults,
  lockVault,
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
}

export function useVaults(): UseVaultsApi {
  const [state, setState] = useState<VaultsState>({
    status: "loading",
    vaults: [],
    error: null,
  });

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
      await refresh();
    },
    [refresh],
  );

  const lock = useCallback(async () => {
    await lockVault();
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

  const active = state.vaults.find((v) => v.isActive) ?? null;

  return { state, active, refresh, select, unlock, lock, create, rename, remove };
}
