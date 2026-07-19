// The in-flight claim guard.
//
// Claiming twice wastes a fee: the second call reverts NoClaimableRewards
// because the first already settled everything. So the Claim button disables
// while a claim is outstanding, and it reads the DURABLE tracked-tx store rather
// than component state — a claim broadcast then app-quit still guards on
// relaunch, which local state could not do.
//
// The failure mode to design against is the opposite one. A guard that STICKS
// denies the user access to their own rewards with no recourse and no
// explanation, which is worse than the double-broadcast it prevents. So "in
// flight" means genuinely still moving, not merely "not confirmed":
//
//   - a bridged row (confirmedBlockHeight stamped) is done;
//   - a `dropped` or `expired` row is TERMINAL — it will never confirm, and the
//     naive "no confirmedBlockHeight" test would hold the button hostage to it
//     for the full 60-minute retain window;
//   - a failed claim stops being tracked at all, so it leaves the store.
//
// Three independent releases therefore exist: the lifecycle test here, the
// user's Dismiss on a terminal row, and the 60-minute retain sweep.

import type { PendingTx } from "./pending-tx";

/** Is this tracked row a claim that might still land? Pure.
 *
 *  Deliberately narrower than "a claim without a confirmation": a terminal
 *  lifecycle releases the guard immediately rather than waiting out the
 *  retention window. */
export function isClaimStillMoving(
  tx: Pick<PendingTx, "opKind" | "confirmedBlockHeight" | "lifecycle">,
): boolean {
  if (tx.opKind !== "claim") return false;
  // Receipt-confirmed ahead of the indexer — settled.
  if (tx.confirmedBlockHeight !== undefined) return false;
  // Terminal: the chain moved past it (nonce drop) or the tracking window
  // expired. Neither will ever confirm, so neither may hold the button.
  if (tx.lifecycle === "dropped" || tx.lifecycle === "expired") return false;
  return true;
}

/** True when the given scope has a claim that might still land. Pure. */
export function hasInFlightClaim(
  rows: ReadonlyArray<PendingTx>,
  addressLower: string,
  chainIdHex: string,
): boolean {
  const scope = addressLower.toLowerCase();
  if (scope.length === 0) return false;
  return rows.some(
    (t) =>
      t.addressLower.toLowerCase() === scope &&
      t.chainIdHex === chainIdHex &&
      isClaimStillMoving(t),
  );
}

/** Tooltip shown on the disabled Claim button while a claim is outstanding.
 *  Names the condition AND when it lifts, so a disabled control is never just
 *  unexplained. */
export const CLAIM_IN_FLIGHT_TOOLTIP =
  "A reward claim is pending confirmation — you can claim again once it's confirmed.";

/** Label for the button while a claim is outstanding. */
export const CLAIM_IN_FLIGHT_LABEL = "Claiming…";

/** Grace after observing confirmation before the in-flight presentation drops,
 *  so the state change reads as a transition rather than a flicker. */
export const CLAIM_CONFIRM_GRACE_MS = 1_500;

/** The Claim button's state. Precedence is deliberate: in-flight outranks
 *  "nothing to claim", because a claim that just settled everything leaves the
 *  claimable at zero — reporting "Nothing to claim" then would explain the
 *  disabled button with the wrong reason. Pure. */
export function claimButtonState(input: {
  inFlight: boolean;
  claimable: boolean;
}): { label: string; disabled: boolean; title: string; tooltip: string | null } {
  if (input.inFlight) {
    return {
      label: CLAIM_IN_FLIGHT_LABEL,
      disabled: true,
      title: CLAIM_IN_FLIGHT_TOOLTIP,
      tooltip: CLAIM_IN_FLIGHT_TOOLTIP,
    };
  }
  if (!input.claimable) {
    return {
      label: "Claim all",
      disabled: true,
      title: "Nothing to claim",
      tooltip: null,
    };
  }
  return {
    label: "Claim all",
    disabled: false,
    title: "Settle and withdraw all pending rewards",
    tooltip: null,
  };
}
