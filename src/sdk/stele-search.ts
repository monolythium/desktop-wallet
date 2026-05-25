// Stele marketplace search — wraps the stele_listing_search Tauri command
// which proxies through the lyth_mcp `vendor_search` tool.

import { invoke } from "@tauri-apps/api/core";

export interface ListingHit {
  provider_id?: string;
  mono_name?: string;
  title?: string;
  category?: string;
  rating?: number;
  reviews?: number;
  price_from_lyth?: string;
  availability_hint?: string | null;
  attestations?: string[];
}

export interface ListingSearchInput {
  query?: string | null;
  category?: string | null;
  min_rating?: number | null;
  max_price_lyth?: string | null;
  near_lat?: number | null;
  near_lng?: number | null;
}

export type StereSearchError =
  | { code: "input"; message: string }
  | { code: "sidecar_not_running" }
  | { code: "sidecar_tool"; tool: string; message: string }
  | { code: "not_compiled" }
  | { code: "not_tauri" };

export class StereSearchCallError extends Error {
  override readonly cause: StereSearchError;
  constructor(cause: StereSearchError) {
    super(messageFor(cause));
    this.name = "StereSearchCallError";
    this.cause = cause;
  }
}

function messageFor(e: StereSearchError): string {
  switch (e.code) {
    case "not_tauri":
      return "Marketplace search runs in the native Tauri binary; browser preview can't reach it.";
    case "not_compiled":
      return "The Stele backend isn't compiled into this build. Pass --features stele to enable it.";
    case "sidecar_not_running":
      return "lyth_mcp isn't running. Install it and restart the wallet to browse the marketplace.";
    case "sidecar_tool":
      return `lyth_mcp '${e.tool}' failed: ${e.message}`;
    case "input":
      return `Invalid input: ${e.message}`;
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeError(raw: unknown): StereSearchCallError {
  if (raw && typeof raw === "object" && "code" in raw) {
    return new StereSearchCallError(raw as StereSearchError);
  }
  const message = typeof raw === "string" ? raw : (raw as Error)?.message ?? String(raw);
  if (message.includes("not found") || message.includes("not allowed")) {
    return new StereSearchCallError({ code: "not_compiled" });
  }
  return new StereSearchCallError({ code: "input", message });
}

/**
 * Search marketplace listings. The lyth_mcp response shape can be
 * `{ hits: [...] }`, `{ providers: [...] }`, a bare array, or
 * `{ text: "..." }` when no providers match — normalize to a flat list.
 */
export async function listingSearch(input: ListingSearchInput): Promise<ListingHit[]> {
  if (!isTauri()) throw new StereSearchCallError({ code: "not_tauri" });
  try {
    const raw = await invoke<unknown>("stele_listing_search", { input });
    return normalizeListingResult(raw);
  } catch (raw) {
    throw normalizeError(raw);
  }
}

function normalizeListingResult(raw: unknown): ListingHit[] {
  if (Array.isArray(raw)) return raw as ListingHit[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.hits)) return obj.hits as ListingHit[];
    if (Array.isArray(obj.providers)) return obj.providers as ListingHit[];
    if (Array.isArray(obj.vendors)) return obj.vendors as ListingHit[];
    if (Array.isArray(obj.results)) return obj.results as ListingHit[];
  }
  return [];
}
