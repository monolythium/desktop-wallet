// SDK seam — every chain I/O the wallet performs goes through here.
//
// We construct a single `MonolythiumProvider` (the ethers v6 shim that
// `@monolythium/core-sdk` ships as of Stage 3) so every chain read and
// every signed broadcast share one transport, one network registration,
// and one error-shape contract. Ethers callers (`provider.getBlockNumber`,
// `provider.broadcastTransaction`) flow straight through; native callers
// can still reach `lyth_*` methods via `provider.rpcClient.call(...)`.

import { MonolythiumProvider, SdkError, formatLyth, getRpcEndpoints } from "@monolythium/core-sdk";
import type { MonolythiumProviderOptions } from "@monolythium/core-sdk";

/**
 * Default RPC endpoint. Honors `VITE_MONO_RPC_URL` at build time so the
 * Tauri release bundle can pin to a specific endpoint without a code change.
 *
 * The fallback points at the SDK-bundled chain-registry testnet endpoint
 * (chain id 69420), not localhost. Local/private nodes still override with
 * `VITE_MONO_RPC_URL`.
 */
function defaultEndpoint(): string {
  const fromEnv = import.meta.env.VITE_MONO_RPC_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  if (import.meta.env.DEV) return "/rpc";
  return getRpcEndpoints("testnet-69420")[0]?.url ?? "http://localhost:8548";
}

let _provider: MonolythiumProvider | null = null;

/**
 * Lazily-constructed singleton ethers `MonolythiumProvider`. The shim
 * registers the `monolythium-testnet` network with ethers' global
 * registry on first use; subsequent calls reuse the same instance and
 * the same underlying `RpcClient` transport.
 */
export function getProvider(options: MonolythiumProviderOptions = {}): MonolythiumProvider {
  if (_provider === null) {
    _provider = new MonolythiumProvider(defaultEndpoint(), options);
  }
  return _provider;
}

/**
 * Reset the singleton — used by tests so each case can stand up its own
 * provider with a stub `fetch`. Production code never calls this.
 */
export function resetProviderForTest(): void {
  _provider = null;
}

/**
 * Inject a fully-constructed `MonolythiumProvider` as the singleton.
 * Test-only; production code goes through `getProvider()` and lets the
 * lazy initializer pick up `VITE_MONO_RPC_URL`.
 */
export function setProviderForTest(provider: MonolythiumProvider): void {
  _provider = provider;
}

export type ChainSnapshot = {
  endpoint: string;
  chainId: bigint;
  /** canonical LYTH numeric display without the unit suffix. */
  balanceLyth: string;
  /** native atomic balance in lythoshi. */
  balanceLythoshi: string;
  /** `null` while loading, otherwise the latest committed block height. */
  blockHeight: bigint | null;
  /** Errors are stringified for UI consumption; the original SdkError is preserved. */
  error: { kind: string; message: string } | null;
};

/**
 * Pull the public chain snapshot the wallet needs at boot:
 * `eth_chainId` + `eth_blockNumber` + `eth_getBalance` for the bound address.
 * Returns a discriminated value rather than throwing so the caller can render
 * an offline state without unwinding.
 *
 * Round-trips through `MonolythiumProvider`, which delegates to the SDK's
 * `RpcClient.call` under the hood — same transport as a direct ethers caller.
 */
export async function loadChainSnapshot(address: string): Promise<ChainSnapshot> {
  const provider = getProvider();
  const endpoint = provider.rpcClient.endpoint;
  try {
    const [network, blockHeight, balanceAtomic] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getBalance(address),
    ]);
    const lythoshi = balanceQuantityToLythoshi(`0x${balanceAtomic.toString(16)}`);
    return {
      endpoint,
      chainId: network.chainId,
      blockHeight: BigInt(blockHeight),
      balanceLythoshi: lythoshi,
      balanceLyth: formatLyth(lythoshi, { includeUnit: false }),
      error: null,
    };
  } catch (cause) {
    const err = unwrapError(cause);
    return {
      endpoint,
      chainId: 0n,
      blockHeight: null,
      balanceLythoshi: "0",
      balanceLyth: "0",
      error: err,
    };
  }
}

/**
 * Normalize whatever the ethers/SDK transport surfaced into a plain
 * `{ kind, message }` pair the UI can render. Ethers wraps SDK errors in
 * its own envelope, so we unwrap one level (`error.error.error.error` is
 * a known ethers idiom for transport stacks); we don't try to be smarter
 * than that.
 */
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

/** Convert a `0x` quantity from RPC into canonical decimal lythoshi text. */
export function balanceQuantityToLythoshi(hex: string): string {
  if (!hex || hex === "0x" || hex === "0x0") return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

/** Convert a native RPC quantity directly into canonical LYTH display text. */
export function balanceQuantityToLyth(hex: string): string {
  return formatLyth(balanceQuantityToLythoshi(hex), { includeUnit: false });
}

export { SdkError };
