// TypeScript bindings for the Phase 8 passkey Tauri command surface.
//
// Mirrors `src-tauri/src/passkey/commands.rs`:
//
//   listPasskeys(vaultId)                        → PasskeySummary[]
//   enrollPasskey(vaultId, label, deviceName?)   → PasskeySummary
//   renamePasskey(vaultId, credId, newLabel)     → PasskeySummary
//   removePasskey(vaultId, credId, password)     → void
//   createPasskeyChallenge(payloadHashHex)       → AuthChallenge
//   attestPasskey(vaultId, credId, challenge)    → Assertion
//
// All errors flow back as `PasskeyCallError`. The Rust-side error
// enum is `PasskeyCommandError` — every variant maps 1:1 to a TS
// discriminator under `cause.code`.
//
// Hooks
// =====
//   usePasskeys(vaultId)  — reactive summary list + actions
//   useChallenge()        — exposes `triggerHighValueChallenge` for
//                           the OperationsDrawer (Commit 5)

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

// ─── Public types ──────────────────────────────────────────────────

/** Backend that produced this credential. Phase 8 only ships
 *  `software`; future OS-backed credentials (Windows Hello / Touch
 *  ID / FIDO2) carry their own tag. */
export type PasskeyBackend = "software";

/** Public summary returned by `passkey_list` and the mutating
 *  commands. Carries the pubkey so the UI can show "credential signed
 *  with key X" but never the sealed secret material. */
export interface PasskeySummary {
  /** base64url credential id. */
  id: string;
  backend: PasskeyBackend;
  /** base64url Ed25519 pubkey (32 bytes). */
  publicKey: string;
  label: string;
  deviceName: string | null;
  /** Monotonic counter — increments on every successful assertion. */
  counter: number;
  /** Unix seconds at enrollment. */
  createdAt: number;
  /** Unix seconds of the most recent successful assertion. */
  lastUsed: number;
}

/** Challenge issued by `passkey_challenge_create`. Travels as-is to
 *  `passkey_attest` so the Rust side can re-derive the signing
 *  message from the canonical fields rather than trust the caller. */
export interface AuthChallenge {
  /** base64url 32-byte CSPRNG nonce. */
  nonce: string;
  /** base64url 32-byte tx payload hash. */
  payloadHash: string;
  createdAt: number;
  expiresAt: number;
}

/** Assertion returned by `passkey_attest`. */
export interface Assertion {
  credentialId: string;
  /** base64url 64-byte Ed25519 signature. */
  signature: string;
  challenge: AuthChallenge;
  newCounter: number;
}

// ─── Errors ────────────────────────────────────────────────────────

/** Discriminated union of every typed error the Rust passkey module
 *  returns. The IPC boundary tags each variant with `code`. */
export type PasskeyError =
  | { code: "vault_locked" }
  | { code: "vault_not_found"; id: string }
  | { code: "credential_not_found" }
  | { code: "limit_reached"; max: number }
  | { code: "invalid_label" }
  | { code: "malformed" }
  | { code: "wrong_password" }
  | { code: "crypto" }
  | { code: "assertion_cancelled" }
  | { code: "not_enrolled" }
  | { code: "auth_failed" }
  | { code: "counter_regression" }
  | { code: "expired" }
  | { code: "device_not_supported" }
  | { code: "backend"; message: string };

export class PasskeyCallError extends Error {
  override readonly cause: PasskeyError;
  constructor(cause: PasskeyError) {
    super(messageFor(cause));
    this.name = "PasskeyCallError";
    this.cause = cause;
  }
}

function messageFor(e: PasskeyError): string {
  switch (e.code) {
    case "vault_locked":
      return "Vault is locked — unlock first.";
    case "vault_not_found":
      return `Vault ${e.id} not found.`;
    case "credential_not_found":
      return "Passkey credential not found.";
    case "limit_reached":
      return `Passkey limit reached (${e.max} per vault).`;
    case "invalid_label":
      return "Label must be 1-64 chars after trim.";
    case "malformed":
      return "Credential payload is malformed.";
    case "wrong_password":
      return "Wrong master password.";
    case "crypto":
      return "Internal crypto error.";
    case "assertion_cancelled":
      return "Passkey prompt was cancelled.";
    case "not_enrolled":
      return "No passkey enrolled for this vault.";
    case "auth_failed":
      return "Authentication failed.";
    case "counter_regression":
      return "Replay rejected — counter regression.";
    case "expired":
      return "Challenge has expired — retry.";
    case "device_not_supported":
      return "Device or backend not supported.";
    case "backend":
      return `Passkey backend error: ${e.message}`;
  }
}

