// TypeScript bindings for the Phase 5 multi-vault Tauri commands.
//
// Layered on top of the existing single-vault `vault.ts` (which still
// powers the legacy single-vault path for the migration window).
// Phase 5 callers should prefer this module; once the migration helper
// (Rust Commit 9) has run, `vault.ts` only remains as a reference for
// the migration code itself.
//
// Surface mirrors `src-tauri/src/vault_multi/commands.rs`:
//
//   listVaults()                        → VaultSummary[]
//   selectVault(id)                     → VaultSummary
//   unlockVaultMulti(password)          → VaultSummary  (active vault)
//   lockVault()                         → void
//   createVaultMulti(label, password,   → VaultSummary
//                    seed, address)
//   renameVault(id, newLabel)           → void
//   deleteVault(id, confirmToken)       → void
//
// All errors flow back as `VaultCallError` (Phase 4 type, extended in
// Commit 6 below to cover the new error codes `no_container`,
// `empty_container`, and `not_found`).

import { invoke } from "@tauri-apps/api/core";

// ─── Public types ──────────────────────────────────────────────────

/** UI-facing summary returned by `vaults_list` / `vault_*` commands.
 *  No secret material — every field is already public. */
export interface VaultSummary {
  id: string;
  label: string;
  /** Lowercased 0x-hex address. */
  address: string;
  /** Unix seconds at creation. */
  createdAt: number;
  isActive: boolean;
}

/** Discriminated union of every typed error the Rust multi-vault
 *  module returns. Extends the Phase 4 `VaultError` shape with the new
 *  Phase 5 codes. */
export type MultiVaultError =
  | { code: "wrong_password" }
  | { code: "invalid_argument"; message: string }
  | { code: "no_container" }
  | { code: "empty_container" }
  | { code: "not_found"; id: string }
  | { code: "backend"; message: string };

export class MultiVaultCallError extends Error {
  override readonly cause: MultiVaultError;
  constructor(cause: MultiVaultError) {
    super(messageFor(cause));
    this.name = "MultiVaultCallError";
    this.cause = cause;
  }
}

function messageFor(e: MultiVaultError): string {
  switch (e.code) {
    case "wrong_password":
      return "Wrong password.";
    case "invalid_argument":
      return `Invalid argument: ${e.message}`;
    case "no_container":
      return "No vault container on disk — onboarding required.";
    case "empty_container":
      return "Vault container is empty.";
    case "not_found":
      return `Vault ${e.id} not found.`;
    case "backend":
      return `Vault backend error: ${e.message}`;
  }
}

function normalizeError(raw: unknown): MultiVaultCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new MultiVaultCallError(raw as MultiVaultError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new MultiVaultCallError({ code: "backend", message });
}

// ─── Wire-shape mappers ────────────────────────────────────────────
// The Rust struct uses snake_case (`is_active`, `created_at`); the TS
// side normalizes to camelCase at the IPC boundary so call-sites
// don't sprinkle `snake_case` properties through the React tree.

interface VaultSummaryWire {
  id: string;
  label: string;
  address: string;
  created_at: number;
  is_active: boolean;
}

function fromWire(w: VaultSummaryWire): VaultSummary {
  return {
    id: w.id,
    label: w.label,
    address: w.address,
    createdAt: w.created_at,
    isActive: w.is_active,
  };
}

// ─── Public command wrappers ───────────────────────────────────────

/** List every vault currently in the container. Empty list when no
 *  container has been created yet — caller bounces to onboarding. */
