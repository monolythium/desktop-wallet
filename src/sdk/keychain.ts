// OS keychain bridge — typed wrapper around the Tauri commands defined in
// `src-tauri/src/keychain.rs`. Stage 4 wires this together with the vault
// commands (`src-tauri/src/vault.rs`): the keychain stores the
// AES-GCM-encrypted blob, never raw seed material.
//
// The two callable surfaces:
//
//   unlock(account)         → vault blob bytes
//   store(account, blob)    → ok
//
// Errors are typed (`KeychainError`) so the OperationsDrawer can decide
// whether to retry, bounce into onboarding, or render a hard error.

import { invoke } from "@tauri-apps/api/core";
import { createVault, unlockVault, VaultCallError } from "./vault";

/** The canonical identity slot for the primary signing key. */
export const PRIMARY_ACCOUNT = "kc:lyth:primary:v1";

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
 * handed straight to `unlockVault` — the wallet never reads cleartext
 * seed material on the JS side.
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
 * Onboarding helper: build a fresh Argon2id-protected vault from
 * `password` and persist it under `account`. The seed is generated
 * inside Rust via `OsRng` and AES-GCM-encrypted before it ever leaves
 * the Rust side.
 */
export async function createAndStoreVault(account: string, password: string): Promise<void> {
  const blob = await createVault(password);
  await store(account, blob);
}

/**
 * Auth helper: fetch the vault blob for `account` and verify `password`
 * decrypts it. Throws `KeychainCallError` if the keychain lookup fails
 * (including `not_found` → onboarding cue), or `VaultCallError` with
 * `cause.code === "wrong_password"` if the password is wrong / blob is
 * tampered.
 */
export async function fetchAndUnlockVault(account: string, password: string): Promise<void> {
  const blob = await unlock(account);
  await unlockVault(password, blob);
}

export { VaultCallError };
