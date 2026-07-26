// "My names" — an HONEST owned-names view within the chain's limits.
//
// The registry (0x110E) exposes NO "list all names owned by an address" RPC:
// `lyth_nameOf` returns only the LATEST name per owner (last-write-wins). So a
// complete owned-names list is not knowable from the chain. This module combines
// the two things that ARE knowable:
//   1. the chain's reverse-latest name (`lyth_nameOf`, authoritative), and
//   2. names THIS device registered (a durable local record of a real action —
//      NOT fabricated chain data; may be stale if a name was later transferred).
// The UI must state the limitation, never imply a complete list.

import { scopeChainKey } from "./chains";

const STORAGE_PREFIX = "wallet.myNames.";

// Keyed by (owner, chain): a registered name is per-chain registry state (0x110E),
// so a name registered on one chain must not appear in another chain's list. The
// chain comes from scopeChainKey(), never a literal. (Legacy unscoped entries from
// before this change are simply not read — a one-time reset of an advisory,
// device-local list; the authoritative reverse-latest name still comes from chain.)
function keyFor(owner: string): string {
  return `${STORAGE_PREFIX}${owner.trim().toLowerCase()}.${scopeChainKey()}`;
}

/** Names this wallet registered from THIS device for `owner`. Best-effort; a
 *  storage error yields an empty list. */
export function readRegisteredNames(owner: string): string[] {
  if (owner.trim() === "") return [];
  try {
    const raw = localStorage.getItem(keyFor(owner));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Record a name this wallet just registered, keyed by owner. Records a real
 *  action the wallet performed — not invented chain data. Best-effort. */
export function recordRegisteredName(owner: string, name: string): void {
  if (owner.trim() === "" || name.trim() === "") return;
  try {
    const set = new Set(readRegisteredNames(owner));
    set.add(name.trim().toLowerCase());
    localStorage.setItem(keyFor(owner), JSON.stringify([...set]));
  } catch {
    // localStorage unavailable — best-effort; the chain reverse read still shows
    // the latest name.
  }
}

export interface MyNameEntry {
  name: string;
  /** True for the single name `lyth_nameOf` returns (the chain's latest-per-owner,
   *  authoritative). The rest are this-device records. */
  reverseLatest: boolean;
}

/** Merge the chain's reverse-latest name with this device's local records into a
 *  deduped list. The reverse-latest (if any) is authoritative and flagged; the
 *  rest are "registered from this device". Never invents an owned-names list —
 *  only combines these two honest sources. Pure. */
export function mergeMyNames(
  reverseLatest: string | null | undefined,
  localNames: readonly string[],
): MyNameEntry[] {
  const out: MyNameEntry[] = [];
  const seen = new Set<string>();
  if (reverseLatest && reverseLatest.trim() !== "") {
    const n = reverseLatest.trim().toLowerCase();
    out.push({ name: n, reverseLatest: true });
    seen.add(n);
  }
  for (const raw of localNames) {
    const n = raw.trim().toLowerCase();
    if (n === "" || seen.has(n)) continue;
    seen.add(n);
    out.push({ name: n, reverseLatest: false });
  }
  return out;
}
