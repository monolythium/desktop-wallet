// Delegation SDK seam — wraps `lyth_clusterDirectory`, `lyth_getDelegations`,
// and the delegation-precompile (Law §5.4 / §7.6) calldata encoders.
//
// NON-CUSTODIAL ARK delegation: delegation is balance-weighted and never
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
import { truncateDecimals } from "./lyth-display";
import { getProvider } from "./client";
import { submitNativeTx } from "./submit";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";

/** Delegation precompile address (Law §5.4 / §7.6). */
export const DELEGATION_PRECOMPILE =
  "0x000000000000000000000000000000000000100a";

/** A delegate/undelegate/redelegate/claim call carries a small ABI payload;
 *  size the execution-unit budget above the observed cost with headroom (the
 *  SDK transfer default of ~100k would underprovision the precompile work). */
export const DELEGATION_EXECUTION_UNIT_LIMIT = 150_000n;

export interface SubmitDelegationTxArgs {
  seed: Uint8Array;
  data: string;
  executionUnitLimit?: bigint;
  /** The fee the confirm surface RENDERED, signed verbatim (`shown == signed`).
   *  Absent ⇒ `submitNativeTx` resolves its own, which is a second read. */
  resolvedFee?: ResolvedExecutionFee;
}

export interface SubmitDelegationTxResult {
  txHash: string;
  /** Account nonce this delegation tx signed with (for dropped-tx detection). */
  nonce: number;
}

/** `delegate(uint32 clusterId, uint16 weightBps)` calldata. NON-CUSTODIAL:
 *  submit via `submitDelegationTx` (value = 0). `weightBps` is the fraction of
 *  the caller's live balance to contribute; no principal is escrowed.
 *
 *  Named-argument object: clusterId and weightBps are both `number`, and a
 *  positional swap would silently sign a valid tx that delegates to cluster
 *  #weightBps — naming the fields makes a mis-assignment visible at the call site. */
export function buildDelegateCalldata(args: {
  clusterId: number;
  weightBps: number;
}): string {
  return encodeDelegateCalldata(args.clusterId, args.weightBps);
}

export function buildUndelegateCalldata(clusterId: number): string {
  return encodeUndelegateCalldata(clusterId);
}

/** `redelegate(uint32 fromCluster, uint32 toCluster, uint16 weightBps)` calldata.
 *  Named-argument object: fromCluster and toCluster are both `number` cluster ids
 *  with opposite meaning — a positional swap would move weight the WRONG direction
 *  and the chain would accept the valid tx. Naming makes the swap impossible to
 *  express by position. */
export function buildRedelegateCalldata(args: {
  fromCluster: number;
  toCluster: number;
  weightBps: number;
}): string {
  return encodeRedelegateCalldata(args.fromCluster, args.toCluster, args.weightBps);
}

export function buildClaimRewardsCalldata(): string {
  return encodeClaimCalldata();
}

/** `setAutoCompound(bool enabled)` calldata (chain-canonical selector
 *  `0x86593454`). Persists whether the caller's pending rewards are
 *  auto-re-delegated on settlement instead of becoming claimable. Submit via
 *  `submitDelegationTx` with `valueLythoshi: 0n`. */
export function buildSetAutoCompoundCalldata(enabled: boolean): string {
  return encodeSetAutoCompoundCalldata(enabled);
}

/** The chain's FIRST directory page. `lyth_clusterDirectory` is 0-indexed:
 *  `parse_cluster_directory_args` unwraps an absent page to `0`, and
 *  `ClusterDirectoryPage.page` is documented as a "0-based page index".
 *  Asking for page 1 on a 4-cluster chain returns an empty page, not an error. */
export const CLUSTER_DIRECTORY_FIRST_PAGE = 0;

/** One page of the public cluster directory.
 *
 *  BOTH ARGUMENTS ARE REQUIRED, deliberately. The page base used to live in a
 *  default here AND in each caller, written from memory rather than from canon,
 *  and the two copies disagreed — this seam asked for page 1 while the status
 *  seam asked for page 0. A default is what let one of them be wrong without
 *  anyone naming a number; requiring the argument leaves exactly one place per
 *  call where the value can be wrong, and {@link CLUSTER_DIRECTORY_FIRST_PAGE}
 *  carries the canon citation to that place. */
export async function fetchClusterDirectory(
  page: number,
  limit: number,
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
/** The disclosure shown when ENABLING auto-compound with rewards pending.
 *
 *  The chain's `setAutoCompound(true)` does not merely persist a preference: it
 *  settles and pays out the wallet's entire pending rewards in the same
 *  transaction. That is a fund movement the user did not ask for by name, and it
 *  must be visible before signing rather than discovered afterwards in the
 *  balance.
 *
 *  Returns null for every case where nothing is claimed — disabling, enabling
 *  with nothing pending, or an unreadable amount — so the caller renders no box
 *  at all rather than an empty one. Pure. */
export function autoCompoundClaimDisclosure(
  enabling: boolean,
  pendingLythoshi: bigint,
): string | null {
  if (!enabling) return null;
  if (pendingLythoshi <= 0n) return null;
  const amount = truncateDecimals(
    formatLyth(pendingLythoshi.toString(), { includeUnit: false }),
    4,
  );
  // A truncated display that lands on zero would read as "claims your pending 0
  // LYTH" — say nothing rather than that.
  if (amount === "0") return null;
  return `This also claims your pending ${amount} LYTH now. Turning on auto-compound settles and pays out your current rewards to your balance in the same transaction.`;
}

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
 * live chain), with `to` = the precompile and the delegation execution-unit
 * budget. Caller (OperationsDrawer.execute) supplies the unlocked seed.
 *
 * NON-CUSTODIAL: every delegation call (including delegate) is sent with
 * value = 0. The chain reverts (UnexpectedValue, tag 0x020e) if any native
 * value is attached to a delegate.
 */
export async function submitDelegationTx(
  args: SubmitDelegationTxArgs,
): Promise<SubmitDelegationTxResult> {
  const result = await submitNativeTx({
    seed: args.seed,
    to: DELEGATION_PRECOMPILE,
    input: args.data,
    valueLythoshi: 0n,
    executionUnitLimit: args.executionUnitLimit ?? DELEGATION_EXECUTION_UNIT_LIMIT,
    // Spread, so absent stays absent and no existing caller's behaviour moves.
    ...(args.resolvedFee === undefined ? {} : { resolvedFee: args.resolvedFee }),
  });
  return { txHash: result.txHash, nonce: result.nonce };
}
