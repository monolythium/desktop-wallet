// User-authored operator override store — a validated, persisted replacement for
// the default operator (RPC endpoint) list the wallet dials.
//
// The wallet's default fleet is the SDK registry (the public gateway + the
// testnet-69420 operators). A power user (developer build only, per build-mode
// law 3) may override it with their own nodes. This module owns the storage
// contract and the whole-list validation; the hardened-build dial rule
// (hardenedOperators / overrideWithinFleet) lives alongside it and the
// effective-fleet composition lives in fleet.ts.
//
// Fail-closed storage: the persisted value is RE-VALIDATED on every read, so a
// hand-edited or corrupt `wallet.operators.override` can never inject a malformed
// or unbounded list into the dial path — it simply falls back to the defaults.

import { listPeers, type Peer } from "./peers";
import { isHardenedBuild } from "./build-mode";

export interface OperatorEntry {
  /** Human label for the operator row. */
  name: string;
  /** Region code, or "" when unknown/blank. */
  region: string;
  /** RPC endpoint URL — http(s) only. */
  rpc: string;
}

/** Upper bound on an override list, so a tampered or hand-edited stored value can
 *  never materialize an unbounded array. The live fleet (40 operators + gateway)
 *  is well under this. */
export const MAX_OPERATORS = 64;

/** localStorage key for the user's operator override. Global scope (operator
 *  identity is not per-address): survives lock, relaunch, and wallet reset, like
 *  `wallet.rpcEndpoint`. Absent key (or null) means "use the defaults". */
export const OPERATOR_OVERRIDE_KEY = "wallet.operators.override";

/** Verbatim reject reasons surfaced by {@link writeOperatorOverride}. */
export const INVALID_LIST_REASON = "invalid operator list";
export const STORAGE_FAIL_REASON = "couldn't save the operator list — storage unavailable";
/** The save-time reject in a hardened (packaged) build when the override reaches
 *  outside the canonical fleet (build-mode law 3 — pre-committed copy). */
export const HARDENED_REJECT_REASON =
  "This build only dials the built-in operators. Reorder or pin the listed operators — adding a custom RPC host needs a developer build.";

/**
 * Validate an unknown value as an operator list (WHOLE-LIST reject). Returns the
 * cleaned list (unknown fields stripped) or `null` when ANY rule fails — a
 * partially-honored override would silently drop entries the user typed, so the
 * caller falls back to the defaults instead. Rules, in order:
 *   1. `input` must be an array, non-empty, `length <= MAX_OPERATORS`;
 *   2. per entry: `name` a string of 1-64 chars; `region` a string of 0-32 chars
 *      (blank allowed); `rpc` a parseable URL whose protocol is `http:` or
 *      `https:` (every other scheme rejects);
 *   3. one malformed entry invalidates the WHOLE list;
 *   4. unknown extra fields on an entry are stripped, not stored.
 */
export function validateOperatorList(input: unknown): OperatorEntry[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_OPERATORS) return null;
  const out: OperatorEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const { name, region, rpc } = r;
    if (typeof name !== "string" || name.length < 1 || name.length > 64) return null;
    if (typeof region !== "string" || region.length > 32) return null;
    if (typeof rpc !== "string") return null;
    let protocol: string;
    try {
      protocol = new URL(rpc).protocol;
    } catch {
      return null; // unparseable URL
    }
    if (protocol !== "http:" && protocol !== "https:") return null;
    out.push({ name, region, rpc }); // unknown extra fields stripped, not stored
  }
  return out;
}

/**
 * Compose defaults + override (pure). A null/empty override → a fresh copy of the
 * defaults; a non-empty override → a fresh copy of the override verbatim (REPLACE
 * semantics, never per-entry merge). Always fresh copies so a caller can never
 * mutate the inputs.
 */
export function mergeOperatorOverride(
  defaults: OperatorEntry[],
  override: OperatorEntry[] | null,
): OperatorEntry[] {
  const source = override && override.length > 0 ? override : defaults;
  return source.map((e) => ({ ...e }));
}

/** The default operator entries: `listPeers()` (the gateway + the SDK-registry
 *  fleet) mapped to entry shape. The wallet hardcodes NO operator list — a fleet
 *  change is an SDK bump + rebuild. Used as the editor's draft seed, the source
 *  of the canonical origins, and the fallback in {@link hardenedOperators}. */
export function defaultOperatorEntries(): OperatorEntry[] {
  return listPeers().map(peerToEntry);
}

