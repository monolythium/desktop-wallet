// Address-book bridge — proxies through the Stele backend's lyth_mcp
// sidecar. Only callable when the binary was built with --features stele
// AND the sidecar booted successfully on launch.

import { invoke } from "@tauri-apps/api/core";

export interface AddressBookEntry {
  name: string;
  address: string;
  note?: string | null;
  tags?: string[] | null;
}

export interface AddressBookAddInput {
  name: string;
  address: string;
  note?: string | null;
  tags?: string[] | null;
  overwrite?: boolean | null;
}

export type AddressBookError =
  | { code: "input"; message: string }
  | { code: "sidecar_not_running" }
  | { code: "sidecar_tool"; tool: string; message: string }
  | { code: "not_compiled" }
  | { code: "not_tauri" };

export class AddressBookCallError extends Error {
  override readonly cause: AddressBookError;
  constructor(cause: AddressBookError) {
    super(messageFor(cause));
    this.name = "AddressBookCallError";
    this.cause = cause;
  }
}

function messageFor(e: AddressBookError): string {
  switch (e.code) {
    case "not_tauri":
      return "Address book runs in the native Tauri binary; the browser preview can't reach it.";
    case "not_compiled":
      return "The Stele backend isn't compiled into this build. Pass --features stele to enable it.";
    case "sidecar_not_running":
      return "lyth_mcp isn't running. Install it and restart the wallet to use the address book.";
    case "sidecar_tool":
      return `lyth_mcp '${e.tool}' failed: ${e.message}`;
    case "input":
      return `Invalid input: ${e.message}`;
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeError(raw: unknown): AddressBookCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new AddressBookCallError(raw as AddressBookError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  if (message.includes("not found") || message.includes("not allowed")) {
    return new AddressBookCallError({ code: "not_compiled" });
  }
  return new AddressBookCallError({ code: "input", message });
}

export async function addressbookAdd(input: AddressBookAddInput): Promise<unknown> {
  if (!isTauri()) throw new AddressBookCallError({ code: "not_tauri" });
  try {
    return await invoke<unknown>("stele_addressbook_add", { input });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export async function addressbookLookup(query?: string): Promise<AddressBookEntry[]> {
  if (!isTauri()) throw new AddressBookCallError({ code: "not_tauri" });
  try {
    const raw = await invoke<unknown>("stele_addressbook_lookup", { query: query ?? null });
    return normalizeLookupResult(raw);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

export async function addressbookRemove(name: string): Promise<unknown> {
  if (!isTauri()) throw new AddressBookCallError({ code: "not_tauri" });
  try {
    return await invoke<unknown>("stele_addressbook_remove", { name });
  } catch (raw) {
    throw normalizeError(raw);
  }
}

// lyth_mcp returns either { entries: [...] }, { text: "..." }, or a bare
// array depending on the call path. Narrow to a flat entry list.
function normalizeLookupResult(raw: unknown): AddressBookEntry[] {
  if (Array.isArray(raw)) return raw as AddressBookEntry[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.entries)) return obj.entries as AddressBookEntry[];
    if (Array.isArray(obj.contacts)) return obj.contacts as AddressBookEntry[];
  }
  return [];
}
