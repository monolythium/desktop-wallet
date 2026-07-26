// Reverse name display (address → name) — QUORUM-CHECKED.
//
// THE LAW: a `*.mono` name is shown for an address ONLY when at least two
// independent operators answer `lyth_nameOf` with exactly the same name.
// Disagreement, too few responses, or transport failure leaves the full bech32m
// address standing. NO single-operator-asserted name is ever displayed.
//
// This closes the single-rogue-operator mislabelling attack: previously one
// operator could name any address whatever it liked and the wallet would print
// it beside a recipient at review time. The address remains the source of
// truth — a name is an annotation NEXT TO an always-visible, always-copyable
// address, never a replacement for it, and it never gates a send.
//
// Threat-model note: the quorum closes the single-rogue model. A full on-path
// MITM across every connection at once remains an operator-TLS problem, out of
// scope here.
//
// Fans out over `activeFleet()` — the EFFECTIVE fleet, honouring the operator
// override and the active chain — the same seam the forward resolver uses. The
// raw peer catalogue would annotate a custom chain's addresses with names read
// from the builtin chain's registry: a wrong-chain identity claim on the very
// surface this law exists to make trustworthy.
//
// Consequence, stated honestly: on a single-RPC custom chain the quorum can
// never reach two responses, so no reverse name is ever displayed there. That is
// correct — the address stands alone.

import { parseNameCategory } from "@monolythium/core-sdk";
import { activeFleet } from "./fleet";
import { walletFetch } from "./http";
import {
  clearReverseNameCacheStore,
  invalidateReverseName,
  primeReverseNameCache,
  readCachedReverseName,
  writeReverseName,
} from "./reverse-name-cache";

/** Matches the forward resolver's floor — two independent agreeing answers. */
export const REVERSE_MIN_RESPONSES = 2;
/** Bounded fan-out: the same cap the forward resolver uses, so a list of rows
 *  cannot turn into a fleet-wide storm. */
export const REVERSE_MAX_ENDPOINTS = 4;
export const REVERSE_PROBE_TIMEOUT_MS = 4_000;

/** Pull the display name out of a `lyth_nameOf` response: the name, or null when
 *  absent/blank. Pure. */
export function pickReverseName(
  res: { name?: string | null } | null | undefined,
): string | null {
  const name = res?.name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

/**
 * One endpoint's answer, folded for the quorum.
 *
 *  - `name`      — a structurally valid name (a hit vote);
 *  - `none`      — an explicit null/empty (a miss vote);
 *  - `no-answer` — an error, a timeout, malformed JSON, OR a structurally
 *                  INVALID name value. An invalid value is deliberately not a
 *                  vote: it must never reach a display surface even if two
 *                  operators agree on the same invalid string.
 */
export type ReverseEndpointAnswer =
  | { status: "name"; name: string }
  | { status: "none" }
  | { status: "no-answer" };

export type ReverseVerdict =
  | { status: "confirmed-hit"; name: string }
  | { status: "confirmed-miss" }
  | { status: "disagreement" }
  | { status: "insufficient" };

/** True when the value parses as a hierarchical `*.mono` name. */
export function isStructurallyValidName(name: string): boolean {
  try {
    parseNameCategory(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reduce per-endpoint answers by EXACT MATCH.
 *
 * A name is not orderable, so there is no "majority of different values" and no
 * "closest" — any two differing definitive answers (including a hit-vs-miss
 * split) is a disagreement, and a disagreement yields no name. Only
 * `confirmed-hit` ever produces something displayable. Pure.
 */
export function reverseNameVerdict(
  answers: readonly ReverseEndpointAnswer[],
  minResponses = REVERSE_MIN_RESPONSES,
): ReverseVerdict {
  const definitive = answers.filter((a) => a.status !== "no-answer");
  if (definitive.length < minResponses) return { status: "insufficient" };

  const names = new Set<string>();
  let misses = 0;
  for (const a of definitive) {
    if (a.status === "name") names.add(a.name);
    else misses += 1;
  }
  if (names.size > 1) return { status: "disagreement" };
  // A hit-vs-miss split is a disagreement, not a hit.
  if (names.size === 1 && misses > 0) return { status: "disagreement" };
  if (names.size === 1) return { status: "confirmed-hit", name: [...names][0]! };
  return { status: "confirmed-miss" };
}

/** Raw `lyth_nameOf` POST against one endpoint. Never throws. */
async function reverseNameAt(
  url: string,
  address: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ReverseEndpointAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "lyth_nameOf", params: [address] }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: "no-answer" };
    const body = (await res.json()) as { result?: { name?: unknown } | null; error?: unknown };
    if (body.error || !body.result) return { status: "no-answer" };
    const raw = body.result.name;
    if (raw === null || raw === undefined) return { status: "none" };
    if (typeof raw !== "string") return { status: "no-answer" };
    const name = raw.trim();
    if (name === "") return { status: "none" };
    // Case-normalise before comparison; a value that is not a structurally
    // valid name is NOT a vote.
    const lower = name.toLowerCase();
    return isStructurallyValidName(lower)
      ? { status: "name", name: lower }
      : { status: "no-answer" };
  } catch {
    return { status: "no-answer" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ReverseNameQuorumOptions {
  endpoints?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxEndpoints?: number;
  minResponses?: number;
}

/** Quorum reverse resolution over the effective fleet. Never throws. */
export async function resolveReverseNameQuorum(
  address: string,
  opts: ReverseNameQuorumOptions = {},
): Promise<ReverseVerdict> {
  const fetchImpl = opts.fetchImpl ?? walletFetch;
  const timeoutMs = opts.timeoutMs ?? REVERSE_PROBE_TIMEOUT_MS;
  const maxEndpoints = opts.maxEndpoints ?? REVERSE_MAX_ENDPOINTS;
  let endpoints: string[];
  try {
    endpoints = (opts.endpoints ?? activeFleet().map((p) => p.url)).slice(0, maxEndpoints);
  } catch {
    return { status: "insufficient" };
  }
  if (endpoints.length === 0) return { status: "insufficient" };
  const answers = await Promise.all(
    endpoints.map((url) => reverseNameAt(url, address, fetchImpl, timeoutMs)),
  );
  return reverseNameVerdict(answers, opts.minResponses);
}

/**
 * Registry reverse name for an address, quorum-checked and cached.
 *
 * A fresh cache entry (a confirmed hit OR a confirmed miss) short-circuits with
 * no network. Otherwise the quorum runs and only a DEFINITIVE outcome is
 * persisted. Never throws; every failure path returns null and the caller shows
 * the bare address.
 */
export async function loadReverseName(address: string): Promise<string | null> {
  const key = address.trim().toLowerCase();
  if (key === "") return null;
  try {
    await primeReverseNameCache();
    const now = Date.now();
    const cached = readCachedReverseName(key, now);
    if (cached) return cached.name;

    const verdict = await resolveReverseNameQuorum(address.trim());
    if (verdict.status === "confirmed-hit") {
      await writeReverseName(key, verdict.name, now);
      return verdict.name;
    }
    if (verdict.status === "confirmed-miss") {
      await writeReverseName(key, null, now);
      return null;
    }
    // disagreement / insufficient / transport error — transient, NOT cached.
    return null;
  } catch {
    return null;
  }
}

/** Drop the whole reverse cache. */
export async function clearReverseNameCache(): Promise<void> {
  await clearReverseNameCacheStore();
}

/** Drop one address's entry — call after this wallet registers or accepts a
 *  name so the change shows without waiting out the TTL. */
export async function invalidateReverseNameFor(address: string): Promise<void> {
  await invalidateReverseName(address.trim().toLowerCase());
}
