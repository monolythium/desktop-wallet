// Peer (RPC endpoint) catalogue, probing, and selection.
//
// The wallet talks to one `mono-core` node at a time. This module enumerates
// the endpoints the wallet can switch between (the public gateway plus the
// official testnet-69420 endpoints from the SDK registry), probes them for
// reachability + latency + chain-id match, and picks the fastest eligible one.
//
// HONESTY: a peer that responds but reports the wrong chain id is surfaced as
// reachable-but-ineligible (wrong chain) — never silently selected. A peer
// that times out or errors is unreachable. `pickFastest` only ever returns a
// peer that is both reachable AND on the right chain.

import { getRpcEndpoints } from "@monolythium/core-sdk";
import { MONOLYTHIUM_TESTNET_RPC_GATEWAY } from "./client";
import { walletFetch } from "./http";

/** testnet-69420 chain id, both as the canonical `eth_chainId` hex the node
 *  returns and the decimal form for display. A probe is only eligible when the
 *  reported id matches this exactly. */
export const TESTNET_CHAIN_ID = 69420;
export const TESTNET_CHAIN_ID_HEX = "0x10f2c";

/** localStorage key for the user's selected RPC endpoint. */
export const RPC_ENDPOINT_KEY = "wallet.rpcEndpoint";

/** Default per-probe timeout. Kept short so "Switch to fastest" stays snappy
 *  even when several peers are unreachable. */
const PROBE_TIMEOUT_MS = 4000;

/** Latency badge thresholds (ms). Below `ok` is green, below `warn` is amber,
 *  at/above `warn` is red. */
export const LATENCY_OK_MS = 120;
export const LATENCY_WARN_MS = 350;

export interface Peer {
  /** Canonical endpoint URL — also the selection key. */
  url: string;
  /** Human label (from the SDK endpoint notes, or a derived gateway label). */
  label: string;
  /** Region code (fsn1 / nbg1 / hel1 / ash / sin), or null when unknown. */
  region: string | null;
  /** SDK tier ("official" / "community"), or "gateway" for the public proxy. */
  tier: string;
}

export interface ProbeResult {
  url: string;
  /** The peer answered the JSON-RPC request within the timeout. */
  reachable: boolean;
  /** Round-trip time in ms (only meaningful when reachable). */
  latencyMs: number;
  /** The reported chain id equals the testnet chain id. A reachable peer with
   *  `chainIdOk === false` is on the wrong chain and is NOT eligible. */
  chainIdOk: boolean;
  /** Best-effort block height from a follow-up `eth_blockNumber`, when the
   *  peer is reachable and on the right chain. Undefined otherwise. */
  blockHeight?: number;
  /** Failure reason for unreachable peers (timeout / network / parse). */
  error?: string;
}

/** Latency badge bucket for the UI. */
export type LatencyBucket = "ok" | "warn" | "slow";

export function latencyBucket(latencyMs: number): LatencyBucket {
  if (latencyMs < LATENCY_OK_MS) return "ok";
  if (latencyMs < LATENCY_WARN_MS) return "warn";
  return "slow";
}

/** Short, human-friendly label from an SDK endpoint's `notes` field (e.g.
 *  "operator-2; primary foundation seed" → "operator-2"). Falls back to the
 *  provider when there are no notes. */
function labelFromNotes(notes: string | undefined, provider: string): string {
  if (notes && notes.trim() !== "") return notes.split(";")[0]!.trim();
  return provider;
}

/**
 * The peer catalogue: the public gateway first (the wallet's default), then the
 * official SDK endpoints. De-duped by URL so the gateway is never listed twice
 * if it also appears in the registry.
 */
export function listPeers(): Peer[] {
  const peers: Peer[] = [
    {
      url: MONOLYTHIUM_TESTNET_RPC_GATEWAY,
      label: "Public gateway",
      region: null,
      tier: "gateway",
    },
  ];
  const seen = new Set<string>([MONOLYTHIUM_TESTNET_RPC_GATEWAY]);

  for (const endpoint of getRpcEndpoints("testnet-69420")) {
    if (seen.has(endpoint.url)) continue;
    seen.add(endpoint.url);
    peers.push({
      url: endpoint.url,
      label: labelFromNotes(endpoint.notes, endpoint.provider),
      region: endpoint.region ?? null,
      tier: endpoint.tier,
    });
  }

  return peers;
}

