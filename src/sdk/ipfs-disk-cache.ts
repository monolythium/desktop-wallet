// IPFS metadata disk-cache bridge — Phase 7 #D19.
//
// Thin typed wrappers over the four `ipfs_cache_*` Tauri commands.
// The resolver in `ipfs.ts` calls into these as a second cache tier
// between the in-memory LRU (50 entries, 10-min TTL) and the gateway
// network fetch. Disk cache survives tab reloads + cold app launches.
//
// Failure mode: every operation returns gracefully on error so the
// resolver can fall through to the network path. Non-Tauri runtimes
// (browser preview via `pnpm dev`) get a no-op cache.

import { invoke } from "@tauri-apps/api/core";

export interface IpfsCacheStats {
  entryCount: number;
  totalBytes: number;
  cacheDir: string;
}

interface IpfsCacheStatsWire {
  entry_count: number;
  total_bytes: number;
  cache_dir: string;
}

/** Fetch a previously-cached metadata blob by URI. Returns `null` if
 *  the entry is missing, stale (past TTL), or the cache is
 *  unavailable. Never throws — the resolver treats null as "fall
 *  through to network." */
export async function ipfsDiskCacheGet(uri: string): Promise<string | null> {
  try {
    const r = await invoke<string | null>("ipfs_cache_get", { uri });
    return r ?? null;
  } catch {
    return null;
  }
}

/** Persist a metadata blob. Quietly swallows errors — the in-memory
 *  cache still works even if the disk cache is unavailable. */
export async function ipfsDiskCacheSet(uri: string, json: string): Promise<void> {
  try {
    await invoke<void>("ipfs_cache_set", { uri, json });
  } catch {
    // ignore
  }
}

/** Purge every cached entry. Returns the count removed (0 when the
 *  cache is empty or unavailable). */
export async function ipfsDiskCacheClear(): Promise<number> {
  try {
    return await invoke<number>("ipfs_cache_clear");
  } catch {
    return 0;
  }
}

/** Read cache stats for the Settings → Network panel display. Returns
 *  a zero-stats placeholder on failure (so the UI shows "0 entries /
 *  0 B" rather than an error state). */
export async function ipfsDiskCacheStats(): Promise<IpfsCacheStats> {
  try {
    const w = await invoke<IpfsCacheStatsWire>("ipfs_cache_stats");
    return {
      entryCount: w.entry_count,
      totalBytes: w.total_bytes,
      cacheDir: w.cache_dir,
    };
  } catch {
    return { entryCount: 0, totalBytes: 0, cacheDir: "" };
  }
}
