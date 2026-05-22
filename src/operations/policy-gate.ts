// Pure helpers for the OperationsDrawer's two-tier policy evaluation.
//
// The drawer wires these between the auth pane and `execute()` (or
// `runProposalCreate()` in the multisig branch). Keeping the logic
// pure means the dozen-or-so branch combinations (below threshold,
// above + policy off, above + policy on + no passkey, above + policy
// on + has passkey, ...) are unit-testable without a full drawer
// render.
//
// Whitepaper §28.5 Q29-31 / Phase 7 policy data model.

import type { PolicyConfig } from "../sdk/policy";

/** Outcome of evaluating a single tx against the policy + passkey
 *  inventory. The drawer consumes this synchronously and decides
 *  whether to fire the passkey challenge before calling execute. */
export type PolicyEvalResult =
  /** Below threshold OR policy off OR no passkey enrolled — proceed
   *  with the single-factor master-password flow. */
  | { kind: "skip"; reason: "below_threshold" | "policy_off" | "no_passkey" }
  /** Above threshold + policy on + ≥1 passkey — drawer must obtain
   *  a passkey assertion before calling execute. */
  | { kind: "challenge_required" };

/** Evaluate the policy against the supplied tx value (in LYTH
 *  display-precision) + the live passkey count. Pure. */
export function evaluatePolicyGate(args: {
  policy: PolicyConfig;
  valueLyth: number;
  enrolledPasskeyCount: number;
}): PolicyEvalResult {
  const { policy, valueLyth, enrolledPasskeyCount } = args;
  if (valueLyth < policy.triggerThresholdLyth) {
    return { kind: "skip", reason: "below_threshold" };
  }
  if (!policy.passkeyRequired) {
    return { kind: "skip", reason: "policy_off" };
  }
  if (enrolledPasskeyCount === 0) {
    return { kind: "skip", reason: "no_passkey" };
  }
  return { kind: "challenge_required" };
}