/**
 * Timed JSON-RPC `eth_chainId` POST against `url`. Resolves with reachability,
 * latency, and whether the reported chain id matches testnet-69420. A matching,
 * reachable peer also gets a best-effort `eth_blockNumber` for the tiebreak.
 *
 * Never rejects — every outcome (including timeout and parse failure) is folded
 * into a `ProbeResult`.
 */
export async function probePeer(url: string, fetchImpl: typeof fetch = walletFetch): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      return { url, reachable: false, latencyMs, chainIdOk: false, error: `HTTP ${response.status}` };
    }

    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) {
      return { url, reachable: true, latencyMs, chainIdOk: false, error: body.error.message ?? "rpc error" };
    }

    const chainIdOk = chainIdMatches(body.result);
    if (!chainIdOk) {
      return { url, reachable: true, latencyMs, chainIdOk: false };
    }

    const blockHeight = await probeBlockHeight(url, fetchImpl, controller.signal);
    return { url, reachable: true, latencyMs, chainIdOk: true, blockHeight };
  } catch (cause) {
    const latencyMs = Date.now() - started;
    const aborted = controller.signal.aborted;
    return {
      url,
      reachable: false,
      latencyMs,
      chainIdOk: false,
      error: aborted ? "timeout" : (cause as Error)?.message ?? "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort `eth_blockNumber`; returns undefined on any failure (the chain
 *  id has already been validated, so a missing height is non-fatal). */
async function probeBlockHeight(
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] }),
      signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { result?: unknown };
    return parseHexQuantity(body.result);
  } catch {
    return undefined;
  }
}

/** True when a JSON-RPC `eth_chainId` result equals the testnet chain id,
 *  tolerant of `"0x10f2c"` / `"0x10F2C"` casing and a decimal-string node. */
export function chainIdMatches(result: unknown): boolean {
  const value = parseHexQuantity(result);
  return value === TESTNET_CHAIN_ID;
}

/** Parse a JSON-RPC quantity (`"0x10f2c"` or a decimal string/number) into a
 *  number, or undefined when it is not a parseable quantity. */
export function parseHexQuantity(result: unknown): number | undefined {
  if (typeof result === "number" && Number.isFinite(result)) return result;
  if (typeof result !== "string") return undefined;
  const trimmed = result.trim();
  if (trimmed === "") return undefined;
  try {
    return Number(BigInt(trimmed));
  } catch {
    return undefined;
  }
}

/**
 * Pick the fastest eligible peer: among results that are reachable AND on the
 * right chain, the lowest `latencyMs` wins; ties break to the highest known
 * `blockHeight` (a peer with a known height beats one without). Returns null
 * when no peer is eligible.
 *
 * Pure — no I/O. Unit tested directly.
 */
export function pickFastest(results: readonly ProbeResult[]): ProbeResult | null {
  const eligible = results.filter((r) => r.reachable && r.chainIdOk);
  if (eligible.length === 0) return null;

  return eligible.reduce((best, candidate) => {
    if (candidate.latencyMs < best.latencyMs) return candidate;
    if (candidate.latencyMs > best.latencyMs) return best;
    // Equal latency — prefer the higher known block height.
    const candidateHeight = candidate.blockHeight ?? -1;
    const bestHeight = best.blockHeight ?? -1;
    return candidateHeight > bestHeight ? candidate : best;
  });
}

// ── Persistence ──────────────────────────────────────────────────────────

/** Read the user's persisted endpoint selection, or null when none is set or
 *  storage is unavailable. */
export function readPersistedEndpoint(): string | null {
  try {
    const value = localStorage.getItem(RPC_ENDPOINT_KEY);
    return value && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** Persist the user's endpoint selection. Best-effort — a storage failure is
 *  swallowed (the in-memory selection still applies for the session). */
export function writePersistedEndpoint(url: string): void {
  try {
    localStorage.setItem(RPC_ENDPOINT_KEY, url);
  } catch {
    // localStorage unavailable — fall through.
  }
}

/** Clear the persisted selection (revert to the build default on next init). */
export function clearPersistedEndpoint(): void {
  try {
    localStorage.removeItem(RPC_ENDPOINT_KEY);
  } catch {
    // localStorage unavailable — fall through.
  }
}
