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

export function resolveDefaultEndpoint(env: EndpointEnv = import.meta.env): string {
  const fromEnv = env.VITE_MONO_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
  if (env.DEV) return "/rpc";
  return MONOLYTHIUM_TESTNET_RPC_GATEWAY;
}

/** True when `url` is a known, switchable endpoint (the gateway or an official
 *  SDK endpoint). A persisted value is only honored when it still validates —
 *  a stale or hand-edited entry falls back to the build default. */
export function isKnownEndpoint(url: string): boolean {
  return TESTNET_RPC_ENDPOINT_SET.has(url);
}

/**
 * The endpoint the client should connect to at init: an explicit build-time
 * override or dev proxy wins (so local iteration and CI are deterministic),
 * otherwise a valid persisted user selection, otherwise the build default.
 */
export function resolveActiveEndpoint(env: EndpointEnv = import.meta.env): string {
  const fromEnv = env.VITE_MONO_RPC_URL?.trim();
  if (fromEnv) return fromEnv;
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

export function getProvider(options: RpcClientOptions = {}): MonolythiumClient {
  if (_client === null) {
    _clientOptions = options;
    const rpcClient = new RpcClient(defaultEndpoint(), rpcClientOptions(options));
    _client = { rpcClient, endpoint: rpcClient.endpoint };
  }
  return _client;
}

/** The endpoint the memoized client is currently bound to (initializing the
 *  client if it has not been created yet). */
export function currentEndpoint(): string {
  return getProvider().endpoint;
}

/**
 * Rebuild the memoized client against `url`, persist the selection, and notify
 * subscribers. The new client reuses the options the provider was first created
 * with so the fetch shim and any caller config carry over. No-op when `url`
 * already matches the active endpoint.
 */
export function setEndpoint(url: string): void {
  if (_client !== null && _client.endpoint === url) return;
  const rpcClient = new RpcClient(url, rpcClientOptions(_clientOptions));
  _client = { rpcClient, endpoint: rpcClient.endpoint };
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
}

export function setProviderForTest(client: MonolythiumClient): void {
  _client = client;
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
    const lythoshi = profile.account.nativeBalance;
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
