// Sent-recipients log — persistence (the model + integrity crypto live in
// sent-recipients.ts).
//
// A single `@tauri-apps/plugin-store` file (`sent-recipients.v1.json`) holds a
// `scopes` map keyed per (sender, chain) by `sentRecipientsScopeKey`, following
// the singleton-store + in-memory-cache pattern of `notifications-store.ts`.
//
// Fail-SAFE everywhere: a write persists nothing on any error (never an untagged
// or partial entry), and a verify returns `false` on any problem (missing entry,
// no session key, parse-empty, store error, tag mismatch) — so a verification
// PROBLEM can only make the first-time warning FIRE, never quiet it. Outside
// Tauri the store is a no-op (reads empty, writes silently skip); the warning
// then rests on history alone — the safe direction.

import { Store } from "@tauri-apps/plugin-store";
import { requireTypedUserAddressHex } from "./address";
import { scopeChainKey } from "./chains";
import {
  SENT_RECIPIENTS_CAP,
  computeSentRecipientTag,
  parseSentRecipientsEnvelope,
  sentRecipientMacMessage,
  sentRecipientsScopeKey,
  upsertSentEntry,
  verifySentRecipientTag,
} from "./sent-recipients";

const STORE_FILE = "sent-recipients.v1.json";
const STATE_KEY = "state";

/** On-disk root — `scopes` maps each per-(sender, chain) key to its envelope
 *  (tolerant-parsed at read time, so the value stays `unknown`). */
interface SentRecipientsState {
  version: 1;
  scopes: Record<string, unknown>;
}

const EMPTY_STATE: SentRecipientsState = { version: 1, scopes: {} };

let storePromise: Promise<Store> | null = null;
let cache: SentRecipientsState | null = null;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(STORE_FILE);
  return storePromise;
}

function normalizeState(raw: unknown): SentRecipientsState {
  if (!raw || typeof raw !== "object") return { version: 1, scopes: {} };
  const r = raw as Record<string, unknown>;
  const scopes = r.scopes && typeof r.scopes === "object" ? (r.scopes as Record<string, unknown>) : {};
  return { version: 1, scopes };
}

async function loadState(): Promise<SentRecipientsState> {
  if (cache) return cache;
  try {
    const store = await getStore();
    cache = normalizeState(await store.get<SentRecipientsState>(STATE_KEY));
  } catch {
    cache = { ...EMPTY_STATE, scopes: {} };
  }
  return cache;
}

/** Persist, updating the in-memory cache ONLY after a successful disk write — so
 *  a failed write leaves nothing "written" (not even in memory). */
async function saveState(state: SentRecipientsState): Promise<void> {
  const store = await getStore();
  await store.set(STATE_KEY, state);
  await store.save();
  cache = state;
}

/**
 * Record a successful send's recipient into the durable log, bound by an
 * integrity tag under this vault's seed-derived session sub-key. Post-broadcast,
 * inside `execute()` while the operation-scoped seed is still in memory.
 *
 * Fail-safe: ANY failure (address parse, tag compute, store write) writes nothing
 * — the next send re-warns and re-writes. Never throws back into the send flow.
 * A no-op outside Tauri.
 */
export async function recordSentRecipient(args: {
  seed: Uint8Array;
  fromBech32m: string;
  toBech32m: string;
}): Promise<void> {
  try {
    if (!isTauri()) return;
    const vaultAddr0xLower = requireTypedUserAddressHex(args.fromBech32m, "vault").toLowerCase();
    const recipient0xLower = requireTypedUserAddressHex(args.toBech32m, "recipient").toLowerCase();
    const chainIdHex = scopeChainKey();
    const message = sentRecipientMacMessage(vaultAddr0xLower, chainIdHex, recipient0xLower);
    // Compute the tag FIRST; only touch the store once we have a complete entry.
    const tag = await computeSentRecipientTag(args.seed, vaultAddr0xLower, message);
    const scopeKey = sentRecipientsScopeKey(args.fromBech32m.toLowerCase(), chainIdHex);
    const state = await loadState();
    const env = parseSentRecipientsEnvelope(state.scopes[scopeKey]);
    const nextEntries = upsertSentEntry(env.entries, { a: recipient0xLower, t: tag }, SENT_RECIPIENTS_CAP);
    await saveState({ version: 1, scopes: { ...state.scopes, [scopeKey]: { v: 1, entries: nextEntries } } });
  } catch {
    // Fail-safe: never persist a partial/untagged entry; the next send self-heals.
  }
}

/**
 * True only when the log holds an entry for this recipient AND its tag verifies
 * under the cached session sub-key. Every problem (no entry, no session key,
 * parse-empty, store error, tag mismatch) → `false`, so a verification problem
 * can only make the warning FIRE. A no-op `false` outside Tauri.
 */
export async function isSentRecipientVerified(args: {
  fromBech32m: string;
  toBech32m: string;
}): Promise<boolean> {
  try {
    if (!isTauri()) return false;
    const vaultAddr0xLower = requireTypedUserAddressHex(args.fromBech32m, "vault").toLowerCase();
    const recipient0xLower = requireTypedUserAddressHex(args.toBech32m, "recipient").toLowerCase();
    const chainIdHex = scopeChainKey();
    const scopeKey = sentRecipientsScopeKey(args.fromBech32m.toLowerCase(), chainIdHex);
    const state = await loadState();
    const env = parseSentRecipientsEnvelope(state.scopes[scopeKey]);
    const entry = env.entries.find((e) => e.a === recipient0xLower);
    if (!entry) return false;
    const message = sentRecipientMacMessage(vaultAddr0xLower, chainIdHex, recipient0xLower);
    return await verifySentRecipientTag(vaultAddr0xLower, message, entry.t);
  } catch {
    return false;
  }
}

/** Drop every sent-recipients scope owned by `addressLower`. Exact-prefix scoped
 *  (`mono.sent-recipients.<addressLower>.` — trailing dot) so one vault's purge
 *  can never touch another's. Best-effort. */
export async function purgeScopesForAddress(addressLower: string): Promise<void> {
  try {
    const state = await loadState();
    const prefix = `mono.sent-recipients.${addressLower}.`;
    const nextScopes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state.scopes)) {
      if (k.startsWith(prefix)) continue;
      nextScopes[k] = v;
    }
    await saveState({ version: 1, scopes: nextScopes });
  } catch {
    // Best-effort — a purge failure just leaves the (now-unreferenced) scopes.
  }
}

/** Test-only — reset the singleton store + cache so each test starts clean. */
export function __resetSentRecipientsStoreForTests(): void {
  storePromise = null;
  cache = null;
}
