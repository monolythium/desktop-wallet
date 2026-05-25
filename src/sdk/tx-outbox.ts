// Tx-outbox bridge — proxies through the Stele backend's lyth_mcp
// sidecar. Same not-tauri / not-compiled / sidecar-not-running envelope
// as addressbook + stele-search; refactor into a shared helper once a
// third or fourth proxy needs the same shape.

import { invoke } from "@tauri-apps/api/core";

export interface TxOutboxEntry {
  id?: string;
  status?: string;
  intent?: string;
  hash?: string;
  created_at?: string | null;
  updated_at?: string | null;
  attempts?: number | null;
  last_error?: string | null;
  notes?: string | null;
}

export type TxOutboxError =
  | { code: "input"; message: string }
  | { code: "sidecar_not_running" }
  | { code: "sidecar_tool"; tool: string; message: string }
  | { code: "not_compiled" }
  | { code: "not_tauri" };

export class TxOutboxCallError extends Error {
  override readonly cause: TxOutboxError;
  constructor(cause: TxOutboxError) {
    super(messageFor(cause));
    this.name = "TxOutboxCallError";
    this.cause = cause;
  }
}

function messageFor(e: TxOutboxError): string {
  switch (e.code) {
    case "not_tauri":
      return "Tx outbox runs in the native Tauri binary; browser preview can't reach it.";
    case "not_compiled":
      return "The Stele backend isn't compiled into this build. Pass --features stele to enable it.";
    case "sidecar_not_running":
      return "lyth_mcp isn't running. Install it and restart the wallet to view the tx outbox.";
    case "sidecar_tool":
      return `lyth_mcp '${e.tool}' failed: ${e.message}`;
    case "input":
      return `Invalid input: ${e.message}`;
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeError(raw: unknown): TxOutboxCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new TxOutboxCallError(raw as TxOutboxError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  if (message.includes("not found") || message.includes("not allowed")) {
    return new TxOutboxCallError({ code: "not_compiled" });
  }
  return new TxOutboxCallError({ code: "input", message });
}

export async function txOutboxList(): Promise<TxOutboxEntry[]> {
  if (!isTauri()) throw new TxOutboxCallError({ code: "not_tauri" });
  try {
    const raw = await invoke<unknown>("stele_tx_outbox_list");
    return normalizeListResult(raw);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export async function txOutboxRetry(id: string): Promise<unknown> {
  if (!isTauri()) throw new TxOutboxCallError({ code: "not_tauri" });
  try {
    return await invoke<unknown>("stele_tx_outbox_retry", { id });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export async function txOutboxForget(id: string): Promise<unknown> {
  if (!isTauri()) throw new TxOutboxCallError({ code: "not_tauri" });
  try {
    return await invoke<unknown>("stele_tx_outbox_forget", { id });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

function normalizeListResult(raw: unknown): TxOutboxEntry[] {
  if (Array.isArray(raw)) return raw as TxOutboxEntry[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.entries)) return obj.entries as TxOutboxEntry[];
    if (Array.isArray(obj.outbox)) return obj.outbox as TxOutboxEntry[];
    if (Array.isArray(obj.transactions)) return obj.transactions as TxOutboxEntry[];
  }
  return [];
}
