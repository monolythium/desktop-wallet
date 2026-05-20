// Persistent token list — the user's tracked-token registry.
//
// Tracks every token the user wants visible in the Tokens portfolio:
// auto-populated from `discoverTokens` on first load, then user-managed
// via the manage flow (add custom, hide, unhide, pin, remove).
//
// Storage matches Phase 3 contacts: localStorage-keyed JSON list,
// non-secret, schema-versioned key for clean migrations.

import type { TokenKind } from "./token-discovery";

export type { TokenKind };

const STORAGE_KEY = "mono.tokens.v1";

export interface TrackedToken {
  /** Lowercased EIP-55 0x-hex. Primary key — comparisons compare on this. */
  contract: string;
  /** ERC kind — drives the per-row reader / send-flow dispatch. */
  kind: TokenKind;
  /** Display symbol (from `symbol()` or user-edited). */
  symbol: string;
  /** Display name (from `name()` or user-edited). */
  name: string;
  /** Decimals (ERC-20 only; null for ERC-721 / ERC-1155). */
  decimals?: number;
  /** User hid the row — keeps it persisted so it doesn't auto-re-discover. */
  hidden?: boolean;
  /** User pinned the row — sorts to top above the alphabetical default. */
  pinned?: boolean;
  /** ms-since-epoch first added. */
  addedAt: number;
}

function safeReadList(): TrackedToken[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: TrackedToken[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (
        typeof r.contract !== "string" ||
        typeof r.kind !== "string" ||
        (r.kind !== "erc20" && r.kind !== "erc721" && r.kind !== "erc1155") ||
        typeof r.symbol !== "string" ||
        typeof r.name !== "string" ||
        typeof r.addedAt !== "number"
      )
        continue;
      out.push({
        contract: r.contract.toLowerCase(),
        kind: r.kind,
        symbol: r.symbol,
        name: r.name,
        decimals: typeof r.decimals === "number" ? r.decimals : undefined,
        hidden: r.hidden === true,
        pinned: r.pinned === true,
        addedAt: r.addedAt,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function safeWriteList(list: TrackedToken[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage may be unavailable / quota — fail soft.
  }
}

// ─── Public CRUD ───────────────────────────────────────────────────

/** List all tracked tokens. Pinned tokens are returned in their
 *  storage order (controlled by `reorderTokens` for user-facing
 *  ordering); unpinned tokens follow in alphabetical-by-symbol order.
 *  Hidden tokens are included; the page filters them. */
export function listTokens(): TrackedToken[] {
  const list = safeReadList();
  const pinned: TrackedToken[] = [];
  const unpinned: TrackedToken[] = [];
  for (const t of list) {
    if (t.pinned) pinned.push(t);
    else unpinned.push(t);
  }
  unpinned.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return [...pinned, ...unpinned];
}

/** Visible tokens only — convenience for the Tokens page. */
export function listVisibleTokens(): TrackedToken[] {
  return listTokens().filter((t) => !t.hidden);
}

/**
 * Add (or upsert) a token to the list. If a token with the same
 * lowercased contract already exists, fields are merged rather than
 * overwritten — preserves user's `pinned` / `hidden` choices when
 * `discoverTokens` re-runs.
 */
export function addToken(input: Omit<TrackedToken, "addedAt"> & Partial<Pick<TrackedToken, "addedAt">>): TrackedToken {
  const list = safeReadList();
  const contract = input.contract.toLowerCase();
  const existingIdx = list.findIndex((t) => t.contract === contract);
  const now = Date.now();
  if (existingIdx === -1) {
    const next: TrackedToken = {
      contract,
      kind: input.kind,
      symbol: input.symbol,
      name: input.name,
      decimals: input.decimals,
      hidden: input.hidden,
      pinned: input.pinned,
      addedAt: input.addedAt ?? now,
    };
    list.push(next);
    safeWriteList(list);
    return next;
  }
  const existing = list[existingIdx] as TrackedToken;
  // Merge: name / symbol / decimals are overwritten (chain is canonical);
  // hidden / pinned are sticky unless the input explicitly sets them.
  const merged: TrackedToken = {
    contract,
    kind: input.kind,
    symbol: input.symbol || existing.symbol,
    name: input.name || existing.name,
    decimals: input.decimals ?? existing.decimals,
    hidden: input.hidden ?? existing.hidden,
    pinned: input.pinned ?? existing.pinned,
    addedAt: existing.addedAt,
  };
  list[existingIdx] = merged;
  safeWriteList(list);
  return merged;
}

/** Remove a token entirely (e.g. user removed a mistaken custom add). */
export function removeToken(contract: string): boolean {
  const list = safeReadList();
  const next = list.filter((t) => t.contract !== contract.toLowerCase());
  if (next.length === list.length) return false;
  safeWriteList(next);
  return true;
}

/** Hide / unhide a token without removing it. */
export function setTokenHidden(contract: string, hidden: boolean): TrackedToken | null {
  const list = safeReadList();
  const idx = list.findIndex((t) => t.contract === contract.toLowerCase());
  if (idx === -1) return null;
  const existing = list[idx] as TrackedToken;
  const updated: TrackedToken = { ...existing, hidden };
  list[idx] = updated;
  safeWriteList(list);
  return updated;
}

/** Convenience wrappers. */
export function hideToken(contract: string): TrackedToken | null {
  return setTokenHidden(contract, true);
}
export function unhideToken(contract: string): TrackedToken | null {
  return setTokenHidden(contract, false);
}

/** Pin / unpin a token. */
export function setTokenPinned(contract: string, pinned: boolean): TrackedToken | null {
  const list = safeReadList();
  const idx = list.findIndex((t) => t.contract === contract.toLowerCase());
  if (idx === -1) return null;
  const existing = list[idx] as TrackedToken;
  const updated: TrackedToken = { ...existing, pinned };
  list[idx] = updated;
  safeWriteList(list);
  return updated;
}
export function pinToken(contract: string): TrackedToken | null {
  return setTokenPinned(contract, true);
}
export function unpinToken(contract: string): TrackedToken | null {
  return setTokenPinned(contract, false);
}

/** Reorder pinned tokens. `pinnedOrder` is an array of contract addresses;
 *  the function rewrites the storage list so that pinned tokens appear in
 *  the order specified. Non-pinned + un-listed tokens are untouched. */
export function reorderTokens(pinnedOrder: string[]): void {
  const list = safeReadList();
  const lcOrder = pinnedOrder.map((c) => c.toLowerCase());
  const ordered: TrackedToken[] = [];
  const seen = new Set<string>();
  for (const c of lcOrder) {
    const t = list.find((x) => x.contract === c);
    if (t) {
      ordered.push(t);
      seen.add(c);
    }
  }
  for (const t of list) {
    if (!seen.has(t.contract)) ordered.push(t);
  }
  safeWriteList(ordered);
}

/** Test-only. */
export function _resetTokenListForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
