// Staking SDK seam — wraps `lyth_clusterDirectory`, `lyth_getDelegations`,
// and the delegation-precompile (Law §5.4 / §7.6) calldata encoders.
//
// Delegation lives at precompile `0x…100A`. Calldata is a 4-byte
// selector + 32-byte ABI words:
//
//   delegate(uint256 clusterId, uint256 weightBps)
//   undelegate(uint256 clusterId, uint256 weightBps)
//   redelegate(uint256 srcCluster, uint256 dstCluster, uint256 weightBps)
//
// The chain may reject the call at the precompile-gate if delegation
// isn't activated yet on the connected network — wallets surface the
// chain's typed error verbatim through the OperationsDrawer.

import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  RpcClient,
} from "@monolythium/core-sdk";
import type {
  ClusterDirectoryPageResponse,
  DelegationsResponse,
} from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
  submitEncryptedEnvelope,
} from "@monolythium/core-sdk/crypto";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { requireTypedUserAddressHex } from "./address";
import { getProvider } from "./client";
import {
  getExecutionUnitPriceLythoshi,
  getNativeTransactionCount,
} from "./native-rpc";

/** Delegation precompile address (Law §5.4 / §7.6). */
export const DELEGATION_PRECOMPILE =
  "0x000000000000000000000000000000000000100a";

export const STAKING_SELECTORS = {
  delegate: "d9a34952",
  undelegate: "634b91e3",
  redelegate: "0e184c84",
  claimRewards: "372500ab",
} as const;

const STAKING_EXECUTION_UNIT_LIMIT = 50_000n;

export interface SubmitStakingTxArgs {
  seed: Uint8Array;
  data: string;
  executionUnitLimit?: bigint;
}

export interface SubmitStakingTxResult {
  txHash: string;
  innerSighashHex: string;
}

function encodeUint256(value: number | bigint): string {
  let n: bigint;
  if (typeof value === "bigint") n = value;
  else {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new RangeError(`encodeUint256: not a non-negative integer (${value})`);
    }
    n = BigInt(value);
  }
  if (n < 0n) throw new RangeError("encodeUint256: negative");
  if (n >= 1n << 256n) throw new RangeError("encodeUint256: overflow");
  return n.toString(16).padStart(64, "0");
}

export function buildDelegateCalldata(
  clusterId: number,
  weightBps: number,
): string {
  return (
    "0x" +
    STAKING_SELECTORS.delegate +
    encodeUint256(clusterId) +
    encodeUint256(weightBps)
  );
}

export function buildUndelegateCalldata(
  clusterId: number,
  weightBps: number,
): string {
  return (
    "0x" +
    STAKING_SELECTORS.undelegate +
    encodeUint256(clusterId) +
    encodeUint256(weightBps)
  );
}

export function buildClaimRewardsCalldata(): string {
  return "0x" + STAKING_SELECTORS.claimRewards;
}

export async function fetchClusterDirectory(
  page: number = 1,
  limit: number = 20,
): Promise<ClusterDirectoryPageResponse> {
  return getProvider().rpcClient.lythClusterDirectory(page, limit);
}

export async function fetchDelegations(
  walletBech32m: string,
): Promise<DelegationsResponse> {
  const hex = requireTypedUserAddressHex(walletBech32m, "wallet");
  return getProvider().rpcClient.lythGetDelegations(hex);
}

/**
 * Submit a delegation-precompile call. Drives the same encrypted-envelope
 * path as `sendNativeLyth`, but `to` is the precompile address and value
 * is 0. Caller (OperationsDrawer.execute) supplies the unlocked seed.
 */
export async function submitStakingTx(
  args: SubmitStakingTxArgs,
): Promise<SubmitStakingTxResult> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  const provider = getProvider();
  const client = new RpcClient(provider.rpcClient.endpoint);
  const fromHex = backend.getAddress();

  const [nonce, executionUnitPrice, encryptionKey] = await Promise.all([
    getNativeTransactionCount(client, fromHex),
    getExecutionUnitPriceLythoshi(client),
    fetchEncryptionKey(client),
  ]);

  const tx: NativeEvmTxFields = {
    chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
    nonce,
    gasLimit: args.executionUnitLimit ?? STAKING_EXECUTION_UNIT_LIMIT,
    maxFeePerGas: executionUnitPrice,
    maxPriorityFeePerGas: executionUnitPrice,
    to: DELEGATION_PRECOMPILE,
    value: "0x0",
    input: args.data,
  };

  const wrapped = await buildEncryptedSubmission({
    backend,
    encryptionKey,
    tx,
  });

  const txHash = await submitEncryptedEnvelope(client, wrapped.envelopeWireHex);
  return { txHash, innerSighashHex: wrapped.innerSighashHex };
}
