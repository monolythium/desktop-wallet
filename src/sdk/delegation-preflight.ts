// The best-effort re-read that closes the stale-snapshot race — pure control
// flow, no RPC of its own.
//
// THE RACE. The cap pre-flight reasons about a snapshot taken when the page
// mounted, and nothing re-reads it. Delegate to a cluster, then without
// refreshing open the add-more form on the same row and delegate again: the
// snapshot still carries the pre-delegation weight, the verdict passes, and the
// wallet signs a transaction the chain is guaranteed to refuse. The window is
// wider than it looks, because the verdict runs at Review-click and an approval
// drawer with a passphrase unlock stands between that and the signature.
//
// THE DIRECTION IT FAILS, AND WHY IT IS THE OPPOSITE OF THE DESTINATION CHECK.
// `resolveRedelegateDestination` fails CLOSED, because a wrong destination is a
// transaction the chain ACCEPTS — weight lands somewhere the user never named
// and nothing undoes it. This one fails OPEN, because the flow's usual asymmetry
// does apply: a stale cap producing a false pass costs an admission refusal,
// which is free (value = 0, nothing charged, and the wallet already records and
// names the failure), while a failed read producing a false block would deny a
// legitimate non-custodial action with no chain-side confirmation the block was
// right. Two guards in one flow, pointing opposite ways, each argued from what
// its own failure actually costs.
//
// NOT A SECOND RPC PATH. The caller supplies the read, and supplies the one the
// page already uses — which dials through the trust-gated provider seam. On a
// degraded chain that read simply throws and the snapshot stands, which is the
// fail-open behaviour arriving by the correct route rather than by routing
// around the gate.
//
// NOT A SPINNER. The wait is bounded; past the bound the snapshot is used and
// the flow continues. Exceeding the bound is not an error and is not reported as
// one — it is the normal degraded path.

import { normalizeAggregateCapBps } from "./delegation-caps";

/**
 * How long a Review press will wait on the re-read before proceeding on the
 * snapshot.
 *
 * Shorter than the spend guard's 2.5 s: that read gates a value transfer the
 * user has already committed to, whereas this one fires on every Review press
 * and must not read as a stall. Long enough for a healthy operator round-trip;
 * past it the snapshot is used and chain admission remains the backstop.
 */
export const DELEGATION_REREAD_TIMEOUT_MS = 1_500;

/** The pre-flight's view of delegation state. */
export interface DelegationSnapshot {
  rows: ReadonlyArray<{ cluster: number; weightBps: number }>;
  totalBps: number;
  aggregateCapBps: number | null;
}

/** The shape this module needs from a delegation-status read. Structural, so the
 *  live loader satisfies it without this module importing the RPC layer. */
export interface DelegationStatusLike {
  delegations: {
    ok: boolean;
    value?: {
      rows: ReadonlyArray<{ cluster: number; weightBps: number }>;
      totalBps: number;
    } | null;
  };
  delegationCap: { ok: boolean; value?: unknown };
}

/** Read the aggregate cap out of a status payload the same way the page does,
 *  normalising the disabled sentinel. Null on anything unreadable. */
function freshAggregateCapBps(
  cap: DelegationStatusLike["delegationCap"],
): number | null {
  if (!cap.ok) return null;
  const v = cap.value as { capBps?: unknown } | null;
  const raw = v && typeof v.capBps === "number" ? v.capBps : null;
  return normalizeAggregateCapBps(raw);
}

/**
 * Attempt a fresher delegation snapshot, bounded, and fall back to the one given.
 *
 * Returns `source: "fresh"` only when the delegation rows were actually
 * re-read — those are what race. A cap that could not be re-read keeps its
 * previous value rather than discarding an otherwise fresher view.
 *
 * Never throws and never rejects: every failure mode — a rejected read, a read
 * that outruns the bound, a failed sub-read, an absent value — resolves to the
 * caller's snapshot. Pure control flow; the caller owns the RPC.
 */
export async function refreshDelegationSnapshot(args: {
  snapshot: DelegationSnapshot;
  read: () => Promise<DelegationStatusLike>;
  timeoutMs?: number;
}): Promise<{ snapshot: DelegationSnapshot; source: "fresh" | "snapshot" }> {
  const bound = args.timeoutMs ?? DELEGATION_REREAD_TIMEOUT_MS;
  const keep = { snapshot: args.snapshot, source: "snapshot" as const };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), bound);
  });

  let status: DelegationStatusLike | null;
  try {
    // A rejected read is the trust-gated seam refusing a degraded operator, or a
    // transport failure. Either way it says nothing about the caps — keep the
    // snapshot and let chain admission be the backstop.
    status = await Promise.race([args.read().catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (status === null) return keep;
  const { delegations } = status;
  // An absent value is never read as "no delegations" — that would be a
  // fabricated zero on the exact figure the cap check depends on.
  if (!delegations.ok || !delegations.value) return keep;

  const cap = status.delegationCap.ok
    ? freshAggregateCapBps(status.delegationCap)
    : args.snapshot.aggregateCapBps;

  return {
    snapshot: {
      rows: delegations.value.rows,
      totalBps: delegations.value.totalBps,
      aggregateCapBps: cap,
    },
    source: "fresh",
  };
}