export async function listVaults(): Promise<VaultSummary[]> {
  try {
    const wire = await invoke<VaultSummaryWire[]>("vaults_list");
    return wire.map(fromWire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Switch the active vault. Requires the container to be unlocked
 *  (i.e. `unlockVaultMulti` ran successfully). */
export async function selectVault(id: string): Promise<VaultSummary> {
  try {
    const wire = await invoke<VaultSummaryWire>("vault_select", { vaultId: id });
    return fromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Verify master password + load the in-process MEK. Returns the
 *  active vault's summary. Wrong password collapses to
 *  `cause.code === "wrong_password"`. */
export async function unlockVaultMulti(password: string): Promise<VaultSummary> {
  if (!password) {
    throw new MultiVaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  try {
    const wire = await invoke<VaultSummaryWire>("vault_unlock_multi", { password });
    return fromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Wipe the in-process MEK. Container stays on disk; vault is "locked"
 *  but `listVaults` still works (the UI shows the picker without
 *  requiring auth). */
export async function lockVault(): Promise<void> {
  try {
    await invoke<void>("vault_lock");
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Create a new vault under the existing master password (or set the
 *  master if this is the first vault). The caller derives the 32-byte
 *  ML-DSA-65 seed from a PQM-1 mnemonic via the existing Phase 1 path
 *  and passes it in. */
export async function createVaultMulti(args: {
  label: string;
  password: string;
  seed: Uint8Array;
  address: string;
}): Promise<VaultSummary> {
  if (!args.label) {
    throw new MultiVaultCallError({ code: "invalid_argument", message: "label is empty" });
  }
  if (!args.password) {
    throw new MultiVaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  if (args.seed.length !== 32) {
    throw new MultiVaultCallError({
      code: "invalid_argument",
      message: `seed must be 32 bytes, got ${args.seed.length}`,
    });
  }
  try {
    const wire = await invoke<VaultSummaryWire>("vault_create_multi", {
      label: args.label,
      password: args.password,
      seed: Array.from(args.seed),
      address: args.address,
    });
    return fromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Rename a vault — pure metadata update, no password required. */
export async function renameVault(id: string, newLabel: string): Promise<void> {
  if (!newLabel) {
    throw new MultiVaultCallError({ code: "invalid_argument", message: "label is empty" });
  }
  try {
    await invoke<void>("vault_rename", { vaultId: id, newLabel });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Delete a vault. `confirmToken` must equal the last 4 chars of the
 *  lowercased address — anti-fat-finger gate. Last-vault protection is
 *  enforced Rust-side. */
export async function deleteVault(id: string, confirmToken: string): Promise<void> {
  try {
    await invoke<void>("vault_delete", { vaultId: id, confirmToken });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Lazy migration of the legacy single-vault keychain blob into the v1
 * container. Call sequence (TS-side):
 *
 *   1. `fetchAndUnlockVault(PRIMARY_ACCOUNT, password)` — uses the
 *      Phase 1 legacy unlock to recover the 32-byte seed
 *   2. Derive the address from the seed (via the SDK's MlDsa65Backend)
 *   3. Call `migrateLegacyVault({ seed, password, label, address })`
 *
 * The Rust side builds a fresh v1 container, seals the seed under a
 * new VEK + wraps the VEK under a freshly-derived MEK, and persists
 * `vault.v1.json`. The legacy keychain entry is left untouched
 * (harmless once the container is the source of truth — Phase 6 can
 * purge it).
 */
export async function migrateLegacyVault(args: {
  seed: Uint8Array;
  password: string;
  label: string;
  address: string;
}): Promise<VaultSummary> {
  if (args.seed.length !== 32) {
    throw new MultiVaultCallError({
      code: "invalid_argument",
      message: `seed must be 32 bytes, got ${args.seed.length}`,
    });
  }
  if (!args.password) {
    throw new MultiVaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  try {
    const wire = await invoke<VaultSummaryWire>("vault_migrate_legacy", {
      seed: Array.from(args.seed),
      password: args.password,
      label: args.label,
      address: args.address,
    });
    return fromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

// ─── Helpers exposed for tests ─────────────────────────────────────

/** Test-only: round-trip the wire shape through the camelCase mapper.
 *  Useful for unit-testing call sites that ingest VaultSummary objects
 *  without booting Tauri. */
export function _vaultSummaryFromWireForTest(w: VaultSummaryWire): VaultSummary {
  return fromWire(w);
}
