// The durable delegation-rejection signal.
//
// A delegation rejected BEFORE a transaction hash exists leaves no trace
// anywhere. Two paths reach that state: a local preflight blocks it (an inline
// form error that dies on navigation), or the chain refuses it inside execute
// (the drawer shows the reason, then closes). `recordOperationFailure`
// early-returns without a hash — there is no canonical id to key a record on —
// and no pending row was ever tracked, because tracking is success-path-only.
//
// So an over-cap delegation could be refused and, seconds later, leave the user
// with nothing on screen explaining why their weight never changed. This signal
// is what outlives the drawer.
//
// In-memory by design. A rejection describes a moment, not a preference: it
// must not survive a restart, and it must not survive a change of the scope it
// was about — a rejection raised on one wallet or chain, shown under another,
// would be a false alarm about an account it never concerned.

/** One raised rejection. `atMs` pairs with `clusterId` as the render key so a
 *  repeat rejection for the same cluster re-renders rather than sitting stale. */
export interface DelegationRejection {
  clusterId: number;
  /** The captured real name, or null → the derived `cluster #{id}` label. Never
   *  invented. */
  clusterName: string | null;
  kind: "delegate" | "redelegate";
  /** The mapped taxonomy copy, or a preflight verdict message. */
  message: string;
  atMs: number;
}

/** Where the banner names the cluster: the captured name when the submit had
 *  one, else the honest derived label. Pure. */
export function rejectionWhereLabel(r: DelegationRejection): string {
  return r.clusterName ?? `cluster #${r.clusterId}`;
}

/** The banner sentence. Pure so the wording is pinnable without a render. */
export function rejectionBannerText(r: DelegationRejection): string {
  return `Delegation to ${rejectionWhereLabel(r)} rejected — ${r.message}`;
}

/** Dismiss control label. */
export const REJECTION_DISMISS_LABEL = "Dismiss delegation-rejected notice";

/** Does a rejection raised under `raisedScope` still belong on screen under
 *  `currentScope`? A scope is `${addressLower}:${chainIdHex}`.
 *
 *  The scope-identity rule this project has applied nine times: anything that
 *  outlives the moment it was created must carry the scope it was created in,
 *  or it will eventually be shown under a scope it was never about. Pure. */
export function rejectionStillInScope(
  raisedScope: string,
  currentScope: string,
): boolean {
  return raisedScope === currentScope;
}
