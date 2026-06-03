// Vault bridge — typed wrapper around the Tauri commands defined in
// `src-tauri/src/vault.rs`.
//
// The vault stores an XChaCha20-Poly1305-encrypted seed, with the key derived
// from the user's password via Argon2id (OWASP 2024 desktop params).
// What the OS keychain holds is the encrypted blob — the password itself
// is never persisted.
//
//   createVault(password)             → vault blob bytes
//   createVaultFromSeed(password, seed) → vault blob bytes
//   unlockVault(password, blob)       → seed | wrong_password
//
// Onboarding calls `createVault`, then hands the bytes to the existing
// `keychain_store` command. The OperationsDrawer auth stage calls
// `keychain_unlock` to fetch the blob, then `unlockVault(password, blob)`
// to recover the seed for the operation being approved.

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
 * Seal a caller-provided 32-byte seed. New wallet creation uses this after
 * deriving the seed from a PQM-1 mnemonic in the TypeScript SDK.
 */
export async function createVaultFromSeed(password: string, seed: Uint8Array): Promise<Uint8Array> {
  if (!password) {
    throw new VaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  if (seed.length !== 32) {
    throw new VaultCallError({ code: "invalid_argument", message: `seed must be 32 bytes, got ${seed.length}` });
  }
  try {
    const bytes = await invoke<number[]>("vault_seal_seed", {
      password,
      seedBytes: Array.from(seed),
    });
    return new Uint8Array(bytes);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Verify `password` decrypts `blob` and return the 32-byte seed. Throws
 * `VaultCallError` with `cause.code === "wrong_password"` on either bad
 * password or tampered blob. Other codes mean the call itself failed.
 */
export async function unlockVault(password: string, blob: Uint8Array): Promise<Uint8Array> {
  if (!password) {
    throw new VaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  try {
    const seed = await invoke<number[]>("vault_unlock", {
      password,
      blobBytes: Array.from(blob),
    });
    return new Uint8Array(seed);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/**
 * Seal a 32-byte seed and, optionally, the 32-byte PQM-1 payload that makes
 * the recovery phrase revealable. New wallet creation / import uses this:
 * pass the payload to get a reveal-capable vault, or `null` for seed-only.
 */
export async function createVaultV2(
  password: string,
  seed: Uint8Array,
  payload: Uint8Array | null,
): Promise<Uint8Array> {
  if (!password) {
    throw new VaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  if (seed.length !== 32) {
    throw new VaultCallError({ code: "invalid_argument", message: `seed must be 32 bytes, got ${seed.length}` });
  }
  if (payload && payload.length !== 32) {
    throw new VaultCallError({ code: "invalid_argument", message: `payload must be 32 bytes, got ${payload.length}` });
  }
  try {
    const bytes = await invoke<number[]>("vault_seal_v2", {
      password,
      seedBytes: Array.from(seed),
      payloadBytes: payload ? Array.from(payload) : null,
    });
    return new Uint8Array(bytes);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Outcome of `vault_reveal`: either the 32-byte PQM-1 payload, or a signal
 *  that the vault was sealed without one (seed-only → no phrase to show).
 *  Shape matches the Rust `RevealResult` (serde `kind` discriminator). */
export type RevealResult =
  | { kind: "payload"; payload: number[] }
  | { kind: "no_recovery_material" };

/**
 * Decrypt `blob` and return the recovery payload if it was sealed. Distinct
 * from `unlockVault` so the signing path never carries the payload. Throws
 * `VaultCallError` with `cause.code === "wrong_password"` on a bad password.
 */
export async function revealVault(password: string, blob: Uint8Array): Promise<RevealResult> {
  if (!password) {
    throw new VaultCallError({ code: "invalid_argument", message: "password is empty" });
  }
  try {
    return await invoke<RevealResult>("vault_reveal", {
      password,
      blobBytes: Array.from(blob),
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}
