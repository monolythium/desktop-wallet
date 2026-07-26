// SDK seam — every chain I/O the wallet performs goes through here.
//
// We hold a single `RpcClient` from `@monolythium/core-sdk` so every
// chain read and every signed broadcast share one transport and one
// error-shape contract. Callers reach native `lyth_*` and read-only
// `eth_*` methods via `provider.rpcClient.<method>`.

import { RpcClient, SdkError, formatLyth, getRpcEndpoints } from "@monolythium/core-sdk";
import type { RpcClientOptions } from "@monolythium/core-sdk";
import { rpcClientOptions } from "./http";
import { readPersistedEndpoint, writePersistedEndpoint } from "./peers";
import type { DegradedCause } from "./chain-health";

export const MONOLYTHIUM_TESTNET_RPC_GATEWAY = "https://rpc.monolythium.com";

const TESTNET_RPC_ENDPOINTS = getRpcEndpoints("testnet-69420").map((endpoint) => endpoint.url);
const TESTNET_RPC_ENDPOINT_SET = new Set<string>([MONOLYTHIUM_TESTNET_RPC_GATEWAY, ...TESTNET_RPC_ENDPOINTS]);

export interface EndpointEnv {
  readonly VITE_MONO_RPC_URL?: string;
  readonly DEV?: boolean;
}

export function sdkTestnetRpcEndpoints(): readonly string[] {
  return TESTNET_RPC_ENDPOINTS;
}

// Endpoint policy seam — the composition layer (fleet.ts) registers the
// effective-fleet-aware "is this endpoint dialable" test and the active custom
// chain's rpc here, so this low-level module never imports fleet.ts / chains.ts
// (which would cycle). Until registered, the fallbacks below preserve the
// original SDK-registry behavior exactly, so a build/test that never loads
// fleet.ts is byte-for-byte unchanged.
interface EndpointPolicy {
  /** True when `url` is a member of the current effective fleet's URLs. */
  isKnown: (url: string) => boolean;
  /** The active custom chain's rpc, or null when the builtin chain is active. */
  activeCustomChainRpc: () => string | null;
}
let _endpointPolicy: EndpointPolicy | null = null;

/** Register the fleet-aware endpoint policy (called once by fleet.ts at load). */
export function registerEndpointPolicy(policy: EndpointPolicy): void {
  _endpointPolicy = policy;
}

export function resolveDefaultEndpoint(env: EndpointEnv = import.meta.env): string {
  const fromEnv = env.VITE_MONO_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  if (env.DEV) return "/rpc";
  return MONOLYTHIUM_TESTNET_RPC_GATEWAY;
}

/** True when `url` is a known, switchable endpoint (the gateway or an official
 *  SDK endpoint). A persisted value is only honored when it still validates —
 *  a stale or hand-edited entry falls back to the build default.
 *
 *  Hardened-build law 2 (known-endpoint dial): endpoint selection honours only
 *  this known set, enforced here at the dial layer on every boot regardless of
 *  developer mode — the UI is never the enforcement point. See the laws codified
 *  in build-mode.ts. */
export function isKnownEndpoint(url: string): boolean {
  if (_endpointPolicy) return _endpointPolicy.isKnown(url);
  return TESTNET_RPC_ENDPOINT_SET.has(url);
}

/**
 * The endpoint the client should connect to at init. Precedence: an explicit
 * build-time override, then the active custom chain's rpc (an explicitly
 * activated chain is stronger intent than the dev proxy), then the dev proxy,
 * then a valid persisted user selection (fleet-known), otherwise the gateway.
 */
export function resolveActiveEndpoint(env: EndpointEnv = import.meta.env): string {
  const fromEnv = env.VITE_MONO_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  const customRpc = _endpointPolicy?.activeCustomChainRpc() ?? null;
  if (customRpc) return customRpc;
  if (env.DEV) return "/rpc";
  const persisted = readPersistedEndpoint();
  if (persisted && isKnownEndpoint(persisted)) return persisted;
  return MONOLYTHIUM_TESTNET_RPC_GATEWAY;
}

function defaultEndpoint(): string {
  return resolveActiveEndpoint(import.meta.env);
}

export interface MonolythiumClient {
  readonly rpcClient: RpcClient;
  readonly endpoint: string;
}

