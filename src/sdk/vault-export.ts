// Portable vault export — Phase 7 #D20.
//
// Typed wrappers over the `vault_export_blob` / `vault_import_blob`
// Tauri commands. The Rust side re-encrypts the vault's seed under a
// fresh export-password and returns a textual JSON envelope
// (`monolythium.vault.export.v1`); the import side reverses the
// process and adds the recovered seed to the local container as a
// new vault under the local master password.
//
// The export password is INDEPENDENT of the master password — picked
// fresh per export so revealing the transport medium doesn't burn
// the master password.

import { invoke } from "@tauri-apps/api/core";

export type VaultExportErrorCode =
  | "not_found"
  | "vault"
  | "invalid_envelope"
  | "backend";

export interface VaultExportError {
  code: VaultExportErrorCode;
  message: string;
}

export class VaultExportCallError extends Error {
  override readonly cause: VaultExportError;
  constructor(cause: VaultExportError) {
    super(`[${cause.code}] ${cause.message}`);
    this.name = "VaultExportCallError";
    this.cause = cause;
  }
}

function normalizeError(raw: unknown): VaultExportCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    const r = raw as { code: string; [k: string]: unknown };
    // Wrapper case: { code: "vault", "0": <VaultError> } — flatten.
    if (r.code === "vault" && "0" in r) {
      const inner = r["0"] as { code?: string; message?: string } | undefined;
      const code = (inner?.code as string | undefined) ?? "vault";
      const message = (inner?.message as string | undefined) ?? "vault error";
      return new VaultExportCallError({
        code: code as VaultExportErrorCode,
        message,
      });
    }
    return new VaultExportCallError({
      code: (r.code as VaultExportErrorCode) ?? "backend",
      message: (r.message as string | undefined) ?? JSON.stringify(r),
    });
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  return new VaultExportCallError({ code: "backend", message });
}

/** Produce a portable export envelope for one vault. Both the master
 *  password (to unseal the vault) and the export password (to seal the
 *  envelope) are required. The envelope is a JSON string the caller
 *  hands to a save-as / clipboard / encrypted-transport channel. */
export async function vaultExportBlob(args: {
  vaultId: string;
  masterPassword: string;
  exportPassword: string;
}): Promise<string> {
  try {
    return await invoke<string>("vault_export_blob", {
      vaultId: args.vaultId,
      masterPassword: args.masterPassword,
      exportPassword: args.exportPassword,
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

/** Ingest an export envelope into the local container. Returns the
 *  new vault id. Both passwords are required: the export password
 *  unseals the envelope; the master password re-seals the seed under
 *  the local MEK before storing. */
export async function vaultImportBlob(args: {
  envelopeText: string;
  exportPassword: string;
  masterPassword: string;
  /** Optional override for the vault label — useful when the source
   *  vault's label collides with one already in the local container. */
  labelOverride?: string;
}): Promise<string> {
  try {
    return await invoke<string>("vault_import_blob", {
      envelopeText: args.envelopeText,
      exportPassword: args.exportPassword,
      masterPassword: args.masterPassword,
      labelOverride: args.labelOverride ?? null,
    });
  } catch (raw) {
    throw normalizeError(raw);
  }
}
