// TypeScript bindings for the Phase 8 SLH-DSA emergency backup
// Tauri command surface + BIP-39 mnemonic helpers.
//
// Mirrors `src-tauri/src/slh_backup/commands.rs`:
//
//   slhEnrollBackup(vaultId, recoveryPassword)
//       -> { mnemonic, publicKey, createdAt }
//   slhGetBackupStatus(vaultId) -> SlhBackupStatus
//   slhTestRecovery(vaultId, recoveryPassword, mnemonic) -> boolean
//   slhRemoveBackup(vaultId, masterPassword, recoveryPassword) -> void
//
// All errors flow back as `SlhCallError`. The Rust enum
// `SlhCommandError` maps 1:1 to a TS discriminator under `cause.code`.
//
// Mnemonic encoding
// =================
// The Rust side returns the 32-byte BIP-39 entropy as a base64url
// string. This module turns that into a 24-word English BIP-39
// mnemonic via `@scure/bip39` so the UI can show the user words to
// write down. Recovery accepts either the words OR the raw entropy
// — we decode both into bytes before calling Rust.

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist as ENGLISH_WORDLIST } from "@scure/bip39/wordlists/english.js";

// ─── Public types ──────────────────────────────────────────────────

/** Status of the SLH-DSA emergency backup for a vault. */
export type SlhBackupStatus =
  | { kind: "not_enrolled" }
  | { kind: "enrolled"; createdAt: number }
  | { kind: "activated"; createdAt: number; activatedAt: number };

/** Result returned by `slhEnrollBackup`. The `mnemonic` is the 24-word
 *  BIP-39 phrase derived from the entropy — the user MUST write it
 *  down before navigating away from the enrolment flow, since the
 *  wallet does NOT persist the mnemonic in cleartext. */
export interface SlhEnrollResult {
  /** 24-word English BIP-39 mnemonic encoding the 32-byte entropy. */
  mnemonic: string;
  /** base64url-encoded 32-byte SLH-DSA public key. */
  publicKey: string;
  createdAt: number;
}

// ─── Errors ────────────────────────────────────────────────────────

export type SlhError =
  | { code: "vault_locked" }
  | { code: "vault_not_found"; id: string }
  | { code: "already_enrolled" }
  | { code: "not_enrolled" }
  | { code: "wrong_master_password" }
  | { code: "wrong_recovery_password" }
  | { code: "recovery_password_too_weak" }
  | { code: "invalid_entropy_length"; expected: number }
  | { code: "malformed" }
  | { code: "crypto" }
  | { code: "backend"; message: string };

export class SlhCallError extends Error {
  override readonly cause: SlhError;
  constructor(cause: SlhError) {
    super(messageFor(cause));
    this.name = "SlhCallError";
    this.cause = cause;
  }
}

function messageFor(e: SlhError): string {
  switch (e.code) {
    case "vault_locked":
      return "Vault is locked — unlock first.";
    case "vault_not_found":
      return `Vault ${e.id} not found.`;
    case "already_enrolled":
      return "An emergency backup is already enrolled for this vault.";
    case "not_enrolled":
      return "No emergency backup is enrolled for this vault.";
    case "wrong_master_password":
      return "Wrong master password.";
    case "wrong_recovery_password":
      return "Wrong recovery password.";
    case "recovery_password_too_weak":
      return "Recovery password must be at least 12 characters.";
    case "invalid_entropy_length":
      return `Entropy must be exactly ${e.expected} bytes.`;
    case "malformed":
      return "Payload is malformed.";
    case "crypto":
      return "Internal crypto error.";
    case "backend":
      return `Backup backend error: ${e.message}`;
  }
}

function normalizeError(raw: unknown): SlhCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new SlhCallError(raw as SlhError);
  }
  const message =
    typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new SlhCallError({ code: "backend", message });
}

// ─── Mnemonic / entropy helpers ────────────────────────────────────

