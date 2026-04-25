// OS keychain bridge — typed wrapper around the Tauri commands defined in
// `src-tauri/src/keychain.rs`. Stage 3 ships software-bound entries; Stage 4
// will add hardware-bound paths (Secure Enclave on macOS, TPM on Windows).
//
// The two callable surfaces:
//
//   unlock(account)         → secret bytes
//   store(account, secret)  → ok
//
// Errors are typed (`KeychainError`) so the OperationsDrawer can decide
// whether to retry, bounce into onboarding, or render a hard error.

import { invoke } from "@tauri-apps/api/core";

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
 * Retrieve the secret bytes for `account`. Throws `KeychainCallError`
 * with a typed `cause` on failure.
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
 * Onboarding helper: derive a 32-byte seed from a user-entered password
 * via SHA-256, then store it under `account`.
 *
 * NOTE — Stage 3 keeps derivation deliberately minimal. Stage 4 will swap
 * SHA-256 for Argon2id and add a per-install salt; the function shape is
 * stable so call sites won't move.
 */
export async function deriveAndStorePassword(account: string, password: string): Promise<void> {
  if (!password) {
    throw new KeychainCallError({ code: "invalid_argument", message: "password is empty" });
  }
  const enc = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  await store(account, new Uint8Array(digest));
}
