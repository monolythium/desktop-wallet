// The version self-check pattern: a 12-hour gate, an honest-absence fold, and
// verdict reconciliation across a version change.
//
// The problem this solves is that a check has THREE outcomes and only two of
// them are answers. "There is a newer release" and "there is not" are answers.
// "I couldn't reach the update service" is not — and folding it into either
// answer produces a lie: fold it into "no update" and a real pending update
// disappears on a network blip; fold it into "update available" and the wallet
// nags about a release that may not exist.
//
// So: `unavailable` KEEPS THE PRIOR VERDICT, in both directions. A non-answer
// changes nothing.
//
// The keep-prior rule has one dangerous consequence, and `reconcileUpdateCacheOnBoot`
// exists solely for it: after the user actually installs the update, the cached
// "update available" verdict is stale by construction, and keep-prior would
// preserve it indefinitely behind the 12-hour gate. So a cache whose
// `appVersion` no longer matches the running binary is DISCARDED at boot,
// before anything reads it.
//
// ── S1: the naming ──────────────────────────────────────────────────────────
// The updater seam already ships a three-way discriminated union
// (`available | none | error`) with landed consumers — About renders
// "couldn't check for updates" on `error`, and the banner shows only on
// `available`. Those names stay. This module maps them to the persisted
// vocabulary at the cache boundary (`cacheStatusOf`), because the stored record
// is a versioned on-disk FORMAT and deserves stable, self-describing names of
// its own. Renaming the runtime union would have touched every consumer for no
// behavioural gain, with a real risk of regressing the honest-absence handling
// those consumers already implement.

import { isTauriRuntime } from "./about";
import { checkForUpdate, type UpdateCheckResult } from "./updater";

/** Check at most about twice a day. */
export const WALLET_UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Versioned cache key. */
export const STORAGE_KEY_UPDATE_CHECK = "wallet.updateCheck.v1";

/** The persisted verdict vocabulary. */
export type UpdateCacheStatus = "update_available" | "no_update" | "unavailable";

const KNOWN_STATUSES: readonly string[] = [
  "update_available",
  "no_update",
  "unavailable",
];

export interface UpdateCheckRecord {
  /** Epoch ms of the last completed check. */
  lastCheckAt: number;
  /** The folded verdict — NOT the last status. A non-answer leaves it alone. */
  updateAvailable: boolean;
  /** The last answer received. Absent when the stored value was unrecognized. */
  lastStatus?: UpdateCacheStatus;
  /** The running wallet version when this record was written — the reconcile
   *  anchor. */
  appVersion: string;
  /** The version offered by the manifest, when one was. */
  offeredVersion: string | null;
}

/** Map the updater seam's union onto the persisted vocabulary. See S1 above. */
export function cacheStatusOf(result: UpdateCheckResult): UpdateCacheStatus {
  switch (result.kind) {
    case "available":
      return "update_available";
    case "none":
      return "no_update";
    case "error":
      return "unavailable";
  }
}

/**
 * Parse a stored record, tolerantly.
 *
 * A structurally broken record is treated as NEVER CHECKED rather than
 * repaired with defaults — inventing `updateAvailable: false` from garbage
 * would be a fabricated verdict. An unrecognized `lastStatus` is different: the
 * rest of the record is still trustworthy, so only that field is dropped (it
 * affects copy, not the verdict).
 */
export function parseUpdateCheckRecord(raw: string | null): UpdateCheckRecord | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;

  if (typeof r.lastCheckAt !== "number" || !Number.isFinite(r.lastCheckAt)) return null;
  if (typeof r.updateAvailable !== "boolean") return null;
  if (typeof r.appVersion !== "string") return null;

  const offeredVersion = typeof r.offeredVersion === "string" ? r.offeredVersion : null;
  const record: UpdateCheckRecord = {
    lastCheckAt: r.lastCheckAt,
    updateAvailable: r.updateAvailable,
    appVersion: r.appVersion,
    offeredVersion,
  };
  if (typeof r.lastStatus === "string" && KNOWN_STATUSES.includes(r.lastStatus)) {
    record.lastStatus = r.lastStatus as UpdateCacheStatus;
  }
  return record;
}

export function readUpdateCheckRecord(): UpdateCheckRecord | null {
  try {
    return parseUpdateCheckRecord(localStorage.getItem(STORAGE_KEY_UPDATE_CHECK));
  } catch {
    return null;
  }
}

