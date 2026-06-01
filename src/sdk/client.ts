// SDK seam — every chain I/O the wallet performs goes through here.
//
// We hold a single `RpcClient` from `@monolythium/core-sdk` so every
// chain read and every signed broadcast share one transport and one
// error-shape contract. Callers reach native `lyth_*` and read-only
// `eth_*` methods via `provider.rpcClient.<method>`.

import { RpcClient, SdkError, formatLyth, getRpcEndpoints } from "@monolythium/core-sdk";
import type { RpcClientOptions } from "@monolythium/core-sdk";
import { rpcClientOptions } from "./http";

function defaultEndpoint(): string {
  const fromEnv = import.meta.env.VITE_MONO_RPC_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  if (import.meta.env.DEV) return "/rpc";
  return getRpcEndpoints("testnet-69420")[0]?.url ?? "http://localhost:8548";
}

export interface MonolythiumClient {
  readonly rpcClient: RpcClient;
  readonly endpoint: string;
}

let _client: MonolythiumClient | null = null;

export function getProvider(options: RpcClientOptions = {}): MonolythiumClient {
  if (_client === null) {
    const rpcClient = new RpcClient(defaultEndpoint(), rpcClientOptions(options));
    _client = { rpcClient, endpoint: rpcClient.endpoint };
  }
  return _client;
}

export function resetProviderForTest(): void {
  _client = null;
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
