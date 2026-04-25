// Vault bridge — typed wrapper around the Tauri commands defined in
// `src-tauri/src/vault.rs`.
//
// The vault stores an AES-256-GCM-encrypted seed, with the key derived
// from the user's password via Argon2id (OWASP 2024 desktop params).
// What the OS keychain holds is the encrypted blob — the password itself
// is never persisted.
//
//   createVault(password)         → vault blob bytes
//   unlockVault(password, blob)   → ok | wrong_password
//
// Onboarding calls `createVault`, then hands the bytes to the existing
// `keychain_store` command. The OperationsDrawer auth stage calls
// `keychain_unlock` to fetch the blob, then `unlockVault(password, blob)`
// to verify the password before advancing.

import { invoke } from "@tauri-apps/api/core";

/** Discriminated union of every typed error the Rust vault module returns. */
export type VaultError =
  | { code: "wrong_password" }
  | { code: "invalid_argument"; message: string }
  | { code: "backend"; message: string };

/** Wraps a raw `invoke` rejection. JSON shape matches the Rust enum. */
export class VaultCallError extends Error {
  override readonly cause: VaultError;
  constructor(cause: VaultError) {
    super(messageFor(cause));
    this.name = "VaultCallError";
    this.cause = cause;
  }
}

function messageFor(e: VaultError): string {
  switch (e.code) {
    case "wrong_password":
      return "Wrong password.";
    case "invalid_argument":
      return `Invalid argument: ${e.message}`;
    case "backend":
      return `Vault backend error: ${e.message}`;
  }
}

function normalizeError(raw: unknown): VaultCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new VaultCallError(raw as VaultError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new VaultCallError({ code: "backend", message });
}

/**
 * Build a fresh vault sealed with `password`. The seed is generated
 * inside Rust via `OsRng` and never returned — the caller stores the
 * returned bytes verbatim in the OS keychain.
 */
export async function createVault(password: string): Promise<Uint8Array> {
  if (!password) {
    throw new VaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  try {
    const bytes = await invoke<number[]>("vault_create", { password });
    return new Uint8Array(bytes);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Verify `password` decrypts `blob`. Throws `VaultCallError` with
 * `cause.code === "wrong_password"` on either bad password or tampered
 * blob. Other codes mean the call itself failed (e.g. backend bug).
 */
export async function unlockVault(password: string, blob: Uint8Array): Promise<void> {
  if (!password) {
    throw new VaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  try {
    await invoke<void>("vault_unlock", {
      password,
      blobBytes: Array.from(blob),
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}