export function writeUpdateCheckRecord(record: UpdateCheckRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY_UPDATE_CHECK, JSON.stringify(record));
  } catch {
    // Storage unavailable — the check simply re-runs next launch.
  }
}

export function clearUpdateCheckRecord(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_UPDATE_CHECK);
  } catch {
    // Nothing to do.
  }
}

/**
 * Is the 12-hour gate open?
 *
 * A FUTURE timestamp counts as stale. A clock change or a corrupt write could
 * otherwise park `lastCheckAt` far ahead and close the gate permanently — the
 * wallet would never check again, and would never say why.
 */
export function shouldCheckWalletUpdate(lastCheckAt: number | null, now: number): boolean {
  if (lastCheckAt === null) return true;
  if (lastCheckAt > now) return true;
  return now - lastCheckAt >= WALLET_UPDATE_CHECK_INTERVAL_MS;
}

/** Fold an answer into the standing verdict. `unavailable` keeps the prior —
 *  in BOTH directions. */
export function nextUpdateAvailable(status: UpdateCacheStatus, prior: boolean): boolean {
  switch (status) {
    case "update_available":
      return true;
    case "no_update":
      return false;
    case "unavailable":
      return prior;
  }
}

/**
 * Discard a cache written by a different binary. Returns the surviving record.
 *
 * MUST run before anything reads the cache — see the header. The removal is a
 * side effect on purpose: leaving a stale record readable "just this once"
 * defeats the whole point.
 */
export function reconcileUpdateCacheOnBoot(
  record: UpdateCheckRecord | null,
  runningVersion: string,
): UpdateCheckRecord | null {
  if (record === null) return null;
  if (record.appVersion === runningVersion) return record;
  clearUpdateCheckRecord();
  return null;
}

/** What the update surfaces render from. */
export interface UpdateSurfaceState {
  /** The folded verdict. */
  updateAvailable: boolean;
  /** The offered version, when the manifest named one. */
  offeredVersion: string | null;
  /** The last real answer, or null when never checked. */
  lastStatus: UpdateCacheStatus | null;
  /** Browser preview — the updater cannot run and nothing was written. */
  preview: boolean;
}

const PREVIEW_STATE: UpdateSurfaceState = {
  updateAvailable: false,
  offeredVersion: null,
  lastStatus: null,
  preview: true,
};

function stateOf(record: UpdateCheckRecord | null): UpdateSurfaceState {
  return {
    updateAvailable: record?.updateAvailable ?? false,
    offeredVersion: record?.offeredVersion ?? null,
    lastStatus: record?.lastStatus ?? null,
    preview: false,
  };
}

/**
 * The single orchestration path for both surfaces (boot banner and the About
 * row), so neither can grow its own ordering.
 *
 * 1. reconcile — BEFORE any read
 * 2. read the cache
 * 3. browser preview → stop, and never write
 * 4. gate closed and not forced → stop, NO NETWORK
 * 5. check, fold, persist
 *
 * `force` is for user-initiated actions (pressing Install), which may always hit
 * the network — the gate exists to stop unattended polling, not to stop the
 * user.
 */
export async function syncWalletUpdateState(opts: {
  now: number;
  runningVersion: string;
  force?: boolean;
}): Promise<UpdateSurfaceState> {
  const { now, runningVersion, force = false } = opts;

  const surviving = reconcileUpdateCacheOnBoot(readUpdateCheckRecord(), runningVersion);

  if (!isTauriRuntime()) return PREVIEW_STATE;

  if (!force && !shouldCheckWalletUpdate(surviving?.lastCheckAt ?? null, now)) {
    return stateOf(surviving);
  }

  const result = await checkForUpdate();
  const status = cacheStatusOf(result);
  const prior = surviving?.updateAvailable ?? false;
  const updateAvailable = nextUpdateAvailable(status, prior);
  // The offered version follows the verdict: it is only meaningful while one
  // stands, and a kept-prior verdict keeps the version it was offered with.
  const offeredVersion =
    result.kind === "available"
      ? result.version
      : updateAvailable
        ? surviving?.offeredVersion ?? null
        : null;

  const record: UpdateCheckRecord = {
    lastCheckAt: now,
    updateAvailable,
    lastStatus: status,
    appVersion: runningVersion,
    offeredVersion,
  };
  writeUpdateCheckRecord(record);
  return stateOf(record);
}
