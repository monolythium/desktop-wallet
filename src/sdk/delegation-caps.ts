// Delegation cap logic (WP §16.7 anti-capture) — pure, React-free, unit-pinnable.
//
// Two caps the chain enforces and the wallet warns about BEFORE signing:
//  - a per-cluster 50% (5000 bps) per-wallet cap (chain revert 0x0213), and
//  - a global 100% (10000 bps) total-delegation cap (chain revert 0x0205).
//
// The 50% per-cluster value is the compiled protocol default. It is not truly
// FIXED — a foundation-signed milestone can only TIGHTEN it (a one-way
// constitutional ratchet), and no RPC exposes the live per-wallet cap, so a
// tightening milestone is undetectable client-side and the wallet hardcodes the
// default. A configurable cluster-aggregate cap (lyth_getDelegationCap) only
// TIGHTENS further when present — a disabled/unread aggregate cap (null) never
// lifts the floor (fail-closed).

/** Per-cluster per-wallet delegation cap floor, in basis points (5000 = 50%). */
export const DELEGATION_PER_WALLET_CAP_BPS = 5000;

/** Global total-delegation cap across all clusters, in basis points (100%). */
export const WALLET_TOTAL_CAP_BPS = 10000;

/** The chain's "no aggregate cap" sentinel (u32::MAX). */
export const CHAIN_CAP_DISABLED = 0xffffffff;

/** Normalize a raw aggregate-cap reading to an honest bps value or null. The
 *  u32::MAX disabled sentinel, an absent/non-finite value, all map to null —
 *  NEVER a fabricated cap (e.g. rendering u32::MAX as 42949672.95%). */
export function normalizeAggregateCapBps(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  if (raw === CHAIN_CAP_DISABLED) return null;
  return raw;
}

/** The binding per-cluster cap: the §16.7 floor always applies; a present
 *  aggregate cap tightens it. A null aggregate cap fails closed to the floor. */
export function bindingPerClusterCapBps(aggregateCapBps: number | null): number {
  return aggregateCapBps !== null
    ? Math.min(aggregateCapBps, DELEGATION_PER_WALLET_CAP_BPS)
    : DELEGATION_PER_WALLET_CAP_BPS;
}

/** True when adding `moveBps` to a cluster's existing weight would exceed the
 *  binding per-cluster cap (→ chain revert 0x0213). */
export function exceedsPerClusterCap(
  dstExistingWeightBps: number,
  moveBps: number,
  aggregateCapBps: number | null,
): boolean {
  return dstExistingWeightBps + moveBps > bindingPerClusterCapBps(aggregateCapBps);
}

/** True when a cluster is ALREADY at the binding cap — any positive move
 *  reverts; surface a "pick another cluster" message. */
export function destinationAtPerClusterCap(
  dstExistingWeightBps: number,
  aggregateCapBps: number | null,
): boolean {
  return dstExistingWeightBps >= bindingPerClusterCapBps(aggregateCapBps);
}

/** Global headroom for a delegate: total delegated weight may not exceed 100%
 *  (chain revert 0x0205). Never negative. */
export function walletTotalHeadroomBps(totalDelegatedBps: number): number {
  return Math.max(0, WALLET_TOTAL_CAP_BPS - totalDelegatedBps);
}

/** Clear message for a chain 0x0213 PerWalletCapExceeded revert / pre-flight. */
export const PER_WALLET_CAP_REVERT_MESSAGE =
  "This cluster is already at the 50% per-wallet cap — reduce the amount or choose another cluster.";

/** Clear message for a chain 0x0205 WalletTotalExceeded revert / pre-flight. */
export const WALLET_TOTAL_CAP_REVERT_MESSAGE =
  "This would exceed your total delegation limit (100%) — reduce the amount.";

/** The maximum number of distinct clusters one wallet may delegate to
 *  (mono-core `MAX_DELEGATIONS_PER_WALLET`). An 11th NEW row reverts 0x0206. */
export const MAX_DELEGATIONS_PER_WALLET = 10;

/** Clear message for a chain 0x0206 TooManyDelegations revert / pre-flight. */
export const TOO_MANY_DELEGATIONS_MESSAGE =
  "You already delegate to the maximum of 10 clusters — undelegate from one before adding another.";

/** True when this action would open a NEW delegation row and the wallet is
 *  already at the chain's row limit (→ chain revert 0x0206).
 *
 *  The chain counts ROWS, not weight: topping up a cluster the wallet already
 *  delegates to opens no row and is always allowed, even at ten. Blocking a
 *  top-up here would deny an action the chain permits.
 *
 *  A redelegate counts too — the chain creates the destination row before it
 *  frees the source, so moving weight to an eleventh cluster reverts. An
 *  undefined `currentDelegationCount` means the caller could not determine the
 *  count, so the check is skipped rather than guessed. Pure. */
export function opensNewDelegationRowAtLimit(
  dstExistingWeightBps: number,
  currentDelegationCount: number | undefined,
): boolean {
  if (currentDelegationCount === undefined) return false;
  if (dstExistingWeightBps > 0) return false; // a top-up opens no row
  return currentDelegationCount >= MAX_DELEGATIONS_PER_WALLET;
}