function base64UrlToBytes(s: string): Uint8Array {
  // Convert base64url-no-pad to base64.
  let std = s.replace(/-/g, "+").replace(/_/g, "/");
  while (std.length % 4 !== 0) std += "=";
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Encode a 32-byte SLH-DSA backup entropy as a 24-word BIP-39
 *  English mnemonic. Exported for tests + the recovery-flow input
 *  validator. */
export function entropyToBackupMnemonic(entropy: Uint8Array): string {
  if (entropy.length !== 32) {
    throw new SlhCallError({ code: "invalid_entropy_length", expected: 32 });
  }
  return entropyToMnemonic(entropy, ENGLISH_WORDLIST);
}

/** Decode a 24-word BIP-39 mnemonic back into its 32-byte entropy.
 *  Throws `SlhCallError({ code: "malformed" })` on any decode error
 *  (wrong word count, unknown word, bad checksum). */
export function backupMnemonicToEntropy(mnemonic: string): Uint8Array {
  try {
    const ent = mnemonicToEntropy(mnemonic.trim(), ENGLISH_WORDLIST);
    if (ent.length !== 32) {
      throw new SlhCallError({
        code: "invalid_entropy_length",
        expected: 32,
      });
    }
    return ent;
  } catch (cause) {
    if (cause instanceof SlhCallError) throw cause;
    throw new SlhCallError({ code: "malformed" });
  }
}

// ─── Wire-shape mappers ────────────────────────────────────────────

interface SlhEnrollWire {
  entropy_b64: string;
  public_key_b64: string;
  created_at: number;
}

interface SlhBackupStatusWire {
  kind: "not_enrolled" | "enrolled" | "activated";
  created_at?: number;
  activated_at?: number;
}

function statusFromWire(w: SlhBackupStatusWire): SlhBackupStatus {
  switch (w.kind) {
    case "not_enrolled":
      return { kind: "not_enrolled" };
    case "enrolled":
      return { kind: "enrolled", createdAt: w.created_at ?? 0 };
    case "activated":
      return {
        kind: "activated",
        createdAt: w.created_at ?? 0,
        activatedAt: w.activated_at ?? 0,
      };
  }
}

export const _statusFromWireForTest = statusFromWire;
export const _bytesToBase64UrlForTest = bytesToBase64Url;
export const _base64UrlToBytesForTest = base64UrlToBytes;

// ─── Command wrappers ──────────────────────────────────────────────

/** Enroll a fresh emergency backup. Vault must be unlocked. The
 *  recovery password gates the entropy slot — store it separately
 *  from the master password. Returns the 24-word mnemonic for the
 *  user to write down. */
export async function slhEnrollBackup(args: {
  vaultId: string;
  recoveryPassword: string;
}): Promise<SlhEnrollResult> {
  if (args.recoveryPassword.length < 12) {
    throw new SlhCallError({ code: "recovery_password_too_weak" });
  }
  try {
    const wire = await invoke<SlhEnrollWire>("slh_enroll_backup", {
      vaultId: args.vaultId,
      recoveryPassword: args.recoveryPassword,
    });
    const entropy = base64UrlToBytes(wire.entropy_b64);
    const mnemonic = entropyToBackupMnemonic(entropy);
    // Best-effort wipe of the entropy buffer — not perfect (the
    // base64 string still lives in memory) but reduces the window.
    entropy.fill(0);
    return {
      mnemonic,
      publicKey: wire.public_key_b64,
      createdAt: wire.created_at,
    };
  } catch (raw) {
    if (raw instanceof SlhCallError) throw raw;
    throw normalizeError(raw);
  }
}

/** Get the current backup status. Works while the vault is locked. */
export async function slhGetBackupStatus(
  vaultId: string,
): Promise<SlhBackupStatus> {
  try {
    const wire = await invoke<SlhBackupStatusWire>("slh_get_backup_status", {
      vaultId,
    });
    return statusFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Non-destructive recovery rehearsal. Verifies the user can produce
 *  their recovery password + the 24-word mnemonic. Returns `true` iff
 *  both inputs match the enrolled backup. Does NOT activate the
 *  backup. */
export async function slhTestRecovery(args: {
  vaultId: string;
  recoveryPassword: string;
  mnemonic: string;
}): Promise<boolean> {
  let entropy: Uint8Array;
  try {
    entropy = backupMnemonicToEntropy(args.mnemonic);
  } catch (cause) {
    // Bad mnemonic — return false directly rather than surface the
    // malformed error; the UI can show a single "Invalid recovery
    // input" message.
    if (cause instanceof SlhCallError) return false;
    throw cause;
  }
  const entropyB64 = bytesToBase64Url(entropy);
  entropy.fill(0);
  try {
    return await invoke<boolean>("slh_test_recovery", {
      vaultId: args.vaultId,
      recoveryPassword: args.recoveryPassword,
      entropyB64,
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Remove the enrolled backup. Destructive — requires BOTH the
 *  master password AND the recovery password. */
export async function slhRemoveBackup(args: {
  vaultId: string;
  masterPassword: string;
  recoveryPassword: string;
}): Promise<void> {
  try {
    await invoke<void>("slh_remove_backup", {
      vaultId: args.vaultId,
      masterPassword: args.masterPassword,
      recoveryPassword: args.recoveryPassword,
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

// ─── Hook ───────────────────────────────────────────────────────────

/** Reactive view of the SLH-DSA backup for a vault. */
export function useSlhBackup(vaultId: string | null): {
  status: "idle" | "loading" | "ready" | "error";
  backup: SlhBackupStatus;
  error: SlhCallError | null;
  refresh: () => Promise<void>;
  enroll: (recoveryPassword: string) => Promise<SlhEnrollResult>;
  testRecovery: (args: {
    recoveryPassword: string;
    mnemonic: string;
  }) => Promise<boolean>;
  remove: (args: {
    masterPassword: string;
    recoveryPassword: string;
  }) => Promise<void>;
} {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    vaultId ? "loading" : "idle",
  );
  const [backup, setBackup] = useState<SlhBackupStatus>({ kind: "not_enrolled" });
  const [error, setError] = useState<SlhCallError | null>(null);

  const refresh = useCallback(async () => {
    if (!vaultId) {
      setBackup({ kind: "not_enrolled" });
      setStatus("idle");
      return;
    }
    setStatus("loading");
    try {
      const s = await slhGetBackupStatus(vaultId);
      setBackup(s);
      setError(null);
      setStatus("ready");
    } catch (cause) {
      const err =
        cause instanceof SlhCallError
          ? cause
          : new SlhCallError({ code: "backend", message: String(cause) });
      setError(err);
      setStatus("error");
    }
  }, [vaultId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enroll = useCallback(
    async (recoveryPassword: string) => {
      if (!vaultId) {
        throw new SlhCallError({ code: "vault_not_found", id: "" });
      }
      const result = await slhEnrollBackup({ vaultId, recoveryPassword });
      await refresh();
      return result;
    },
    [vaultId, refresh],
  );

  const testRecovery = useCallback(
    async (args: { recoveryPassword: string; mnemonic: string }) => {
      if (!vaultId) {
        throw new SlhCallError({ code: "vault_not_found", id: "" });
      }
      return slhTestRecovery({ vaultId, ...args });
    },
    [vaultId],
  );

  const remove = useCallback(
    async (args: { masterPassword: string; recoveryPassword: string }) => {
      if (!vaultId) {
        throw new SlhCallError({ code: "vault_not_found", id: "" });
      }
      await slhRemoveBackup({ vaultId, ...args });
      await refresh();
    },
    [vaultId, refresh],
  );

  return { status, backup, error, refresh, enroll, testRecovery, remove };
}