let _client: MonolythiumClient | null = null;
let _clientOptions: RpcClientOptions = {};
const _endpointSubscribers = new Set<(endpoint: string) => void>();

/**
 * The state a cold module load starts in: nothing has been verified yet.
 *
 * The seam used to open optimistic here, on the grounds that the pinned genesis
 * is compile-time correct. That justification does not survive: the pin being
 * right says nothing about the OPERATOR, and the operator this build will dial
 * comes from persistence (see `resolveActiveEndpoint`) — it was cleared in an
 * EARLIER session, against a node nobody has re-verified since. That is the
 * same stale clearance `setEndpoint` already drops on every switch, arriving
 * through a different door, and the chain catches it no better here: a fork
 * reporting our chain id answers a balance read from its own ledger and admits
 * a signed tx whose `tx.chainId` matches.
 *
 * `unreachable` is the honest cause — not reached yet, not proven wrong — and it
 * costs the user nothing visible: at boot the health machine is `loading`, which
 * `chainKindNotLive` is false for, so the balance ladder falls to its existing
 * skeleton (or the labelled last-known figure) rather than to a hidden state.
 * The first tick clears it in one bounded round-trip.
 */
const UNVERIFIED_AT_BOOT: DegradedCause = "unreachable";

// Trust gate for the active operator, and ONLY for the operator `_client` is
// currently bound to — `setEndpoint` drops it, so a verdict can never outlive
// the operator that earned it. `null` = verified by a health tick, and nothing
// else grants it. A non-null cause means the active operator is not usable —
// proven off the pinned chain/genesis, quarantined, or not yet reached — and
// every read + broadcast through `getProvider` fails closed until a tick clears
// it. There is no longer any state in which the seam is open on an assumption.
let _activeTrust: DegradedCause | null = UNVERIFIED_AT_BOOT;

/** Mark the active operator trusted (a genesis + chain-id check passed). */
export function markActiveOperatorTrusted(): void {
  _activeTrust = null;
}

/** Mark the active operator untrusted with the resolved degraded cause; every
 *  read/broadcast through {@link getProvider} refuses until trust is
 *  re-established. */
export function markActiveOperatorUntrusted(cause: DegradedCause): void {
  _activeTrust = cause;
}

/** The active operator's trust state: `null` when trusted, else the cause. */
export function activeOperatorTrust(): DegradedCause | null {
  return _activeTrust;
}

function ensureClient(options: RpcClientOptions = {}): MonolythiumClient {
  if (_client === null) {
    _clientOptions = options;
    const rpcClient = new RpcClient(defaultEndpoint(), rpcClientOptions(options));
    _client = { rpcClient, endpoint: rpcClient.endpoint };
  }
  return _client;
}

/**
 * The active provider — fail-closed. Throws when the health poll has marked the
 * active operator untrusted (wrong chain / stale genesis / quarantined /
 * unreachable), so an untrusted operator serves no reads and signs nothing:
 * EVERY chain read and broadcast funnels through here, so the whole read surface
 * is fail-closed at one seam. The health probe itself and endpoint
 * display/switching use {@link getProviderUnchecked} — they must run while
 * degraded (to detect recovery and to let the user see/switch operators).
 */
export function getProvider(options: RpcClientOptions = {}): MonolythiumClient {
  if (_activeTrust !== null) {
    throw SdkError.endpoint(`refusing to use an untrusted operator (chain ${_activeTrust})`);
  }
  return ensureClient(options);
}

/** The active provider WITHOUT the trust gate — ONLY for the health probe (which
 *  re-checks the untrusted operator each tick to detect recovery) and endpoint
 *  display/switching. Never use for data reads or signing. */
export function getProviderUnchecked(options: RpcClientOptions = {}): MonolythiumClient {
  return ensureClient(options);
}

/** The endpoint the memoized client is currently bound to (initializing the
 *  client if it has not been created yet). Ungated so the UI can show + switch
 *  operators while degraded. */
export function currentEndpoint(): string {
  return getProviderUnchecked().endpoint;
}

