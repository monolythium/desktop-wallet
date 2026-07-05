// Forward name resolution for Send — fail-closed, quorum cross-checked.
//
// The chain's hierarchical name registry (0x110E) resolves a `.mono` name to an
// owner address via `lyth_resolveName`. A Send recipient must be EXACT: we never
// sign to a guessed target. So a typed `.mono` name is resolved across several
// operator endpoints and only accepted when a quorum AGREES on one address —
// a miss, an operator disagreement, or too few responders yields NO address and
// blocks the send (the caller shows the reason). The resolved address is what
// the user sees at confirm AND what gets signed; there is no hidden redirect.
//
// Reverse display (address→name) is a separate, non-authoritative convenience
// (see `reverse-name.ts`) and is allowed to fall back to the bare address.

import { walletFetch } from "./http";
import { listPeers } from "./peers";

/** The user name TLD. A recipient ending in this is treated as a name to resolve. */
export const USER_NAME_TLD = ".mono";

/** Fail-closed quorum: at least this many endpoints must agree before a resolved
 *  address (or an "unregistered" verdict) is trusted. Below this → block. */
export const RESOLVE_MIN_RESPONSES = 2;

/** How a typed Send recipient is interpreted. The address's bech32m validity and
 *  the name's on-chain resolution are checked downstream. Pure. */
export type RecipientInput =
  | { kind: "address"; address: string }
  | { kind: "name"; name: string }
  | { kind: "invalid"; reason: string };

/** Classify a raw recipient string: a typed `<hrp>1…` address, a `.mono` name,
 *  or invalid. Case-insensitive on the suffix/prefix; trims. Pure. */
export function classifyRecipientInput(raw: string, userHrp: string): RecipientInput {
  const s = raw.trim();
  if (s === "") return { kind: "invalid", reason: "Recipient address is required." };
  const lower = s.toLowerCase();
  if (lower.endsWith(USER_NAME_TLD)) return { kind: "name", name: lower };
  if (lower.startsWith(`${userHrp}1`)) return { kind: "address", address: s };
  return {
    kind: "invalid",
    reason: `Recipient must be a typed ${userHrp}1… address or a .mono name.`,
  };
}

/** One endpoint's `lyth_resolveName` outcome, folded for the quorum. */
export type EndpointResolution =
  | { status: "address"; address: string }
  | { status: "unregistered" }
  | { status: "error" };

export type ResolveVerdict =
  | { ok: true; address: string }
  | {
      ok: false;
      reason: "not_found" | "disagreement" | "insufficient";
      message: string;
    };

/** Fail-closed quorum verdict over per-endpoint `lyth_resolveName` results:
 *  - any two responders give DIFFERENT non-null addresses, or a mix of
 *    address + unregistered → `disagreement` (block);
 *  - ≥ `minResponses` responders AGREE on one non-null address → `ok`;
 *  - ≥ `minResponses` responders all say unregistered → `not_found`;
 *  - fewer than `minResponses` responded at all → `insufficient` (block).
 *  A miss / disagreement / thin quorum NEVER yields an address. Pure. */
export function resolveNameVerdict(
  results: readonly EndpointResolution[],
  minResponses = RESOLVE_MIN_RESPONSES,
): ResolveVerdict {
  const addressed = results.filter(
    (r): r is { status: "address"; address: string } => r.status === "address",
  );
  const unregistered = results.filter((r) => r.status === "unregistered").length;
  const responded = addressed.length + unregistered;

  const distinct = new Set(addressed.map((r) => r.address.toLowerCase()));
  if (distinct.size > 1) {
    return {
      ok: false,
      reason: "disagreement",
      message: "Operators disagree on this name's address — not sending.",
    };
  }
  if (addressed.length > 0 && unregistered > 0) {
    return {
      ok: false,
      reason: "disagreement",
      message: "Operators disagree on whether this name is registered — not sending.",
    };
  }
  if (responded < minResponses) {
    return {
      ok: false,
      reason: "insufficient",
      message: "Couldn't confirm this name with enough operators — not sending.",
    };
  }
  if (addressed.length >= minResponses) {
    // All agree — return the address as the endpoint reported it (bech32m).
    return { ok: true, address: addressed[0]!.address };
  }
  return { ok: false, reason: "not_found", message: "That .mono name isn't registered." };
}

/** Raw `lyth_resolveName` POST against one endpoint, folded to an
 *  {@link EndpointResolution}. Never throws (timeout/parse/error → `error`). */
async function resolveNameAt(
  url: string,
  name: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<EndpointResolution> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "lyth_resolveName",
        params: [name, "latest"],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: "error" };
    const body = (await res.json()) as {
      result?: { address?: unknown } | null;
      error?: unknown;
    };
    if (body.error || !body.result) return { status: "error" };
    const addr = body.result.address;
    if (addr === null || addr === undefined) return { status: "unregistered" };
    if (typeof addr === "string" && addr.trim() !== "") {
      return { status: "address", address: addr.trim() };
    }
    return { status: "error" };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveNameQuorumOptions {
  /** Endpoints to query; defaults to the peer catalogue (gateway + operators). */
  endpoints?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Cap on how many endpoints to query (keeps the confirm-time read snappy). */
  maxEndpoints?: number;
  minResponses?: number;
}

/** Resolve a `.mono` name across multiple operator endpoints with a fail-closed
 *  quorum. A name that doesn't cleanly resolve returns `ok:false` — never a
 *  guessed address. */
export async function resolveNameQuorum(
  name: string,
  opts: ResolveNameQuorumOptions = {},
): Promise<ResolveVerdict> {
  const fetchImpl = opts.fetchImpl ?? walletFetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const maxEndpoints = opts.maxEndpoints ?? 4;
  const endpoints = (opts.endpoints ?? listPeers().map((p) => p.url)).slice(0, maxEndpoints);
  const results = await Promise.all(
    endpoints.map((url) => resolveNameAt(url, name.toLowerCase(), fetchImpl, timeoutMs)),
  );
  return resolveNameVerdict(results, opts.minResponses);
}