function normalizeError(raw: unknown): PasskeyCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new PasskeyCallError(raw as PasskeyError);
  }
  const message =
    typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new PasskeyCallError({ code: "backend", message });
}

// ─── Wire-shape mappers (snake_case ↔ camelCase) ───────────────────

interface PasskeySummaryWire {
  id: string;
  backend: PasskeyBackend;
  public_key: string;
  label: string;
  device_name: string | null;
  counter: number;
  created_at: number;
  last_used: number;
}

interface AuthChallengeWire {
  nonce: string;
  payload_hash: string;
  created_at: number;
  expires_at: number;
}

interface AssertionWire {
  credential_id: string;
  signature: string;
  challenge: AuthChallengeWire;
  new_counter: number;
}

function summaryFromWire(w: PasskeySummaryWire): PasskeySummary {
  return {
    id: w.id,
    backend: w.backend,
    publicKey: w.public_key,
    label: w.label,
    deviceName: w.device_name,
    counter: w.counter,
    createdAt: w.created_at,
    lastUsed: w.last_used,
  };
}

function challengeFromWire(w: AuthChallengeWire): AuthChallenge {
  return {
    nonce: w.nonce,
    payloadHash: w.payload_hash,
    createdAt: w.created_at,
    expiresAt: w.expires_at,
  };
}

function challengeToWire(c: AuthChallenge): AuthChallengeWire {
  return {
    nonce: c.nonce,
    payload_hash: c.payloadHash,
    created_at: c.createdAt,
    expires_at: c.expiresAt,
  };
}

function assertionFromWire(w: AssertionWire): Assertion {
  return {
    credentialId: w.credential_id,
    signature: w.signature,
    challenge: challengeFromWire(w.challenge),
    newCounter: w.new_counter,
  };
}

/** Test seam — exported so the unit tests can pin the wire→domain
 *  mapping without going through the live IPC. */
export const _passkeySummaryFromWireForTest = summaryFromWire;
export const _challengeFromWireForTest = challengeFromWire;
export const _assertionFromWireForTest = assertionFromWire;

// ─── Command wrappers ──────────────────────────────────────────────

/** List enrolled passkeys for `vaultId`. Works whether the vault is
 *  locked or unlocked. */
