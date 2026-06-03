// OS keychain bridge — typed wrapper around the Tauri commands defined in
// `src-tauri/src/keychain.rs`. Stage 4 wires this together with the vault
// commands (`src-tauri/src/vault.rs`): the keychain stores the
// XChaCha20-Poly1305-encrypted blob, never raw seed material.
//
// The two callable surfaces:
//
//   unlock(account)         → vault blob bytes
//   store(account, blob)    → ok
//
// Errors are typed (`KeychainError`) so the OperationsDrawer can decide
// whether to retry, bounce into onboarding, or render a hard error.

import { invoke } from "@tauri-apps/api/core";
import {
  MlDsa65Backend,
  generatePqm1Mnemonic,
  pqm1MnemonicToMlDsa65Seed,
  pqm1MnemonicToPayload,
  pqm1PayloadToMnemonic,
} from "@monolythium/core-sdk/crypto";
import { createVaultV2, revealVault, unlockVault, VaultCallError } from "./vault";

/** Legacy / first-install slot. New vaults mint fresh slot ids via
 *  `mintVaultSlot()` in vaultCatalog.ts; this constant stays as the
 *  migration anchor for installs that predate the multi-vault catalog. */
export const PRIMARY_ACCOUNT = "kc:lyth:primary:v1";

/**
 * In-memory active-slot cache. Boot (`App.tsx`) loads the catalog and
 * calls `setActiveAccount(catalog.activeSlot)`; the OperationsDrawer
 * + Onboarding read this synchronously so a write operation always
 * targets the slot the UI is showing as active.
 */
let _activeAccount = PRIMARY_ACCOUNT;

export function getActiveAccount(): string {
  return _activeAccount;
}

export function setActiveAccount(slot: string): void {
  _activeAccount = slot;
}

/** Discriminated union of every typed error the Rust side may return. */
export type KeychainError =
  | { code: "not_found"; account: string }
  | { code: "user_cancelled" }
  | { code: "backend"; message: string }
  | { code: "invalid_argument"; message: string };

/**
 * Wraps a raw `invoke` rejection. The Rust side serializes
 * `KeychainError` with `serde(tag = "code")` so the JSON shape matches
 * the TypeScript discriminated union above.
 */
export class KeychainCallError extends Error {
  // `Error.cause` exists on the base type since lib.es2022; we narrow it
  // to our typed enum and provide a string `message` from `messageFor()`.
  override readonly cause: KeychainError;
  constructor(cause: KeychainError) {
    super(messageFor(cause));
    this.name = "KeychainCallError";
    this.cause = cause;
  }
}

function messageFor(e: KeychainError): string {
  switch (e.code) {
    case "not_found":
      return `No keychain entry for ${e.account}. Onboarding required.`;
    case "user_cancelled":
      return "Cancelled at the OS prompt.";
    case "backend":
      return `Keychain backend error: ${e.message}`;
    case "invalid_argument":
      return `Invalid keychain argument: ${e.message}`;
  }
}

function normalizeError(raw: unknown): KeychainCallError {
  // Rust returns the structured enum; everything else is a backend fallback.
  if (raw && typeof raw === "object" && "code" in raw) {
    return new KeychainCallError(raw as KeychainError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new KeychainCallError({ code: "backend", message });
}

/**
 * Retrieve the vault blob stored under `account`. Throws
 * `KeychainCallError` with a typed `cause` on failure. The bytes are
 * handed straight to `unlockVault`.
 */
export async function unlock(account: string): Promise<Uint8Array> {
  try {
    const bytes = await invoke<number[]>("keychain_unlock", { account });
    return new Uint8Array(bytes);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Persist `secret` bytes under `account`. Overwrites any existing entry.
 * Throws `KeychainCallError` with a typed `cause` on failure.
 */
export async function store(account: string, secret: Uint8Array): Promise<void> {
  try {
    await invoke<void>("keychain_store", {
      account,
      secret: Array.from(secret),
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Delete the keychain entry for `account`. Idempotent — no error if the
 * entry doesn't exist. Used by the Wallets-page Remove flow so dropping
 * a vault from the catalog also wipes the underlying encrypted blob.
 */
export async function deleteAccount(account: string): Promise<void> {
  try {
    await invoke<void>("keychain_delete", { account });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export interface CreateVaultOptions {
  /** Import an existing PQM-1 v1 mnemonic instead of generating one.
   *  pqm1MnemonicToMlDsa65Seed validates algo + version tags + word
   *  count; non-PQM-1-v1 phrases throw before any vault is created. */
  importMnemonic?: string;
}

/**
 * Onboarding helper: generate a fresh PQM-1 mnemonic (or accept an
 * imported one), derive the ML-DSA-65 seed in the TypeScript SDK, then
 * persist an Argon2id-protected vault. The reversible PQM-1 payload is
 * sealed beside the seed so the phrase can later be revealed in-app.
 * Returns the mnemonic + the 20-byte address (`0x…`) the seed maps to so
 * callers can show + verify the phrase AND register the vault in the
 * catalog without a second unlock.
 */
export async function createAndStoreVault(
  account: string,
  password: string,
  options: CreateVaultOptions = {},
): Promise<{ mnemonic: string; addressHex: string }> {
  const mnemonic = options.importMnemonic
    ? options.importMnemonic.trim()
    : generatePqm1Mnemonic();
  const seed = pqm1MnemonicToMlDsa65Seed(mnemonic);
  const payload = pqm1MnemonicToPayload(mnemonic).bytes;
  let addressHex: string;
  try {
    const backend = MlDsa65Backend.fromSeed(seed);
    addressHex = backend.getAddress().toLowerCase();
    const blob = await createVaultV2(password, seed, payload);
    await store(account, blob);
  } finally {
    seed.fill(0);
    payload.fill(0);
  }
  return { mnemonic, addressHex };
}

/** Outcome of a recovery-phrase reveal. `revealable` is false for a vault
 *  sealed without the payload (e.g. one created before in-app backup). */
export interface RevealOutcome {
  revealable: boolean;
  mnemonic?: string;
}

/**
 * Settings "Show recovery phrase": fetch the vault blob for `account` and,
 * if `password` decrypts it AND the recovery payload was sealed, return the
 * 24-word phrase. A seed-only vault returns `{ revealable: false }` — no
 * phrase to show. Throws `VaultCallError` (`wrong_password`) on a bad
 * password, like `fetchAndUnlockVault`.
 */
export async function revealRecoveryPhrase(
  account: string,
  password: string,
): Promise<RevealOutcome> {
  const blob = await unlock(account);
  const result = await revealVault(password, blob);
  if (result.kind === "payload") {
    const payload = Uint8Array.from(result.payload);
    try {
      return { revealable: true, mnemonic: pqm1PayloadToMnemonic(payload) };
    } finally {
      payload.fill(0);
      result.payload.fill(0);
    }
  }
  return { revealable: false };
}

/**
 * Auth helper: fetch the vault blob for `account` and verify `password`
 * decrypts it. Returns the operation-scoped 32-byte seed. Throws
 * `KeychainCallError` if the keychain lookup fails
 * (including `not_found` → onboarding cue), or `VaultCallError` with
 * `cause.code === "wrong_password"` if the password is wrong / blob is
 * tampered.
 */
export async function fetchAndUnlockVault(account: string, password: string): Promise<Uint8Array> {
  const blob = await unlock(account);
  return unlockVault(password, blob);
}

export { VaultCallError };
