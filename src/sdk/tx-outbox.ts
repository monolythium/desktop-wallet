// Tx-outbox bridge — proxies through the Stele backend's lyth_mcp
// sidecar. Shared error envelope + Tauri detection live in `stele-base.ts`.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as TxOutboxCallError };

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

const SURFACE = "Tx outbox";

export async function txOutboxList(): Promise<TxOutboxEntry[]> {
  const raw = await callStele<unknown>("stele_tx_outbox_list", undefined, SURFACE);
  return normalizeListResult(raw);
}

export async function txOutboxRetry(id: string): Promise<unknown> {
  return callStele<unknown>("stele_tx_outbox_retry", { id }, SURFACE);
}

export async function txOutboxForget(id: string): Promise<unknown> {
  return callStele<unknown>("stele_tx_outbox_forget", { id }, SURFACE);
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
