// Chain registry — the builtin Monolythium Testnet plus user-added custom chains,
// the active-chain selection, and the per-(address, chain) scope key.
//
// Exactly ONE builtin chain ships; a hardened (packaged) build sees only it
// (build-mode law 3 — custom chains are a developer tool). Custom chains are
// stored under `wallet.chains.user`, re-validated on load (a corrupt entry is
// silently dropped so a bad write can never break boot), and the active-chain id
// (`wallet.chain.active`) is guarded at read time: a stored id that no longer
// resolves reads as the builtin without being persisted back.
//
// Storage canonical form is UPPERCASE hex (`0x10F2C`); all comparisons are
// case-insensitive; the SCOPE key alone is lowercased so it stays byte-identical
// to the string the existing per-(address, chain) stores already use.

import {
  MONOLYTHIUM_TESTNET_RPC_GATEWAY,
  currentEndpoint,
  isKnownEndpoint,
  resolveActiveEndpoint,
  setEndpoint,
} from "./client";
import { isHardenedBuild } from "./build-mode";

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainRecord {
  /** Canonical UPPERCASE hex chain id, e.g. "0x10F2C". Also the registry key. */
  chainId: string;
  /** Decimal chain id, e.g. 69420. */
  chainIdNum: number;
  name: string;
  /** Display metadata for the Networks row; actual dialing goes through the fleet
   *  seam (never this field) for the builtin chain. */
  rpc: string;
  official: boolean;
  builtin: boolean;
  blockExplorer?: string;
  nativeCurrency?: NativeCurrency;
}

/** The one builtin chain's canonical id. */
export const BUILTIN_CHAIN_ID = "0x10F2C";
/** localStorage keys — device-level (not per-address); survive lock + reset. */
export const ACTIVE_CHAIN_KEY = "wallet.chain.active";
export const USER_CHAINS_KEY = "wallet.chains.user";

/** The one builtin chain. `decimals` is 18 (1 LYTH = 10^18 lythoshi). The `rpc`
 *  is display metadata for the Networks row only — the builtin chain dials
 *  through the fleet seam. */
export const BUILTIN_CHAIN: ChainRecord = {
  chainId: BUILTIN_CHAIN_ID,
  chainIdNum: 69420,
  name: "Monolythium Testnet",
  rpc: MONOLYTHIUM_TESTNET_RPC_GATEWAY,
  nativeCurrency: { name: "Monolythium LYTH", symbol: "LYTH", decimals: 18 },
  official: true,
  builtin: true,
};

/**
 * Canonicalize a chain id (pure). Decimal input converts to hex; hex input
 * uppercases after the `0x` prefix; a non-positive / non-finite / malformed input
 * → `null`. The canonical form is `"0x" + UPPERCASE hex`.
 */
export function canonicalChainKey(id: string | number): string | null {
  let n: number;
  if (typeof id === "number") {
    n = id;
  } else {
    const s = id.trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) n = Number.parseInt(s.slice(2), 16);
    else if (/^\d+$/.test(s)) n = Number.parseInt(s, 10);
    else return null;
  }
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return "0x" + n.toString(16).toUpperCase();
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

/** Validate + normalize an unknown stored value into a ChainRecord, or `null`
 *  when malformed (dropped on load). Same rules as {@link addUserChain}; always
 *  a custom (non-builtin, non-official) record keyed by its canonical id. */
function normalizeUserChain(value: unknown): ChainRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const key = typeof v.chainId === "string" || typeof v.chainId === "number" ? canonicalChainKey(v.chainId) : null;
  if (key === null) return null;
  if (typeof v.name !== "string" || v.name.length < 1 || v.name.length > 64) return null;
  if (typeof v.rpc !== "string" || !isHttpUrl(v.rpc)) return null;
  const record: ChainRecord = {
    chainId: key,
    chainIdNum: Number.parseInt(key.slice(2), 16),
    name: v.name,
    rpc: v.rpc,
    official: false,
    builtin: false,
  };
  if (typeof v.blockExplorer === "string" && v.blockExplorer !== "") {
    if (!isHttpsUrl(v.blockExplorer)) return null;
    record.blockExplorer = v.blockExplorer;
  }
  const cur = normalizeCurrency(v.nativeCurrency);
  if (cur) record.nativeCurrency = cur;
  return record;
}

function normalizeCurrency(value: unknown): NativeCurrency | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (typeof c.name !== "string" || c.name.length < 1 || c.name.length > 32) return null;
  if (typeof c.symbol !== "string" || c.symbol.length < 1 || c.symbol.length > 10) return null;
  if (typeof c.decimals !== "number" || !Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 30) {
    return null;
  }
  return { name: c.name, symbol: c.symbol, decimals: c.decimals };
}

