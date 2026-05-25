// Stele marketplace search — wraps the stele_listing_search Tauri command
// which proxies through the lyth_mcp `vendor_search` tool. Shared error
// envelope + Tauri detection live in `stele-base.ts`.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as StereSearchCallError };

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

const SURFACE = "Marketplace search";

/**
 * Search marketplace listings. The lyth_mcp response shape can be
 * `{ hits: [...] }`, `{ providers: [...] }`, a bare array, or
 * `{ text: "..." }` when no providers match — normalize to a flat list.
 */
export async function listingSearch(input: ListingSearchInput): Promise<ListingHit[]> {
  const raw = await callStele<unknown>("stele_listing_search", { input }, SURFACE);
  return normalizeListingResult(raw);
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
