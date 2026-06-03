// Tauri-store-backed notification store.
//
// A `@tauri-apps/plugin-store`-backed notifications store, using the
// singleton-store + in-memory-cache pattern of `vaultCatalog.ts` /
// `agent-registry.ts`.
//
// A single JSON store file (`notifications.v1.json`) holds a `scopes` map keyed
// per (address, chain) by the `mono.notifications.history.<addr>.<chainIdHex>.v1`
// string, so each scope's dedupe set lives beside its history.
//
// Public surface:
//   - `recordNotification(input)` — dedupe-check, append (capped, newest-
//     first), persist. Best-effort: every store failure is swallowed so the
//     caller (the OperationsDrawer terminal-transition hook) can never throw
//     back into the UI.
//   - `listAllNotifications()` — global inbox, newest-first across scopes.
//   - `markAllNotificationsRead()` / `markNotificationRead(id)` — flip read
//     state, return how many records changed.
//   - `getUnread()` — derived global unread count (single source of truth,
//     no separate counter key → no desync).
//   - `subscribeNotifications(fn)` — fires on every successful write so the
//     top-bar bell badge can re-read without polling.
//
// Recording stays a wallet-only act: the only caller of `recordNotification`
// is the in-app terminal-transition hook. No page / RPC path can synthesize
// a notification.

import { Store } from "@tauri-apps/plugin-store";
import {
  NOTIFICATION_HISTORY_CAP,
  appendCapped,
  incomingWatermarkKey,
  notificationId,
  notificationsHistoryKey,
  notifiedSetKey,
  parseHistoryEnvelope,
  parseIncomingWatermark,
  parseNotifiedSetEnvelope,
  type IncomingWatermark,
  type NotificationRecord,
  type NotificationsHistoryEnvelope,
  type NotifiedSetEnvelope,
  type TxOpKind,
} from "./notifications";

const STORE_FILE = "notifications.v1.json";
const STATE_KEY = "state";

/** On-disk root. `scopes` maps each per-(address, chain) storage key to its
 *  envelope. */
interface NotificationsState {
  version: 1;
  // Per-scope envelopes keyed by the per-(address, chain) storage key. Values
  // are tolerant-parsed at read time (history / notified-set /
  // incoming-watermark), so the map value stays `unknown`.
  scopes: Record<string, unknown>;
}

const EMPTY_STATE: NotificationsState = { version: 1, scopes: {} };

// ── Singleton store + in-memory cache ──
// The cache lets the bell badge + page read synchronously after a write
// without a disk round-trip; it's refreshed on every load/save and is the
// value handed to subscribers.

let storePromise: Promise<Store> | null = null;
let cache: NotificationsState | null = null;
const subscribers = new Set<() => void>();

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

function normalizeState(raw: unknown): NotificationsState {
  if (!raw || typeof raw !== "object") return { version: 1, scopes: {} };
  const r = raw as Record<string, unknown>;
  const scopes =
    r.scopes && typeof r.scopes === "object"
      ? (r.scopes as Record<string, unknown>)
      : {};
  return { version: 1, scopes: scopes as NotificationsState["scopes"] };
}

async function loadState(): Promise<NotificationsState> {
  if (cache) return cache;
  try {
    const store = await getStore();
    const raw = await store.get<NotificationsState>(STATE_KEY);
    cache = normalizeState(raw);
  } catch {
    cache = { ...EMPTY_STATE, scopes: {} };
  }
  return cache;
}

async function saveState(state: NotificationsState): Promise<void> {
  cache = state;
  const store = await getStore();
  await store.set(STATE_KEY, state);
  await store.save();
  notifySubscribers();
}

function notifySubscribers(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch {
      // A misbehaving subscriber must not break the write path.
    }
  }
}

