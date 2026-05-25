// Address-book bridge — proxies through the Stele backend's lyth_mcp
// sidecar. Failure modes + Tauri-detection live in `stele-base.ts`.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as AddressBookCallError };

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

const SURFACE = "Address book";

export async function addressbookAdd(input: AddressBookAddInput): Promise<unknown> {
  return callStele<unknown>("stele_addressbook_add", { input }, SURFACE);
}

export async function addressbookLookup(query?: string): Promise<AddressBookEntry[]> {
  const raw = await callStele<unknown>(
    "stele_addressbook_lookup",
    { query: query ?? null },
    SURFACE,
  );
  return normalizeLookupResult(raw);
}

export async function addressbookRemove(name: string): Promise<unknown> {
  return callStele<unknown>("stele_addressbook_remove", { name }, SURFACE);
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