/** On-submit pre-flight: block a delegate that would hit a chain cap revert,
 *  so the wallet never signs a guaranteed-revert tx. An undelegate removes
 *  weight → never over-cap.
 *
 *  Check order is deliberate and test-pinned: undelegate is unconditionally
 *  allowed; then the row limit (a structural refusal — no amount would help);
 *  then the per-cluster cap; then the wallet total, which only a delegate can
 *  push up (a redelegate moves weight, leaving the total unchanged).
 *
 *  WHAT THIS FUNCTION DELIBERATELY DOES NOT ASK, so the absence reads as a
 *  decision rather than an oversight:
 *
 *  - Whether the wallet can PAY. There is no balance term and no fee term here,
 *    and that is on purpose. Affordability is answered beside this check, not
 *    inside it (`sdk/delegation-fee.ts`), because it needs live reads and this
 *    function must stay pure and synchronously testable without chain access.
 *    It is also ADVISORY where these are blocking: a cap breach is a certain
 *    chain refusal, while an affordability estimate can be wrong in both
 *    directions, so it warns and never gates.
 *  - Whether the weight would credit anything. An inert delegation
 *    (`isInertDelegation` in `sdk/delegation-derive.ts`) is well inside every cap
 *    — the chain accepts it — so it is not a cap question, and it needs the
 *    balance this function has no business reading.
 *
 *  Both live at the call sites, which pass this function fresher arguments and
 *  run their own checks around it. Adding either here would cost the purity that
 *  makes this the one delegation guard testable without a chain. */
export function preflightDelegationVerdict(args: {
  action: "delegate" | "undelegate" | "redelegate";
  dstExistingWeightBps: number;
  totalDelegatedBps: number;
  moveBps: number;
  capBps: number | null;
  /** Active delegation rows (weight > 0). Omitted → the row-limit check is
   *  skipped; never assumed. */
  currentDelegationCount?: number;
}): { ok: true } | { ok: false; message: string } {
  const {
    action,
    dstExistingWeightBps,
    totalDelegatedBps,
    moveBps,
    capBps,
    currentDelegationCount,
  } = args;
  if (action === "undelegate") return { ok: true };
  if (opensNewDelegationRowAtLimit(dstExistingWeightBps, currentDelegationCount)) {
    return { ok: false, message: TOO_MANY_DELEGATIONS_MESSAGE };
  }
  if (exceedsPerClusterCap(dstExistingWeightBps, moveBps, capBps)) {
    return { ok: false, message: PER_WALLET_CAP_REVERT_MESSAGE };
  }
  if (action === "delegate" && totalDelegatedBps + moveBps > WALLET_TOTAL_CAP_BPS) {
    return { ok: false, message: WALLET_TOTAL_CAP_REVERT_MESSAGE };
  }
  return { ok: true };
}

/** The always-on cap note + the active dual-cap warning (if any) for a delegate
 *  form, given the cluster's existing weight, the wallet total, the entered move
 *  (null while the input isn't a positive integer), and the aggregate cap.
 *  Pure — drives the Delegate delegate-form messaging and is unit-pinnable. */
export function delegateCapWarning(args: {
  existingWeightBps: number;
  totalDelegatedBps: number;
  additionalBps: number | null;
  aggregateCapBps: number | null;
}): { note: string; warning: string | null } {
  const binding = bindingPerClusterCapBps(args.aggregateCapBps);
  const note = `Per-wallet limit: ${(binding / 100).toFixed(0)}% to any one cluster.`;

  // Already at the per-cluster cap — independent of the entered amount.
  if (destinationAtPerClusterCap(args.existingWeightBps, args.aggregateCapBps)) {
    return {
      note,
      warning: `You've already delegated the ${(binding / 100).toFixed(0)}% per-cluster maximum to this cluster — choose another cluster to delegate more.`,
    };
  }

  if (args.additionalBps === null || args.additionalBps <= 0) {
    return { note, warning: null };
  }

  // This delegate would exceed the per-cluster cap — show the overage.
  if (exceedsPerClusterCap(args.existingWeightBps, args.additionalBps, args.aggregateCapBps)) {
    const overageBps = args.existingWeightBps + args.additionalBps - binding;
    return {
      note,
      warning: `Delegation would exceed the ${(binding / 100).toFixed(0)}% per-wallet cap for one cluster by ${(overageBps / 100).toFixed(2)}%.`,
    };
  }

  // This delegate would exceed the global 100% total.
  const headroom = walletTotalHeadroomBps(args.totalDelegatedBps);
  if (args.additionalBps > headroom) {
    return {
      note,
      warning: `You can delegate at most ${(headroom / 100).toFixed(2)}% more — total delegation across all clusters can't exceed 100%.`,
    };
  }

  return { note, warning: null };
}

/**
 * Does this cap state deserve the LOUD warning box?
 *
 * The escalation predicate, exported and pure so the boundary is a tested fact
 * rather than a JSX condition. The rule: the always-on limit NOTE stays quiet;
 * only an actual boundary — already at the per-cluster cap, over it, or past
 * the wallet's 100% total — escalates.
 *
 * Alarm fatigue is the failure this prevents. A warning shape the user sees on
 * every visit stops registering, and it is the same shape that has to carry
 * "this is as far as you can go" when it matters.
 *
 * NOTE: escalation is presentational. It never gates — the blocking decision
 * belongs to the preflight verdict, which is unchanged.
 */
export function capWarningEscalates(state: { warning: string | null }): boolean {
  return state.warning !== null;
}
