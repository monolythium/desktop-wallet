// Validation for the agent fund and policy forms — extracted, pure, testable.
//
// WHY THIS MODULE EXISTS. These checks used to live inline between a chain of
// `window.prompt` calls. Converting that chain to an in-app form is exactly the
// kind of change where validation quietly weakens: a check that ran "because
// the user had to answer prompt 2 before prompt 3" has no natural home in a
// form where every field is visible at once, and it disappears without anyone
// noticing.
//
// So the checks moved OUT of the interaction and into functions that do not
// know what a prompt or a form is. The messages are byte-identical to the ones
// the native dialogs showed, and the test file pins them one by one against the
// pre-conversion behaviour. What changed is the surface. What is checked, in
// what order, producing which rejection, did not.
//
// These are fund flows. The bar is not "the form feels right" — it is that
// every input the old path rejected, this path still rejects, for the same
// stated reason.

import { parseLythToLythoshi } from "@monolythium/core-sdk";

// ── Fund flow ────────────────────────────────────────────────────────────────

/** Verbatim rejection messages from the native-dialog era. */
export const FUND_INVALID_AMOUNT = "Enter a valid LYTH amount.";
export const FUND_NON_POSITIVE_AMOUNT = "Enter a positive LYTH amount.";

export type FundAmountVerdict =
  | { ok: true; amountLyth: string; amountLythoshi: bigint }
  | { ok: false; error: string };

/**
 * Validate a funding amount.
 *
 * Order is load-bearing and matches the original: parse first, then the
 * positivity check. A malformed string must report "not valid", not "not
 * positive" — the two send the user to different corrections.
 */
export function validateFundAmount(raw: string): FundAmountVerdict {
  const amountLyth = raw.trim();
  let amountLythoshi: bigint;
  try {
    amountLythoshi = parseLythToLythoshi(amountLyth);
  } catch {
    return { ok: false, error: FUND_INVALID_AMOUNT };
  }
  if (amountLythoshi <= 0n) {
    return { ok: false, error: FUND_NON_POSITIVE_AMOUNT };
  }
  return { ok: true, amountLyth, amountLythoshi };
}

/** The insufficient-balance refusal, worded exactly as before. */
export function insufficientBalanceMessage(
  balanceLyth: string,
  amountLyth: string,
): string {
  return (
    `Insufficient balance. The principal holds ${balanceLyth} LYTH ` +
    `but ${amountLyth} LYTH is needed (plus fees). Fund the principal first.`
  );
}

/** The balance-read-failed question, worded exactly as before. A failed read
 *  WARNS but does not block: the chain surfaces the real error either way, and
 *  refusing on an RPC blip would strand a user whose funds are fine. */
export function balanceCheckFailedMessage(reason: string): string {
  return (
    `Could not check the principal's balance (${reason}). ` +
    `Continue anyway? The transaction will fail on-chain if funds are short.`
  );
}

// ── Policy / cap form ────────────────────────────────────────────────────────

export const POLICY_INVALID_CAPS = "Caps must be valid LYTH amounts.";
export const POLICY_INVALID_WINDOW = "Time window must be START-END, e.g. 9-17.";
export const POLICY_INVALID_HOURS = "Hours must be 0-23.";
export const POLICY_INVALID_EXPIRY = "Expiry must be a valid ISO date.";
/** The agent password was required by the old flow's `length === 0 → cancel`
 *  branch. In a form that silent cancel becomes a stated reason. */
export const POLICY_AGENT_PASSWORD_REQUIRED =
  "The agent vault password is required to sign the policy claim.";

/** The defaults the sequential prompts pre-filled. Preserved so the form opens
 *  on the same values the old flow proposed. */
export const POLICY_FORM_DEFAULTS = {
  perTx: "1",
  daily: "10",
  weekly: "",
  monthly: "",
  window: "",
  expiry: "",
} as const;

export interface PolicyFormInput {
  perTx: string;
  daily: string;
  weekly: string;
  monthly: string;
  /** `START-END` hours, or blank for any time. */
  window: string;
  /** ISO date, or blank for never. */
  expiry: string;
  /** Required only for a FRESH policy — an update is signed by the principal
   *  alone, so no agent unlock is needed. */
  agentPassword: string;
}

export interface PolicyFields {
  perTxCapLythoshi: bigint;
  dailyCapLythoshi: bigint;
  weeklyCapLythoshi?: bigint;
  monthlyCapLythoshi?: bigint;
  timeWindow?: { enabled: boolean; startHour: number; endHour: number };
  policyExpiryUnixSeconds?: bigint;
}

export type PolicyFormVerdict =
  | { ok: true; fields: PolicyFields; agentPassword: string }
  | { ok: false; error: string };

/** Blank means "no cap" — 0n, not a rejection. Preserved from the original. */
function toLythoshi(s: string): bigint {
  const t = s.trim();
  if (t.length === 0) return 0n;
  return parseLythToLythoshi(t);
}

/**
 * Validate the policy form.
 *
 * `existing` mirrors the old flow's branch: an already-bound policy takes the
 * no-claim `setPolicy` UPDATE path, signed by the principal alone, so the agent
 * vault password is neither collected nor required.
 *
 * Check order matches the original exactly — caps, then window, then expiry —
 * so a form with two problems reports the same one it always did.
 */
export function validatePolicyForm(
  input: PolicyFormInput,
  existing: boolean,
): PolicyFormVerdict {
  let agentPassword = "";
  if (!existing) {
    if (input.agentPassword.length === 0) {
      return { ok: false, error: POLICY_AGENT_PASSWORD_REQUIRED };
    }
    agentPassword = input.agentPassword;
  }

  let fields: PolicyFields;
  try {
    fields = {
      perTxCapLythoshi: toLythoshi(input.perTx),
      dailyCapLythoshi: toLythoshi(input.daily),
      weeklyCapLythoshi: toLythoshi(input.weekly),
      monthlyCapLythoshi: toLythoshi(input.monthly),
    };
  } catch {
    return { ok: false, error: POLICY_INVALID_CAPS };
  }

  const wt = input.window.trim();
  if (wt.length > 0) {
    const m = wt.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
    if (!m) return { ok: false, error: POLICY_INVALID_WINDOW };
    const startHour = Number(m[1]);
    const endHour = Number(m[2]);
    if (startHour > 23 || endHour > 23) {
      return { ok: false, error: POLICY_INVALID_HOURS };
    }
    fields.timeWindow = { enabled: true, startHour, endHour };
  }

  const et = input.expiry.trim();
  if (et.length > 0) {
    const ms = Date.parse(et);
    if (Number.isNaN(ms)) return { ok: false, error: POLICY_INVALID_EXPIRY };
    fields.policyExpiryUnixSeconds = BigInt(Math.floor(ms / 1000));
  }

  return { ok: true, fields, agentPassword };
}

// ── Typed-name destructive confirm ───────────────────────────────────────────

/**
 * Does the typed text authorise a destructive action on `name`?
 *
 * EXACT match, no trimming, no case folding — the same comparison the native
 * prompt performed (`confirm !== name → return`). Trimming here would be a
 * quiet loosening: the whole point of a typed confirm is that the user
 * reproduced the name deliberately.
 */
export function typedNameConfirms(typed: string, name: string): boolean {
  return typed === name;
}
