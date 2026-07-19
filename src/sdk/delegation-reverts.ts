// Delegation revert taxonomy — the one place a chain rejection becomes a
// sentence a person can act on.
//
// The delegation precompile encodes reverts as `[0x02, tag]`, i.e. the numeric
// code 0x02NN. Six of them describe a situation the user can do something about,
// so those six get plain copy. Everything else keeps the node's own words.
//
// That last part is the load-bearing half. A friendly headline that DISCARDS the
// underlying string makes a real bug undiagnosable — the reporter can only say
// "it said something went wrong". So an unrecognised reason is never replaced
// with a generic sentence: `classifyDelegationRevert` returns null and the
// caller surfaces the raw text verbatim.
//
// Detection wire note: mono-core flattens mempool admission failures into
// JSON-RPC `-32047 "upstream unavailable: mempool: <inner>"` served as HTTP 200,
// so classification keys on the inner message and the numeric code — never on
// -32047 itself, which says nothing about WHY.
//
// Pure: no RPC, no DOM, no module state.

import {
  PER_WALLET_CAP_REVERT_MESSAGE,
  WALLET_TOTAL_CAP_REVERT_MESSAGE,
} from "./delegation-caps";

// The two cap messages are DEFINED in delegation-caps.ts (where the preflight
// that raises them lives) and re-exported here so the taxonomy is one table with
// one definition per code — never two copies that drift apart.
export { PER_WALLET_CAP_REVERT_MESSAGE, WALLET_TOTAL_CAP_REVERT_MESSAGE };

/** Chain revert code for PerWalletCapExceeded. */
export const REVERT_PER_WALLET_CAP = 0x0213;
/** Chain revert code for WalletTotalExceeded. */
export const REVERT_WALLET_TOTAL = 0x0205;
/** Chain revert code for TooManyDelegations. */
export const REVERT_TOO_MANY_DELEGATIONS = 0x0206;
/** Chain revert code for InactiveCluster. */
export const REVERT_INACTIVE_CLUSTER = 0x020b;
/** Chain revert code for NoClaimableRewards. */
export const REVERT_NO_CLAIMABLE_REWARDS = 0x020d;
/** Chain revert code for RewardEscrowUnderfunded. */
export const REVERT_REWARD_ESCROW_UNDERFUNDED = 0x0214;

/** The maximum number of distinct clusters one wallet may delegate to
 *  (mono-core `MAX_DELEGATIONS_PER_WALLET`). Exceeding it reverts 0x0206. */
export const MAX_DELEGATIONS_PER_WALLET = 10;

/** Copy for 0x0206 TooManyDelegations — also the local preflight's message. */
export const TOO_MANY_DELEGATIONS_MESSAGE =
  "You already delegate to the maximum of 10 clusters — undelegate from one before adding another.";

/** Copy for 0x020B InactiveCluster. */
export const INACTIVE_CLUSTER_MESSAGE =
  "That cluster is no longer active — choose one from the active set.";

/** Copy for 0x020D NoClaimableRewards. */
export const NO_CLAIMABLE_REWARDS_MESSAGE =
  "No rewards are available to claim right now.";

/** Copy for 0x0214 RewardEscrowUnderfunded — the one retryable case. */
export const REWARD_ESCROW_UNDERFUNDED_MESSAGE =
  "Rewards are temporarily unfunded on-chain — try claiming again shortly.";

interface RevertEntry {
  code: number;
  /** Lowercase needles matched against the reason string. */
  needles: string[];
  message: string;
  retryable: boolean;
}

/** The six mapped codes, in table form so the tests can walk them.
 *
 *  Deliberately NOT mapped, each for a reason:
 *   - 0x0204 WeightOutOfRange — the wallet's own inputs prevent it, so seeing it
 *     means a real bug; a mapped platitude would hide that.
 *   - 0x0203 ZeroWeight — same class.
 *   - 0x020A DelegationCapExceeded — the aggregate cap ships disabled (u32::MAX)
 *     and is dead in practice.
 *   - 0x020E UnexpectedValue — structurally unreachable: every delegation call
 *     is sent value = 0. */
const REVERT_TABLE: readonly RevertEntry[] = [
  {
    code: REVERT_PER_WALLET_CAP,
    needles: ["perwalletcap", "0x0213"],
    message: PER_WALLET_CAP_REVERT_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_WALLET_TOTAL,
    needles: ["wallettotal", "0x0205"],
    message: WALLET_TOTAL_CAP_REVERT_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_TOO_MANY_DELEGATIONS,
    needles: ["toomanydelegations"],
    message: TOO_MANY_DELEGATIONS_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_INACTIVE_CLUSTER,
    needles: ["inactivecluster"],
    message: INACTIVE_CLUSTER_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_NO_CLAIMABLE_REWARDS,
    needles: ["noclaimablerewards"],
    message: NO_CLAIMABLE_REWARDS_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_REWARD_ESCROW_UNDERFUNDED,
    needles: ["rewardescrowunderfunded", "escrowunderfunded"],
    message: REWARD_ESCROW_UNDERFUNDED_MESSAGE,
    retryable: true,
  },
];

function matchEntry(reason: string, code?: number): RevertEntry | null {
  const haystack = reason.toLowerCase();
  for (const entry of REVERT_TABLE) {
    if (code !== undefined && code === entry.code) return entry;
    if (entry.needles.some((n) => haystack.includes(n))) return entry;
  }
  return null;
}

/** Map a chain rejection to plain copy, or null when it isn't one of the six.
 *
 *  Null is not a failure — it is the instruction to keep the node's own words.
 *  Matching is by numeric code OR a case-insensitive needle in the reason, so a
 *  rejection classifies whether it arrives structured or flattened into a
 *  message string. Pure. */
export function classifyDelegationRevert(
  reason: string,
  code?: number,
): string | null {
  if (typeof reason !== "string" && code === undefined) return null;
  return matchEntry(typeof reason === "string" ? reason : "", code)?.message ?? null;
}

/** True only for the escrow-underfunded tripwire: the chain is momentarily out
 *  of reward escrow and the same action can succeed shortly. Every other mapped
 *  revert describes a state the user must change first, so inviting a retry
 *  would be advice that cannot work. Pure. */
export function isRetryableDelegationRevert(
  reason: string,
  code?: number,
): boolean {
  return matchEntry(typeof reason === "string" ? reason : "", code)?.retryable ?? false;
}
