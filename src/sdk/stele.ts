// Stele backend bridge — Tauri command wrappers for the stele/* Rust
// modules. Only callable when the binary was built with --features stele;
// otherwise the invoke fails with a command-not-found error and the
// caller renders a "not compiled" hint.

import { invoke } from "@tauri-apps/api/core";

export interface SidecarStatus {
  /** True once `McpSidecar::spawn` succeeded in the setup block. */
  running: boolean;
}

/**
 * Result discriminator that lets the UI distinguish three states:
 * - `not_tauri`: running in `pnpm dev` browser preview, no backend at all
 * - `not_compiled`: Tauri binary built without `--features stele`
 * - `ok`: backend is compiled; `status` reports actual sidecar liveness
 */
export type SteleBackendResult =
  | { kind: "not_tauri" }
  | { kind: "not_compiled" }
  | { kind: "ok"; status: SidecarStatus };

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function querySteleBackend(): Promise<SteleBackendResult> {
  if (!isTauri()) {
    return { kind: "not_tauri" };
  }
  try {
    const status = await invoke<SidecarStatus>("stele_sidecar_status");
    return { kind: "ok", status };
  } catch (cause) {
    // Tauri returns the literal string "command 'X' not found" when the
    // binary was built without the relevant feature. Anything else means
    // the command exists but failed — let the caller treat that as
    // "compiled but errored" by reporting `running: false`.
    const message = typeof cause === "string" ? cause : String(cause);
    if (message.includes("not found") || message.includes("not allowed")) {
      return { kind: "not_compiled" };
    }
    return { kind: "ok", status: { running: false } };
  }
}