function peerToEntry(p: Peer): OperatorEntry {
  return { name: p.label, region: p.region ?? "", rpc: p.url };
}

/** The origin of an rpc URL, or null when it does not parse. */
function originOf(rpc: string): string | null {
  try {
    return new URL(rpc).origin;
  } catch {
    return null;
  }
}

function canonicalOriginSet(entries: OperatorEntry[]): Set<string> {
  const origins = new Set<string>();
  for (const e of entries) {
    const o = originOf(e.rpc);
    if (o !== null) origins.add(o);
  }
  return origins;
}

/** True iff EVERY override entry's rpc origin is a member of `canonicalOrigins`
 *  (pure). Matched by ORIGIN, so a renamed or blank-region entry still counts as
 *  in-fleet; a different port or scheme on the same host does not. */
export function overrideWithinFleet(
  canonicalOrigins: ReadonlySet<string>,
  override: OperatorEntry[],
): boolean {
  return override.every((e) => {
    const o = originOf(e.rpc);
    return o !== null && canonicalOrigins.has(o);
  });
}

/**
 * The hardened-build dial rule (BINDING LAW) — resolve the effective operator
 * list, always returning fresh copies:
 *   - development build → `mergeOperatorOverride` (override verbatim, or defaults);
 *   - hardened + null/empty override → defaults;
 *   - hardened + within-fleet override → honored verbatim (reorder/pin/subset of
 *     the canonical fleet must keep working in packaged builds);
 *   - hardened + ANY out-of-fleet host → the WHOLE override is ignored → defaults
 *     (the stored value is NOT deleted).
 *
 * This narrowing is the load-time backstop for the save-time reject: the packaged
 * build's webview CSP `connect-src` is generated from the same SDK registry as
 * the dial set, so an override pointing at a non-allowlisted host would have
 * every request CSP-blocked. The dial set must therefore always be a subset of
 * the allowlist. Runs at EVERY fleet resolution, regardless of developer mode.
 */
export function hardenedOperators(
  defaults: OperatorEntry[],
  override: OperatorEntry[] | null,
  hardened: boolean,
): OperatorEntry[] {
  if (!hardened) return mergeOperatorOverride(defaults, override);
  if (!override || override.length === 0) return defaults.map((e) => ({ ...e }));
  if (overrideWithinFleet(canonicalOriginSet(defaults), override)) {
    return override.map((e) => ({ ...e }));
  }
  return defaults.map((e) => ({ ...e }));
}

/**
 * Read the persisted override, re-validated on EVERY read. Absent / unparseable /
 * schema-invalid / storage-throw all → `null` (use the defaults). Hand-edited
 * storage can never inject a malformed list into the dial path.
 */
export function readOperatorOverride(): OperatorEntry[] | null {
  try {
    const raw = localStorage.getItem(OPERATOR_OVERRIDE_KEY);
    if (!raw) return null;
    return validateOperatorList(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Persist the override, or remove it (revert to defaults) when `list` is null.
 * Returns an ok result or a verbatim reject reason:
 *   - null → remove the key (revert to defaults);
 *   - validation fails → {@link INVALID_LIST_REASON};
 *   - hardened build AND the list reaches outside the canonical fleet →
 *     {@link HARDENED_REJECT_REASON} (an actionable up-front reject, not a silent
 *     revert); the load-time {@link hardenedOperators} narrowing is the backstop
 *     for values that bypass this path (hand-edited storage / a dev-build value);
 *   - storage write throws → {@link STORAGE_FAIL_REASON};
 *   - otherwise persist.
 */
export function writeOperatorOverride(
  list: OperatorEntry[] | null,
): { ok: true } | { ok: false; reason: string } {
  if (list === null) {
    try {
      localStorage.removeItem(OPERATOR_OVERRIDE_KEY);
      return { ok: true };
    } catch {
      return { ok: false, reason: STORAGE_FAIL_REASON };
    }
  }
  const valid = validateOperatorList(list);
  if (valid === null) return { ok: false, reason: INVALID_LIST_REASON };
  if (isHardenedBuild() && !overrideWithinFleet(canonicalOriginSet(defaultOperatorEntries()), valid)) {
    return { ok: false, reason: HARDENED_REJECT_REASON };
  }
  try {
    localStorage.setItem(OPERATOR_OVERRIDE_KEY, JSON.stringify(valid));
    return { ok: true };
  } catch {
    return { ok: false, reason: STORAGE_FAIL_REASON };
  }
}