/** Read the user's custom chains, re-validated per entry (malformed dropped). */
export function readUserChains(): Record<string, ChainRecord> {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(USER_CHAINS_KEY);
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const out: Record<string, ChainRecord> = {};
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const record = normalizeUserChain(value);
    if (record) out[record.chainId] = record;
  }
  return out;
}

/** Persist the user chains. Best-effort — a storage failure is swallowed. */
export function writeUserChains(chains: Record<string, ChainRecord>): void {
  try {
    localStorage.setItem(USER_CHAINS_KEY, JSON.stringify(chains));
  } catch {
    // localStorage unavailable — fall through.
  }
}

/** Hardened builds see ONLY the builtin chain; development builds see builtin +
 *  user chains (builtin always wins a key collision). Stored custom chains are
 *  never deleted in a hardened build — a development build keeps them. */
export function hardenedChains(
  builtin: Record<string, ChainRecord>,
  user: Record<string, ChainRecord>,
  hardened: boolean,
): Record<string, ChainRecord> {
  return hardened ? { ...builtin } : { ...user, ...builtin };
}

/** The resolved chain registry: builtin (+ user chains in a development build). */
export function chainRegistry(): Record<string, ChainRecord> {
  return hardenedChains({ [BUILTIN_CHAIN_ID]: BUILTIN_CHAIN }, readUserChains(), isHardenedBuild());
}

/**
 * The active chain id (canonical). Lookup-miss guard: when the stored id does not
 * resolve in the current registry (a deleted chain, or a custom chain under a
 * hardened build), the active chain IS the builtin — applied at READ time, never
 * persisted back silently.
 */
export function readActiveChainId(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(ACTIVE_CHAIN_KEY);
  } catch {
    stored = null;
  }
  if (!stored) return BUILTIN_CHAIN_ID;
  const key = canonicalChainKey(stored);
  if (key !== null && chainRegistry()[key]) return key;
  return BUILTIN_CHAIN_ID;
}

/** The active chain's record (builtin fallback via the lookup-miss guard). */
export function activeChainRecord(): ChainRecord {
  return chainRegistry()[readActiveChainId()] ?? BUILTIN_CHAIN;
}

/**
 * The per-(address, chain) scope key component for the ACTIVE chain — the
 * canonical key LOWERCASED. Pinned by test: the builtin chain's `scopeChainKey()`
 * is byte-identical to `"0x10f2c"`, the string the existing warm-start / activity
 * / notifications / pending-tx stores already key on, so no migration is needed.
 */
export function scopeChainKey(): string {
  return (canonicalChainKey(readActiveChainId()) ?? BUILTIN_CHAIN_ID).toLowerCase();
}

// ── User-chain CRUD (storage layer — the UI re-validates the same rules) ─────

export interface ChainInput {
  chainId: string;
  name: string;
  rpc: string;
  blockExplorer?: string;
  nativeCurrency?: NativeCurrency;
}

export interface ChainPatch {
  name?: string;
  rpc?: string;
  /** "" or null → delete the field; a non-empty string → set (must be https). */
  blockExplorer?: string | null;
  /** null → delete; an object → set. */
  nativeCurrency?: NativeCurrency | null;
}

type ChainResult = { ok: true; record: ChainRecord } | { ok: false; reason: string };
type DeleteResult = { ok: true } | { ok: false; reason: string };

/** Add a custom chain. Verbatim reject reasons per the add-form spec. */
export function addUserChain(input: ChainInput): ChainResult {
  if (!input || !input.chainId?.trim() || !input.name?.trim() || !input.rpc?.trim()) {
    return { ok: false, reason: "missing chainId, name, or rpc" };
  }
  const chainId = input.chainId.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(chainId)) return { ok: false, reason: "chainId must be 0x-prefixed hex" };
  const key = canonicalChainKey(chainId);
  if (key === null) return { ok: false, reason: "chainId must be a positive integer" };
  if (chainRegistry()[key]) return { ok: false, reason: "chain id already exists" };
  const name = input.name.trim();
  if (name.length < 1 || name.length > 64) return { ok: false, reason: "name must be 1-64 chars" };
  const rpc = input.rpc.trim();
  if (!isHttpUrl(rpc)) return { ok: false, reason: "rpc must be a valid URL" };
  const explorer = input.blockExplorer?.trim();
  if (explorer && !isHttpsUrl(explorer)) return { ok: false, reason: "blockExplorer must be a valid URL" };
  const record: ChainRecord = {
    chainId: key,
    chainIdNum: Number.parseInt(key.slice(2), 16),
    name,
    rpc,
    official: false,
    builtin: false,
    ...(explorer ? { blockExplorer: explorer } : {}),
    ...(input.nativeCurrency ? { nativeCurrency: input.nativeCurrency } : {}),
  };
  const chains = readUserChains();
  chains[key] = record;
  writeUserChains(chains);
  return { ok: true, record };
}

