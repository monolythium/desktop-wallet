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
  encodeClaimCalldata,
  encodeCompleteRedemptionCalldata,
  encodeDelegateCalldata,
  encodeRedelegateCalldata,
  encodeUndelegateCalldata,
} from "@monolythium/core-sdk";
import type {
  ClusterDirectoryPageResponse,
  DelegationsResponse,
} from "@monolythium/core-sdk";
import { requireTypedUserAddressHex } from "./address";
import { getProvider } from "./client";
import { submitNativeTx } from "./submit";

/** Delegation precompile address (Law §5.4 / §7.6). */
export const DELEGATION_PRECOMPILE =
  "0x000000000000000000000000000000000000100a";

/** A delegate/undelegate/redelegate/claim/completeRedemption call carries a
 *  small ABI payload; size the execution-unit budget above the observed cost
 *  with headroom (the SDK transfer default of ~100k would underprovision the
 *  precompile work). */
const STAKING_EXECUTION_UNIT_LIMIT = 150_000n;

export interface SubmitStakingTxArgs {
  seed: Uint8Array;
  data: string;
  /** msg.value in lythoshi. For `delegate` this is the principal stake;
   *  for every other staking op pass `0n`. */
  valueLythoshi?: bigint;
  executionUnitLimit?: bigint;
}

export interface SubmitStakingTxResult {
  txHash: string;
}

export function buildDelegateCalldata(
  clusterId: number,
  weightBps: number,
): string {
  return encodeDelegateCalldata(clusterId, weightBps);
}

export function buildUndelegateCalldata(clusterId: number): string {
  return encodeUndelegateCalldata(clusterId);
}

export function buildRedelegateCalldata(
  fromCluster: number,
  toCluster: number,
  weightBps: number,
): string {
  return encodeRedelegateCalldata(fromCluster, toCluster, weightBps);
}

export function buildClaimRewardsCalldata(): string {
  return encodeClaimCalldata();
}

/** `completeRedemption(uint64 index)` calldata (chain-canonical selector
 *  `0x26169d0a`). Settles the matured redemption ticket at `index`,
 *  returning the queued principal to the caller and pruning the ticket.
 *  With liquid bonding the ticket matures at the undelegate height, so
 *  this is claimable in the same/next anchor as the `undelegate` that
 *  created it. Submit via `submitStakingTx` with `valueLythoshi: 0n`. */
export function buildCompleteRedemptionCalldata(ticketIndex: number): string {
  return encodeCompleteRedemptionCalldata(ticketIndex);
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
 * Submit a delegation-precompile call (delegate / undelegate / redelegate /
 * claim rewards / completeRedemption). Routes through the shared
 * `submitNativeTx` seam: PLAINTEXT `mesh_submitTx` by default (the path that
 * confirms on the live chain), with `to` = the precompile and the staking
 * execution-unit budget. Caller (OperationsDrawer.execute) supplies the
 * unlocked seed.
 */
export async function submitStakingTx(
  args: SubmitStakingTxArgs,
): Promise<SubmitStakingTxResult> {
  const result = await submitNativeTx({
    seed: args.seed,
    to: DELEGATION_PRECOMPILE,
    input: args.data,
    valueLythoshi: args.valueLythoshi ?? 0n,
    executionUnitLimit: args.executionUnitLimit ?? STAKING_EXECUTION_UNIT_LIMIT,
  });
  return { txHash: result.txHash };
}
