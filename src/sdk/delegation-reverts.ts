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
  MAX_DELEGATIONS_PER_WALLET,
  PER_WALLET_CAP_REVERT_MESSAGE,
  TOO_MANY_DELEGATIONS_MESSAGE,
  WALLET_TOTAL_CAP_REVERT_MESSAGE,
  perWalletCapRevertMessage,
} from "./delegation-caps";
import { ClassifiedWalletError } from "./send-error";

// The three codes with a local preflight twin are DEFINED in delegation-caps.ts
// (next to the check that raises them) and re-exported here, so the taxonomy is
// one table with one definition per code — never two copies that drift apart.
export {
  MAX_DELEGATIONS_PER_WALLET,
  PER_WALLET_CAP_REVERT_MESSAGE,
  TOO_MANY_DELEGATIONS_MESSAGE,
  WALLET_TOTAL_CAP_REVERT_MESSAGE,
};

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
    needles: ["toomanydelegations", "0x0206"],
    message: TOO_MANY_DELEGATIONS_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_INACTIVE_CLUSTER,
    needles: ["inactivecluster", "0x020b"],
    message: INACTIVE_CLUSTER_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_NO_CLAIMABLE_REWARDS,
    needles: ["noclaimablerewards", "0x020d"],
    message: NO_CLAIMABLE_REWARDS_MESSAGE,
    retryable: false,
  },
  {
    code: REVERT_REWARD_ESCROW_UNDERFUNDED,
    needles: ["rewardescrowunderfunded", "escrowunderfunded", "0x0214"],
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
  /** The live aggregate cap, so the per-wallet-cap copy quotes the number that
   *  actually binds rather than the floor. Absent → the floor. */
  aggregateCapBps?: number | null,
): string | null {
  if (typeof reason !== "string" && code === undefined) return null;
  const entry = matchEntry(typeof reason === "string" ? reason : "", code);
  if (entry === null) return null;
  return entry.code === REVERT_PER_WALLET_CAP
    ? perWalletCapRevertMessage(aggregateCapBps ?? null)
    : entry.message;
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

/** Classify a THROWN delegation failure by walking the whole cause chain and
 *  testing each level.
 *
 *  Deliberately not `extractSendError`, which keeps the OUTERMOST message: a
 *  wrapper like "submit failed" would then mask an inner "InactiveCluster" and
 *  the rejection would surface as unclassified. Every level is tried, so the
 *  revert reason classifies wherever in the chain it sits.
 *
 *  Returns null when no level matches — the caller keeps the raw error. Pure. */
export function classifyDelegationFailure(
  cause: unknown,
  aggregateCapBps?: number | null,
): string | null {
  const seen = new Set<unknown>();
  let cur: unknown = cause;
  while (cur !== null && cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur === "string") {
      const hit = classifyDelegationRevert(cur, undefined, aggregateCapBps);
      if (hit !== null) return hit;
      return null;
    }
    if (typeof cur !== "object") return null;
    const o = cur as { message?: unknown; code?: unknown; cause?: unknown };
    const message = typeof o.message === "string" ? o.message : "";
    const code =
      typeof o.code === "number" && Number.isFinite(o.code) ? o.code : undefined;
    const hit = classifyDelegationRevert(message, code, aggregateCapBps);
    if (hit !== null) return hit;
    cur = o.cause;
  }
  return null;
}

/** Run a delegation submit, translating a recognised chain rejection into plain
 *  copy on the way out.
 *
 *  Mapped: `onMapped` is notified (the durable rejection signal hooks in here)
 *  and the error is re-thrown carrying the plain sentence, so the drawer shows
 *  the same words the banner does.
 *
 *  Unmapped: the original error is re-thrown UNTOUCHED. Replacing it with a
 *  generic sentence would leave a genuine bug with no evidence — the raw node
 *  reason is the only diagnostic the user can pass on. */
export async function withDelegationRevertCopy<T>(
  run: () => Promise<T>,
  onMapped?: (message: string) => void,
  /** The live aggregate cap, so a per-wallet-cap revert quotes the binding
   *  number rather than the protocol floor. */
  aggregateCapBps?: number | null,
): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    const mapped = classifyDelegationFailure(cause, aggregateCapBps);
    if (mapped === null) throw cause;
    onMapped?.(mapped);
    // ClassifiedWalletError, not a bare Error: this sentence IS the copy to
    // show, and the shared rule table must not re-derive a generic body over it.
    // An unmapped failure above is rethrown untouched and stays eligible for
    // those branches — the taxonomy is unchanged, only what happens after it.
    throw new ClassifiedWalletError(mapped, { cause });
  }
}
