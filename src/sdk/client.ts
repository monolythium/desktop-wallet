// SDK seam — every chain I/O the wallet performs goes through here.
// Stage 2 wires `@monolythium/core-sdk` for read-side calls; signing
// flows arrive in Stage 3 alongside Tauri keychain commands.

import { RpcClient, parseQuantity, SdkError } from "@monolythium/core-sdk";
import type {
  AccountProofResponse,
  BlockSelector,
} from "@monolythium/core-sdk";

/**
 * Default RPC endpoint. Honors `VITE_MONO_RPC_URL` at build time so the
 * Tauri release bundle can pin to a specific endpoint without a code change.
 *
 * The fallback points at the live LythiumDAG-BFT testnet (chain id 6940).
 * Until the testnet RPC has a stable public URL the wallet falls back to
 * a localhost node — that keeps `pnpm dev` usable without a network.
 */
function defaultEndpoint(): string {
  const fromEnv = import.meta.env.VITE_MONO_RPC_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return "http://localhost:8548";
}

let _client: RpcClient | null = null;

export function getRpcClient(): RpcClient {
  if (_client === null) {
    _client = new RpcClient(defaultEndpoint());
  }
  return _client;
}

export type ChainSnapshot = {
  endpoint: string;
  chainId: number;
  /** decimal balance of the bound address as a JS number; for display only. */
  balanceLyth: number;
  /** raw `0x`-quantity string straight off the wire. */
  balanceWei: string;
  /** `null` while loading, otherwise the latest committed block height. */
  blockHeight: number | null;
  /** Errors are stringified for UI consumption; the original SdkError is preserved. */
  error: { kind: string; message: string } | null;
};

/**
 * Pull the public chain snapshot the wallet needs at boot:
 * `eth_chainId` + `eth_blockNumber` + `eth_getBalance` for the bound address.
 * Returns a discriminated value rather than throwing so the caller can render
 * an offline state without unwinding.
 */
export async function loadChainSnapshot(
  address: string,
  block: BlockSelector = "latest",
): Promise<ChainSnapshot> {
  const client = getRpcClient();
  const endpoint = client.endpoint;
  try {
    const [chainId, blockHeight, balance] = await Promise.all([
      client.ethChainId(),
      client.ethBlockNumber(),
      client.ethGetBalance(address, block),
    ]);
    const wei = extractValue(balance);
    return {
      endpoint,
      chainId,
      blockHeight,
      balanceWei: wei,
      balanceLyth: weiToLyth(wei),
      error: null,
    };
  } catch (cause) {
    const err = cause instanceof SdkError
      ? { kind: cause.kind, message: cause.message }
      : { kind: "unknown", message: (cause as Error)?.message ?? String(cause) };
    return {
      endpoint,
      chainId: 0,
      blockHeight: null,
      balanceWei: "0x0",
      balanceLyth: 0,
      error: err,
    };
  }
}

function extractValue(resp: AccountProofResponse): string {
  return resp.value ?? "0x0";
}

/** Convert a `0x`-quantity wei string to a LYTH JS number (1 LYTH = 1e18 wei). */
export function weiToLyth(hex: string): number {
  if (!hex || hex === "0x" || hex === "0x0") return 0;
  // BigInt to keep precision through the divide; final cast loses precision for
  // display purposes only — never settle accounting decisions on this value.
  try {
    const wei = BigInt(hex);
    const lythWhole = wei / 1_000_000_000_000_000_000n;
    const lythFrac = wei % 1_000_000_000_000_000_000n;
    return Number(lythWhole) + Number(lythFrac) / 1e18;
  } catch {
    return parseQuantity(hex);
  }
}

export { parseQuantity, SdkError };