/** Subscribe to store writes. Returns an unsubscribe fn. */
export function subscribeNotifications(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function readHistory(
  state: NotificationsState,
  key: string,
): NotificationsHistoryEnvelope {
  return (
    parseHistoryEnvelope(state.scopes[key]) ?? { schemaVersion: 0, entries: [] }
  );
}

function readNotifiedSet(
  state: NotificationsState,
  key: string,
): NotifiedSetEnvelope {
  return (
    parseNotifiedSetEnvelope(state.scopes[key]) ?? { schemaVersion: 0, ids: [] }
  );
}

/** Input for the terminal-transition hook — every field pre-normalized at the
 *  call site (status as the literal `"confirmed"` / `"failed"`, blockNumber as
 *  a finite number or null, etc.). */
export interface RecordNotificationInput {
  addressLower: string;
  chainIdHex: string;
  txHash: string;
  status: "confirmed" | "failed";
  blockNumber: number | null;
  kind: TxOpKind;
  amountDecimal: string;
  counterparty: string;
  /** For delegation kinds: the target cluster (optional). */
  clusterId?: number;
  clusterName?: string;
  /** `true` ⇒ store already-read (no badge bump). Defaults to unread. */
  read?: boolean;
}

/** Append a notification for a tracked-write terminal transition.
 *
 *  Idempotent on `(addressLower, chainIdHex, txHash)`: a second call returns
 *  `{ added: false, record: null }` without re-writing (the persisted notified
 *  set survives restarts so a relaunch can neither re-fire nor lose dedupe
 *  state).
 *
 *  Best-effort: any store failure is swallowed and reported as
 *  `{ added: false, record: null }` — a notification-write failure must never
 *  break the UI flow that triggered it.
 *
 *  Status fidelity: `status` is taken verbatim from the input; this function
 *  never coerces `"failed"` to `"confirmed"` or vice versa. */
export async function recordNotification(
  input: RecordNotificationInput,
): Promise<{ added: boolean; record: NotificationRecord | null }> {
  try {
    const id = notificationId(input.chainIdHex, input.txHash);
    const setKey = notifiedSetKey(input.addressLower, input.chainIdHex);
    const historyKey = notificationsHistoryKey(
      input.addressLower,
      input.chainIdHex,
    );

    const state = await loadState();
    const seen = readNotifiedSet(state, setKey);
    if (seen.ids.includes(id)) return { added: false, record: null };

    const record: NotificationRecord = {
      id,
      txHash: input.txHash,
      status: input.status,
      blockNumber: input.blockNumber,
      kind: input.kind,
      amountDecimal: input.amountDecimal,
      counterparty: input.counterparty,
      clusterId: input.clusterId,
      clusterName: input.clusterName,
      // Stamp the owning scope so a merged/global read can still attribute the
      // record to its vault. `addressLower` is the same address dimension the
      // history key is built from, so this is the single write chokepoint for
      // every record-creation path.
      scope: input.addressLower,
      createdAtMs: Date.now(),
      read: input.read ?? false,
      schemaVersion: 0,
    };

    const history = readHistory(state, historyKey);
    const nextEntries = appendCapped(
      history.entries,
      record,
      NOTIFICATION_HISTORY_CAP,
    );

    await saveState({
      version: 1,
      scopes: {
        ...state.scopes,
        [historyKey]: { schemaVersion: 0, entries: nextEntries },
        [setKey]: { schemaVersion: 0, ids: [...seen.ids, id] },
      },
    });

    return { added: true, record };
  } catch {
    return { added: false, record: null };
  }
}

/** Read the incoming-transfer watermark for an (address, chain) scope, or null
 *  when none has been baselined yet. Best-effort. */
export async function getIncomingWatermark(
  addressLower: string,
  chainIdHex: string,
): Promise<IncomingWatermark | null> {
  try {
    const state = await loadState();
    return parseIncomingWatermark(
      state.scopes[incomingWatermarkKey(addressLower, chainIdHex)],
    );
  } catch {
    return null;
  }
}

/** Persist the incoming-transfer watermark for an (address, chain) scope.
 *  Best-effort — a store failure is swallowed (the next pass re-baselines). */
export async function setIncomingWatermark(
  addressLower: string,
  chainIdHex: string,
  watermark: IncomingWatermark,
): Promise<void> {
  try {
    const state = await loadState();
    await saveState({
      version: 1,
      scopes: {
        ...state.scopes,
        [incomingWatermarkKey(addressLower, chainIdHex)]: watermark,
      },
    });
  } catch {
    // Best-effort — never throw back into the detect path.
  }
}

/** GLOBAL inbox read — every history scope's entries, merged + sorted
 *  newest-first by `createdAtMs`. Empty on any failure. */
export async function listAllNotifications(): Promise<NotificationRecord[]> {
  try {
    const state = await loadState();
    const merged: NotificationRecord[] = [];
    for (const [k, v] of Object.entries(state.scopes)) {
      if (!k.startsWith("mono.notifications.history.")) continue;
      const env = parseHistoryEnvelope(v);
      if (!env) continue;
      merged.push(...env.entries);
    }
    merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return merged;
  } catch {
    return [];
  }
}

/** Per-SCOPE read — only the records recorded under `scope` (the lowercased
 *  owning address), merged newest-first across that scope's chains. The Activity
 *  page sources its vault-owned rows (e.g. failed txs) through this so one
 *  vault's rows can never appear under another.
 *
 *  Attribution is by the storage-key scope (the address dimension of
 *  `notificationsHistoryKey`), which has always encoded the owning address — so
 *  records written before the `scope` field are still owned correctly and never
 *  leak, with no fabricated scope. The trailing `.` in the prefix prevents one
 *  address from matching another that merely shares its prefix. Empty on any
 *  failure. */
export async function listForScope(scope: string): Promise<NotificationRecord[]> {
  try {
    const state = await loadState();
    const prefix = `mono.notifications.history.${scope}.`;
    const merged: NotificationRecord[] = [];
    for (const [k, v] of Object.entries(state.scopes)) {
      if (!k.startsWith(prefix)) continue;
      const env = parseHistoryEnvelope(v);
      if (!env) continue;
      merged.push(...env.entries);
    }
    merged.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return merged;
  } catch {
    return [];
  }
}

/** Flip ONE record's `read` to `true` by its full id. Returns
 *  `{ flipped: true }` only when the record was found AND was previously
 *  unread (a second tap is a no-op). Best-effort. */
export async function markNotificationRead(
  id: string,
): Promise<{ flipped: boolean }> {
  try {
    const state = await loadState();
    for (const [k, v] of Object.entries(state.scopes)) {
      if (!k.startsWith("mono.notifications.history.")) continue;
      const env = parseHistoryEnvelope(v);
      if (!env) continue;
      let flipped = false;
      const next = env.entries.map((r) => {
        if (r.id !== id || r.read) return r;
        flipped = true;
        return { ...r, read: true };
      });
      if (flipped) {
        await saveState({
          version: 1,
          scopes: {
            ...state.scopes,
            [k]: { schemaVersion: 0, entries: next },
          },
        });
        return { flipped: true };
      }
    }
    return { flipped: false };
  } catch {
    return { flipped: false };
  }
}

/** GLOBAL mark-all-read — flip every unread record across every scope.
 *  Returns the count that changed. Best-effort. */
export async function markAllNotificationsRead(): Promise<{ flipped: number }> {
  try {
    const state = await loadState();
    let flipped = 0;
    const nextScopes: NotificationsState["scopes"] = { ...state.scopes };
    for (const [k, v] of Object.entries(state.scopes)) {
      if (!k.startsWith("mono.notifications.history.")) continue;
      const env = parseHistoryEnvelope(v);
      if (!env) continue;
      let scopeChanged = false;
      const next = env.entries.map((r) => {
        if (r.read) return r;
        flipped++;
        scopeChanged = true;
        return { ...r, read: true };
      });
      if (scopeChanged) {
        nextScopes[k] = { schemaVersion: 0, entries: next };
      }
    }
    if (flipped > 0) {
      await saveState({ version: 1, scopes: nextScopes });
    }
    return { flipped };
  } catch {
    return { flipped: 0 };
  }
}

/** Derived global unread count = sum of `!read` across every history scope.
 *  Single source of truth (no separate counter → no sync hazard). */
export async function getUnread(): Promise<number> {
  try {
    const state = await loadState();
    let total = 0;
    for (const [k, v] of Object.entries(state.scopes)) {
      if (!k.startsWith("mono.notifications.history.")) continue;
      const env = parseHistoryEnvelope(v);
      if (!env) continue;
      for (const r of env.entries) if (!r.read) total++;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Test-only — reset the singleton store + cache so each test starts clean.
 *  Not used by the app. */
export function __resetNotificationsStoreForTests(): void {
  storePromise = null;
  cache = null;
  subscribers.clear();
}
