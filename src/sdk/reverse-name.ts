// Reverse name display (address → name) — a NON-authoritative convenience.
//
// The registry (0x110E) exposes `lyth_nameOf` = the LATEST name registered to an
// address (last-write-wins per owner). Showing it next to a bare address is a
// readability aid, not identity and not a security boundary: a failed or absent
// lookup falls back to the plain address (never a fabricated name), and this
// never gates a send. (Forward resolution for Send — the authoritative,
// fail-closed path — lives in `name-resolve.ts`.)
//
// Latest-name-per-owner: `lyth_nameOf` returns the single most-recent name, so we
// display that one name honestly and don't imply it's the only name owned.

import { getProvider } from "./client";

/** Pull the display name out of a `lyth_nameOf` response: the name, or null when
 *  absent/blank. Pure. */
export function pickReverseName(
  res: { name?: string | null } | null | undefined,
): string | null {
  const name = res?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

// address(lowercased) → resolved name | null. Avoids re-querying the same
// address; a transient failure is NOT cached so it can retry.
const cache = new Map<string, string | null>();

/** Registry reverse name for an address via `lyth_nameOf`, cached. A failed or
 *  absent lookup resolves to null — the caller shows the bare address (honest
 *  fallback). Never throws. */
export async function loadReverseName(address: string): Promise<string | null> {
  const key = address.trim().toLowerCase();
  if (key === "") return null;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const name = pickReverseName(await getProvider().rpcClient.lythNameOf(address));
    cache.set(key, name);
    return name;
  } catch {
    return null; // honest fallback; don't cache a transient failure
  }
}

/** Drop the reverse-name cache (e.g. after a fresh registration re-points an
 *  address's latest name). */
export function clearReverseNameCache(): void {
  cache.clear();
}
