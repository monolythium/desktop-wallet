// IPFS metadata resolver.
//
// NFT metadata URIs are typically `ipfs://<cid>/path` — the wallet
// rewrites these to a public gateway for fetch, with a fallback chain
// so a single misbehaving gateway doesn't tank rendering. `https://`
// URIs are fetched directly; `data:` URIs are parsed inline (a few
// generative collections inline JSON in calldata).
//
// 50-entry LRU cache with a 10-min TTL avoids re-fetching the same
// CID multiple times while the user scrolls the NFT gallery. Cache
// is in-memory only — fine for a single session; persistence would
// add complexity for no observable win since metadata doesn't change
// between sessions worth a per-machine cache.

// ─── Public types ──────────────────────────────────────────────────

/** Standard NFT metadata shape per ERC-721/1155 §metadata JSON. */
export interface NftMetadata {
  name?: string;
  description?: string;
  /** Image URI — may itself be `ipfs://…`; the gallery resolves it
   *  on render via the same gateway chain. */
  image?: string;
  attributes?: Array<{ trait_type: string; value: string | number }>;
  animation_url?: string;
  external_url?: string;
}

export class IpfsResolveError extends Error {
  public readonly kind: "timeout" | "unreachable" | "invalid-json" | "unsupported-scheme" | "empty-uri";
  constructor(kind: IpfsResolveError["kind"], message: string) {
    super(message);
    this.name = "IpfsResolveError";
    this.kind = kind;
  }
}

// ─── Gateway list ──────────────────────────────────────────────────

/** Default (built-in) gateway list. The user-configurable override
 *  lives in localStorage; `getIpfsGateways()` returns the override
 *  when set, otherwise this default. */
export const IPFS_GATEWAYS_DEFAULT = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
] as const;

/** Backwards-compat alias for callers that pre-date the user-config
 *  override (Phase 5 closure #D15). New code should call
 *  `getIpfsGateways()`. */
export const IPFS_GATEWAYS: readonly string[] = IPFS_GATEWAYS_DEFAULT;

/** localStorage key for the user-configured gateway list. Phase 5 #D15
 *  closure — the user can reorder or replace the default chain when a
 *  particular gateway rate-limits them. */
const STORAGE_KEY_GATEWAYS = "mono.ipfs.gateways.v1";

/** Read the current gateway list. Returns the user override when
 *  configured (must be a non-empty string array); falls back to
 *  `IPFS_GATEWAYS_DEFAULT` otherwise. */
export function getIpfsGateways(): readonly string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GATEWAYS);
    if (!raw) return IPFS_GATEWAYS_DEFAULT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return IPFS_GATEWAYS_DEFAULT;
    const cleaned = parsed.filter(
      (g): g is string =>
        typeof g === "string" &&
        (g.startsWith("https://") || g.startsWith("http://")) &&
        g.length > 0,
    );
    return cleaned.length > 0 ? cleaned : IPFS_GATEWAYS_DEFAULT;
  } catch {
    return IPFS_GATEWAYS_DEFAULT;
  }
}

/** Persist a user-configured gateway list. Each entry must be a
 *  fully-qualified URL ending with `/ipfs/`. Pass an empty array (or
 *  call `resetIpfsGateways()`) to revert to the default chain. */
export function setIpfsGateways(gateways: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_GATEWAYS, JSON.stringify(gateways));
  } catch {
    // ignore
  }
}

/** Revert to the built-in default chain. */
export function resetIpfsGateways(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_GATEWAYS);
  } catch {
    // ignore
  }
}

/** Fetch timeout per gateway attempt (ms). */
export const IPFS_FETCH_TIMEOUT_MS = 8_000;

/** Rewrite an `ipfs://<cid>/path` URI to a gateway URL. Returns the
 *  rewritten URL plus the index in the active gateway list so the
 *  caller can iterate fallbacks. */
export function rewriteIpfsUri(uri: string, gatewayIndex: number): string {
  // Accept `ipfs://CID/path` and `ipfs://ipfs/CID/path` (some pin
  // services emit the latter).
  const prefix = "ipfs://";
  if (!uri.startsWith(prefix)) return uri;
  let rest = uri.slice(prefix.length);
  if (rest.startsWith("ipfs/")) rest = rest.slice(5);
  const gateways = getIpfsGateways();
  const gateway = gateways[gatewayIndex];
  if (!gateway) {
    return (gateways[0] ?? "https://ipfs.io/ipfs/") + rest;
  }
  return gateway + rest;
}

// ─── LRU cache ─────────────────────────────────────────────────────

interface CacheEntry {
  metadata: NftMetadata;
  cachedAtMs: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_CAPACITY = 50;

/** Module-level cache — survives across re-mounts but not page reload. */
const cache = new Map<string, CacheEntry>();

/** Test-only: clear the cache. Production never calls this. */
export function _resetIpfsCacheForTest(): void {
  cache.clear();
}

function cacheGet(key: string): NftMetadata | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAtMs >= CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU bump — re-insert moves the key to the most-recent position.
  cache.delete(key);
  cache.set(key, entry);
  return entry.metadata;
}

