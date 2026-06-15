// Staking SDK seam — wraps `lyth_clusterDirectory`, `lyth_getDelegations`,
// and the delegation-precompile (Law §5.4 / §7.6) calldata encoders.
//
// NON-CUSTODIAL ARK staking: delegation is balance-weighted and never
// escrows tokens. `delegate(cluster, weightBps)` records a `weightBps`
// fraction of the caller's LIVE balance — the contribution to a cluster is
// the effective weight `floor(balance × weightBps / 10000)`. Tokens stay
// fully liquid and spendable. The delegate tx is sent with value = 0; the
// chain reverts (UnexpectedValue, tag 0x020e) if any native value is
// attached. There is no redemption queue: `undelegate` is instant.
//
// Delegation lives at precompile `0x…100A`. Calldata is a 4-byte
// selector + 32-byte ABI words:
//
//   delegate(uint32 clusterId, uint16 weightBps)
//   undelegate(uint32 clusterId)
//   redelegate(uint32 srcCluster, uint32 dstCluster, uint16 weightBps)
//
// The chain may reject the call at the precompile-gate if delegation
// isn't activated yet on the connected network — wallets surface the
// chain's typed error verbatim through the OperationsDrawer.

import {
  encodeClaimCalldata,
  encodeDelegateCalldata,
  encodeRedelegateCalldata,
  encodeSetAutoCompoundCalldata,
  encodeUndelegateCalldata,
  formatLyth,
} from "@monolythium/core-sdk";
import type {
  ClusterDirectoryPageResponse,
  DelegationsResponse,
  PendingRewardsResponse,
  RedemptionQueueResponse,
} from "@monolythium/core-sdk";
import { requireTypedUserAddress, requireTypedUserAddressHex } from "./address";
import { getProvider } from "./client";
import { submitNativeTx } from "./submit";

/** Delegation precompile address (Law §5.4 / §7.6). */
export const DELEGATION_PRECOMPILE =
  "0x000000000000000000000000000000000000100a";

/** A delegate/undelegate/redelegate/claim call carries a small ABI payload;
 *  size the execution-unit budget above the observed cost with headroom (the
 *  SDK transfer default of ~100k would underprovision the precompile work). */
const STAKING_EXECUTION_UNIT_LIMIT = 150_000n;

export interface SubmitStakingTxArgs {
  seed: Uint8Array;
  data: string;
  executionUnitLimit?: bigint;
}

export interface SubmitStakingTxResult {
  txHash: string;
}

/** `delegate(uint32 clusterId, uint16 weightBps)` calldata. NON-CUSTODIAL:
 *  submit via `submitStakingTx` (value = 0). `weightBps` is the fraction of
 *  the caller's live balance to contribute; no principal is escrowed. */
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

/** `setAutoCompound(bool enabled)` calldata (chain-canonical selector
 *  `0x86593454`). Persists whether the caller's pending rewards are
 *  auto-restaked on settlement instead of becoming claimable. Submit via
 *  `submitStakingTx` with `valueLythoshi: 0n`. */
export function buildSetAutoCompoundCalldata(enabled: boolean): string {
  return encodeSetAutoCompoundCalldata(enabled);
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

/** `lyth_pendingRewards` — settled + unsettled claimable delegation rewards
 *  for a wallet, plus the wallet's auto-compound flag. Amounts are hex
 *  lythoshi quantities. */
export async function fetchPendingRewards(
  walletBech32m: string,
): Promise<PendingRewardsResponse> {
  const typed = requireTypedUserAddress(walletBech32m, "wallet");
  return getProvider().rpcClient.lythPendingRewards(typed);
}

/**
 * `lyth_redemptionQueue` — open redemption tickets for a wallet (READ ONLY).
 *
 * This is a *vestigial* read. The current delegation model is non-custodial:
 * `undelegate` is instant and never queues an unbonding ticket, so a healthy
 * wallet returns an empty queue. The chain removed the `completeRedemption`
 * selector entirely (calling it now reverts), so there is deliberately no
 * "settle ticket" write action — any legacy ticket the node still reports is
 * surfaced for transparency only, never with a fabricated completion button.
 */
export async function fetchRedemptionQueue(
  walletBech32m: string,
): Promise<RedemptionQueueResponse> {
  const typed = requireTypedUserAddress(walletBech32m, "wallet");
  return getProvider().rpcClient.lythRedemptionQueue(typed);
}

/**
 * Format a hex (or decimal) lythoshi quantity as a whole-LYTH decimal string
 * for display. Tolerant of an empty / malformed value — collapses to "0" so a
 * row still renders rather than throwing.
 */
export function formatRewardLyth(lythoshiHex: string | null | undefined): string {
  if (!lythoshiHex) return "0";
  try {
    const wei = BigInt(lythoshiHex);
    return formatLyth(wei.toString(), { includeUnit: false });
  } catch {
    return "0";
  }
}

/** True when the wallet has any non-zero claimable reward (settled or
 *  unsettled). Drives the Claim button's enabled state. */
export function hasClaimableRewards(rewards: PendingRewardsResponse | null): boolean {
  if (!rewards) return false;
  try {
    return BigInt(rewards.totalAmountLythoshi || "0x0") > 0n;
  } catch {
    return false;
  }
}

/**
 * Submit a delegation-precompile call (delegate / undelegate / redelegate /
 * claim rewards / setAutoCompound). Routes through the shared `submitNativeTx`
 * seam: PLAINTEXT `mesh_submitTx` by default (the path that confirms on the
 * live chain), with `to` = the precompile and the staking execution-unit
 * budget. Caller (OperationsDrawer.execute) supplies the unlocked seed.
 *
 * NON-CUSTODIAL: every staking call (including delegate) is sent with
 * value = 0. The chain reverts (UnexpectedValue, tag 0x020e) if any native
 * value is attached to a delegate.
 */
export async function submitStakingTx(
  args: SubmitStakingTxArgs,
): Promise<SubmitStakingTxResult> {
  const result = await submitNativeTx({
    seed: args.seed,
    to: DELEGATION_PRECOMPILE,
    input: args.data,
    valueLythoshi: 0n,
    executionUnitLimit: args.executionUnitLimit ?? STAKING_EXECUTION_UNIT_LIMIT,
  });
  return { txHash: result.txHash };
}