export async function listPasskeys(vaultId: string): Promise<PasskeySummary[]> {
  try {
    const wire = await invoke<PasskeySummaryWire[]>("passkey_list", { vaultId });
    return wire.map(summaryFromWire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Enroll a fresh passkey. Requires the vault unlocked. */
export async function enrollPasskey(args: {
  vaultId: string;
  label: string;
  deviceName?: string;
}): Promise<PasskeySummary> {
  if (!args.label.trim()) {
    throw new PasskeyCallError({ code: "invalid_label" });
  }
  try {
    const wire = await invoke<PasskeySummaryWire>("passkey_enroll", {
      vaultId: args.vaultId,
      label: args.label,
      deviceName: args.deviceName ?? null,
    });
    return summaryFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Rename an enrolled passkey. Vault must be unlocked. */
export async function renamePasskey(args: {
  vaultId: string;
  credentialId: string;
  newLabel: string;
}): Promise<PasskeySummary> {
  if (!args.newLabel.trim()) {
    throw new PasskeyCallError({ code: "invalid_label" });
  }
  try {
    const wire = await invoke<PasskeySummaryWire>("passkey_rename", {
      vaultId: args.vaultId,
      credentialId: args.credentialId,
      newLabel: args.newLabel,
    });
    return summaryFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Remove an enrolled passkey. Vault must be unlocked AND the
 *  master password must be re-supplied — defense-in-depth gate. */
export async function removePasskey(args: {
  vaultId: string;
  credentialId: string;
  password: string;
}): Promise<void> {
  if (!args.password) {
    throw new PasskeyCallError({ code: "wrong_password" });
  }
  try {
    await invoke<void>("passkey_remove", {
      vaultId: args.vaultId,
      credentialId: args.credentialId,
      password: args.password,
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Create a challenge bound to the supplied 32-byte payload hash.
 *  `payloadHashB64` is base64url-no-pad. */
export async function createPasskeyChallenge(
  payloadHashB64: string,
): Promise<AuthChallenge> {
  try {
    const wire = await invoke<AuthChallengeWire>("passkey_challenge_create", {
      payloadHashB64,
    });
    return challengeFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Run the full ceremony. Signs the challenge, self-verifies, bumps
 *  the counter, persists. Vault must be unlocked. */
export async function attestPasskey(args: {
  vaultId: string;
  credentialId: string;
  challenge: AuthChallenge;
}): Promise<Assertion> {
  try {
    const wire = await invoke<AssertionWire>("passkey_attest", {
      vaultId: args.vaultId,
      credentialId: args.credentialId,
      challenge: challengeToWire(args.challenge),
    });
    return assertionFromWire(wire);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

// ─── Hooks ─────────────────────────────────────────────────────────

/** Reactive view of the passkeys enrolled for a vault. Exposes
 *  loading state, error, the summary list, and refresh/enroll/
 *  rename/remove actions. */
export function usePasskeys(vaultId: string | null): {
  status: "idle" | "loading" | "ready" | "error";
  passkeys: PasskeySummary[];
  error: PasskeyCallError | null;
  refresh: () => Promise<void>;
  enroll: (args: { label: string; deviceName?: string }) => Promise<PasskeySummary>;
  rename: (args: { credentialId: string; newLabel: string }) => Promise<PasskeySummary>;
  remove: (args: { credentialId: string; password: string }) => Promise<void>;
} {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    vaultId ? "loading" : "idle",
  );
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [error, setError] = useState<PasskeyCallError | null>(null);

  const refresh = useCallback(async () => {
    if (!vaultId) {
      setPasskeys([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    try {
      const list = await listPasskeys(vaultId);
      setPasskeys(list);
      setError(null);
      setStatus("ready");
    } catch (cause) {
      const err =
        cause instanceof PasskeyCallError
          ? cause
          : new PasskeyCallError({ code: "backend", message: String(cause) });
      setError(err);
      setStatus("error");
    }
  }, [vaultId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enroll = useCallback(
    async (args: { label: string; deviceName?: string }) => {
      if (!vaultId) {
        throw new PasskeyCallError({ code: "vault_not_found", id: "" });
      }
      const created = await enrollPasskey({ vaultId, ...args });
      await refresh();
      return created;
    },
    [vaultId, refresh],
  );

  const rename = useCallback(
    async (args: { credentialId: string; newLabel: string }) => {
      if (!vaultId) {
        throw new PasskeyCallError({ code: "vault_not_found", id: "" });
      }
      const updated = await renamePasskey({ vaultId, ...args });
      await refresh();
      return updated;
    },
    [vaultId, refresh],
  );

  const remove = useCallback(
    async (args: { credentialId: string; password: string }) => {
      if (!vaultId) {
        throw new PasskeyCallError({ code: "vault_not_found", id: "" });
      }
      await removePasskey({ vaultId, ...args });
      await refresh();
    },
    [vaultId, refresh],
  );

  return { status, passkeys, error, refresh, enroll, rename, remove };
}

/** Convenience hook for the OperationsDrawer (Commit 5). Combines
 *  the create-challenge + attest steps into a single
 *  `triggerHighValueChallenge(payloadHashB64, vaultId, credentialId)`
 *  call — returns the assertion on success or throws the typed
 *  error. */
export function useChallenge(): {
  triggerHighValueChallenge: (args: {
    payloadHashB64: string;
    vaultId: string;
    credentialId: string;
  }) => Promise<Assertion>;
} {
  const triggerHighValueChallenge = useCallback(
    async (args: {
      payloadHashB64: string;
      vaultId: string;
      credentialId: string;
    }) => {
      const challenge = await createPasskeyChallenge(args.payloadHashB64);
      return attestPasskey({
        vaultId: args.vaultId,
        credentialId: args.credentialId,
        challenge,
      });
    },
    [],
  );
  return { triggerHighValueChallenge };
}