/**
 * Rebuild the memoized client against `url`, persist the selection, and notify
 * subscribers. The new client reuses the options the provider was first created
 * with so the fetch shim and any caller config carry over. No-op when `url`
 * already matches the active endpoint.
 *
 * Switching DROPS the trust verdict (fail-closed). `_activeTrust` records what
 * one operator proved; it says nothing about the next one, and carrying it
 * across a switch is what let a hand-picked operator serve reads — and admit a
 * broadcast — on the previous operator's clearance.
 *
 * Fail-closed is the right direction here under this wallet's own rule (a guard
 * fails closed only when the chain will not catch its failure) because the chain
 * cannot catch this one: the dangerous operator is a fork that reports OUR chain
 * id, so it answers a balance read from its own ledger and admits a signed tx
 * whose `tx.chainId` names the chain it claims to be. Nothing downstream
 * notices. The cost is one health tick of refusal after a deliberate switch —
 * and a switch re-runs the poll effect immediately, so it is one bounded
 * round-trip, not a full period. `unreachable` is the honest cause: this
 * operator has not been reached yet, not proven wrong.
 */
export function setEndpoint(url: string): void {
  if (_client !== null && _client.endpoint === url) return;
  const rpcClient = new RpcClient(url, rpcClientOptions(_clientOptions));
  _client = { rpcClient, endpoint: rpcClient.endpoint };
  _activeTrust = "unreachable";
  writePersistedEndpoint(_client.endpoint);
  for (const subscriber of _endpointSubscribers) subscriber(_client.endpoint);
}

/** Subscribe to endpoint changes. Returns an unsubscribe function. The callback
 *  fires after `setEndpoint` rebuilds the client. */
export function subscribeEndpoint(callback: (endpoint: string) => void): () => void {
  _endpointSubscribers.add(callback);
  return () => {
    _endpointSubscribers.delete(callback);
  };
}

export function resetProviderForTest(): void {
  _client = null;
  _clientOptions = {};
  _endpointSubscribers.clear();
  _activeTrust = UNVERIFIED_AT_BOOT; // the production cold-start state, not an open seam
}

/** Install a working provider for a test. Grants trust as well as binding the
 *  client, because that is the pair production always has together: a client
 *  exists via `ensureClient`, and a health tick is what clears the seam. A test
 *  that wants the unverified boot state calls {@link resetProviderForTest}. */
export function setProviderForTest(client: MonolythiumClient): void {
  _client = client;
  _activeTrust = null;
}

export type ChainSnapshot = {
  endpoint: string;
  chainId: bigint;
  balanceLyth: string;
  balanceLythoshi: string;
  blockHeight: bigint | null;
  error: { kind: string; message: string } | null;
};

export async function loadChainSnapshot(address: string): Promise<ChainSnapshot> {
  const { rpcClient, endpoint } = getProvider();
  try {
    const [chainId, round, profile] = await Promise.all([
      rpcClient.ethChainId(),
      rpcClient.lythCurrentRound(),
      rpcClient.lythAddressProfile(address),
    ]);
    // SDK 0.6.0 renamed the profile balance field to `nativeBalanceLythoshi`
    // (the SDK type still declares `nativeBalance`), so read the new field first
    // and fall back to the old one, else "0" — never undefined into formatLyth.
    const account = profile.account as {
      nativeBalance?: string;
      nativeBalanceLythoshi?: string;
    };
    const lythoshi = account.nativeBalanceLythoshi ?? account.nativeBalance ?? "0";
    return {
      endpoint,
      chainId,
      blockHeight: round.height,
      balanceLythoshi: lythoshi,
      balanceLyth: formatLyth(lythoshi, { includeUnit: false }),
      error: null,
    };
  } catch (cause) {
    return {
      endpoint,
      chainId: 0n,
      blockHeight: null,
      balanceLythoshi: "0",
      balanceLyth: "0",
      error: unwrapError(cause),
    };
  }
}

function unwrapError(cause: unknown): { kind: string; message: string } {
  if (cause instanceof SdkError) {
    return { kind: cause.kind, message: cause.message };
  }
  if (cause && typeof cause === "object" && "error" in cause) {
    const inner = (cause as { error?: unknown }).error;
    if (inner instanceof SdkError) {
      return { kind: inner.kind, message: inner.message };
    }
  }
  const message = (cause as Error)?.message ?? String(cause);
  return { kind: "unknown", message };
}

export function balanceQuantityToLythoshi(hex: string): string {
  if (!hex || hex === "0x" || hex === "0x0") return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

export function balanceQuantityToLyth(hex: string): string {
  return formatLyth(balanceQuantityToLythoshi(hex), { includeUnit: false });
}

export { SdkError };