/** Edit a custom chain (the chainId is the immutable key). Patch semantics: a
 *  blank/null blockExplorer deletes the field; a null nativeCurrency deletes it;
 *  an object sets it. Verbatim reject reasons per the edit-form spec. */
export function editUserChain(chainId: string, patch: ChainPatch): ChainResult {
  if (!chainId || !patch) return { ok: false, reason: "missing chainId or patch" };
  const key = canonicalChainKey(chainId);
  if (key === BUILTIN_CHAIN_ID) return { ok: false, reason: "cannot edit builtin chain" };
  if (key === null) return { ok: false, reason: "unknown chain" };
  const chains = readUserChains();
  const existing = chains[key];
  if (!existing) return { ok: false, reason: "unknown chain" };
  const record: ChainRecord = { ...existing };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 1 || name.length > 64) return { ok: false, reason: "name must be 1-64 chars" };
    record.name = name;
  }
  if (patch.rpc !== undefined) {
    const rpc = patch.rpc.trim();
    if (!isHttpUrl(rpc)) return { ok: false, reason: "rpc must be a valid URL" };
    record.rpc = rpc;
  }
  if (patch.blockExplorer !== undefined) {
    const explorer = patch.blockExplorer?.trim();
    if (!explorer) delete record.blockExplorer;
    else if (!isHttpsUrl(explorer)) return { ok: false, reason: "blockExplorer must be a valid URL" };
    else record.blockExplorer = explorer;
  }
  if (patch.nativeCurrency !== undefined) {
    if (patch.nativeCurrency === null) delete record.nativeCurrency;
    else record.nativeCurrency = patch.nativeCurrency;
  }
  chains[key] = record;
  writeUserChains(chains);
  return { ok: true, record };
}

/** Delete a custom chain. Verbatim reject reasons per the detail-view spec. */
export function deleteUserChain(chainId: string): DeleteResult {
  const key = canonicalChainKey(chainId);
  if (key === BUILTIN_CHAIN_ID) return { ok: false, reason: "cannot delete builtin chain" };
  if (key === null) return { ok: false, reason: "unknown chain" };
  const chains = readUserChains();
  if (!chains[key]) return { ok: false, reason: "unknown chain" };
  delete chains[key];
  writeUserChains(chains);
  return { ok: true };
}

// ── Active-chain selection + notification ────────────────────────────────────

const activeChainSubscribers = new Set<(chainId: string) => void>();

/** Subscribe to active-chain changes. Returns an unsubscribe function. Fires even
 *  when the endpoint URL is unchanged (two chains can share one RPC host), so a
 *  subscriber always re-scopes to the CHAIN, not just the endpoint. */
export function subscribeActiveChain(callback: (chainId: string) => void): () => void {
  activeChainSubscribers.add(callback);
  return () => {
    activeChainSubscribers.delete(callback);
  };
}

/**
 * Activate a chain (persist + follow the endpoint + notify). The id MUST resolve
 * in the current registry, else `{ ok: false, reason: "unknown chain" }`. On
 * success: persist the canonical key; for a custom chain dial its rpc, for the
 * builtin keep the current endpoint when it is still fleet-known else fall back to
 * the resolved default; then notify subscribers (which drives the health machine
 * restart + the per-(address, chain) rescope through {@link scopeChainKey}).
 */
export function setActiveChain(chainId: string): { ok: true } | { ok: false; reason: string } {
  const key = canonicalChainKey(chainId);
  const record = key !== null ? chainRegistry()[key] : undefined;
  if (key === null || !record) return { ok: false, reason: "unknown chain" };
  try {
    localStorage.setItem(ACTIVE_CHAIN_KEY, key);
  } catch {
    // Best-effort — the in-memory notification below still applies for the session.
  }
  if (!record.builtin) {
    setEndpoint(record.rpc);
  } else if (!isKnownEndpoint(currentEndpoint())) {
    setEndpoint(resolveActiveEndpoint());
  }
  for (const callback of activeChainSubscribers) callback(key);
  return { ok: true };
}

/** Test-only — clear the active-chain subscribers so each test starts clean. */
export function __resetChainsForTests(): void {
  activeChainSubscribers.clear();
}
