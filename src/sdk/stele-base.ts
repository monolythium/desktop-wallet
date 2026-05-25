// Shared shape for every Stele-backend Tauri-command wrapper.
//
// Each surface (addressbook, marketplace search, tx outbox, bookings, …)
// proxies through `call_sidecar_tool` on the Rust side, so the failure
// modes are always the same four buckets:
//
//   - not_tauri          (browser preview, no Tauri backend)
//   - not_compiled       (binary built without --features stele)
//   - sidecar_not_running (compiled but lyth_mcp isn't up)
//   - sidecar_tool       (lyth_mcp accepted the call but errored)
//
// Wrappers pick a `surfaceLabel` so the user-facing message can name
// the affected feature ("Address book runs in…" vs "Tx outbox runs in…").

import { invoke } from "@tauri-apps/api/core";

export type SteleProxyError =
  | { code: "input"; message: string }
  | { code: "sidecar_not_running" }
  | { code: "sidecar_tool"; tool: string; message: string }
  | { code: "not_compiled" }
  | { code: "not_tauri" };

export class SteleProxyCallError extends Error {
  override readonly cause: SteleProxyError;
  constructor(cause: SteleProxyError, surfaceLabel: string) {
    super(messageFor(cause, surfaceLabel));
    this.name = "SteleProxyCallError";
    this.cause = cause;
  }
}

function messageFor(e: SteleProxyError, surfaceLabel: string): string {
  switch (e.code) {
    case "not_tauri":
      return `${surfaceLabel} runs in the native Tauri binary; browser preview can't reach it.`;
    case "not_compiled":
      return `The Stele backend isn't compiled into this build. Pass --features stele to enable ${surfaceLabel.toLowerCase()}.`;
    case "sidecar_not_running":
      return `lyth_mcp isn't running. Install it and restart the wallet to use ${surfaceLabel.toLowerCase()}.`;
    case "sidecar_tool":
      return `lyth_mcp '${e.tool}' failed: ${e.message}`;
    case "input":
      return `Invalid input: ${e.message}`;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeError(raw: unknown, surfaceLabel: string): SteleProxyCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new SteleProxyCallError(raw as SteleProxyError, surfaceLabel);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  if (message.includes("not found") || message.includes("not allowed")) {
    return new SteleProxyCallError({ code: "not_compiled" }, surfaceLabel);
  }
  return new SteleProxyCallError({ code: "input", message }, surfaceLabel);
}

/**
 * Call a Stele Tauri command, normalizing every failure into a
 * `SteleProxyCallError` whose `cause.code` discriminates the four
 * buckets above. `surfaceLabel` is the human-readable name used in the
 * error message (e.g. "Address book", "Marketplace search").
 */
export async function callStele<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  surfaceLabel: string,
): Promise<T> {
  if (!isTauri()) {
    throw new SteleProxyCallError({ code: "not_tauri" }, surfaceLabel);
  }
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeError(raw, surfaceLabel);
  }
}