function cacheSet(key: string, metadata: NftMetadata): void {
  cache.set(key, { metadata, cachedAtMs: Date.now() });
  // Evict oldest entries beyond capacity. Map iterates in insertion
  // order, so the first key is the oldest after our LRU bumps.
  while (cache.size > CACHE_CAPACITY) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

// ─── Resolver ──────────────────────────────────────────────────────

/**
 * Resolve a `tokenURI` / `uri()` return value into the standard
 * NftMetadata shape. Handles three URI schemes:
 *
 *   - `ipfs://CID/path` — rewritten to each gateway in IPFS_GATEWAYS
 *     in order; first 2xx-with-valid-JSON wins
 *   - `https://...` (or `http://`) — direct fetch with the same
 *     8-second timeout
 *   - `data:application/json;base64,...` — decoded inline
 *
 * Cache: 50-entry LRU keyed by the canonical input URI; 10-minute
 * TTL. A successful resolution caches; failures don't (we want to
 * retry next render).
 */
export async function resolveTokenUri(
  uri: string,
  /** Optional fetch override for tests. */
  fetchImpl: typeof fetch = fetch,
): Promise<NftMetadata> {
  if (!uri || uri.trim() === "") {
    throw new IpfsResolveError("empty-uri", "URI is empty");
  }
  const cached = cacheGet(uri);
  if (cached) return cached;

  let result: NftMetadata | null = null;

  if (uri.startsWith("data:")) {
    result = parseDataUri(uri);
  } else if (uri.startsWith("ipfs://")) {
    result = await fetchWithGatewayFallback(uri, fetchImpl);
  } else if (uri.startsWith("http://") || uri.startsWith("https://")) {
    result = await fetchJson(uri, fetchImpl);
  } else {
    throw new IpfsResolveError(
      "unsupported-scheme",
      `unsupported URI scheme in '${uri.slice(0, 32)}'`,
    );
  }

  if (result === null) {
    throw new IpfsResolveError(
      "unreachable",
      `could not resolve ${uri}`,
    );
  }
  cacheSet(uri, result);
  return result;
}

/** Parse a `data:application/json;base64,<payload>` URI. Also handles
 *  the non-base64 form (`data:application/json,{...}`) some collections
 *  emit. */
function parseDataUri(uri: string): NftMetadata {
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) {
    throw new IpfsResolveError("invalid-json", "data: URI missing payload");
  }
  const header = uri.slice(5, commaIdx);
  const payload = uri.slice(commaIdx + 1);
  let jsonText: string;
  if (header.includes("base64")) {
    try {
      jsonText = atob(payload);
    } catch {
      throw new IpfsResolveError("invalid-json", "data: URI base64 decode failed");
    }
  } else {
    try {
      jsonText = decodeURIComponent(payload);
    } catch {
      jsonText = payload;
    }
  }
  try {
    return JSON.parse(jsonText) as NftMetadata;
  } catch {
    throw new IpfsResolveError("invalid-json", "data: URI payload not valid JSON");
  }
}

async function fetchWithGatewayFallback(
  ipfsUri: string,
  fetchImpl: typeof fetch,
): Promise<NftMetadata> {
  let lastError: IpfsResolveError | null = null;
  // Re-read the gateway list per call so a user reorder takes effect
  // immediately for subsequent fetches (no remount required).
  const gateways = getIpfsGateways();
  for (let i = 0; i < gateways.length; i += 1) {
    const url = rewriteIpfsUri(ipfsUri, i);
    try {
      return await fetchJson(url, fetchImpl);
    } catch (cause) {
      if (cause instanceof IpfsResolveError) {
        lastError = cause;
        continue;
      }
      lastError = new IpfsResolveError(
        "unreachable",
        (cause as Error)?.message ?? String(cause),
      );
    }
  }
  throw lastError ?? new IpfsResolveError("unreachable", "all gateways failed");
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<NftMetadata> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IPFS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new IpfsResolveError("unreachable", `HTTP ${res.status} from ${url}`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as NftMetadata;
    } catch {
      throw new IpfsResolveError("invalid-json", `response from ${url} is not valid JSON`);
    }
  } catch (cause) {
    if ((cause as Error)?.name === "AbortError") {
      throw new IpfsResolveError("timeout", `${url} timed out after ${IPFS_FETCH_TIMEOUT_MS}ms`);
    }
    if (cause instanceof IpfsResolveError) throw cause;
    throw new IpfsResolveError("unreachable", (cause as Error)?.message ?? String(cause));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: take a (possibly ipfs://) image URL from already-parsed
 * metadata and return a gateway-rewritten URL ready for an `<img src>`.
 * Returns the first-gateway rewrite; the gallery falls back to a
 * placeholder if the load fails.
 */
export function resolveImageUrl(imageUri: string | undefined): string | null {
  if (!imageUri) return null;
  if (imageUri.startsWith("ipfs://")) return rewriteIpfsUri(imageUri, 0);
  if (imageUri.startsWith("data:")) return imageUri;
  if (imageUri.startsWith("http://") || imageUri.startsWith("https://")) {
    return imageUri;
  }
  return null;
}
