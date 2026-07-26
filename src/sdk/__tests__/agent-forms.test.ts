// G1 — validation parity across the native-dialog → in-app conversion.
//
// Converting a chain of `window.prompt` calls into a form changes the
// interaction model, and that is precisely where a check goes missing: one that
// held "because the user had to answer prompt 2 before prompt 3" has no natural
// home in a form where every field is visible at once.
//
// These are fund flows, so the bar is not "the form feels right". Every input
// the native path rejected must still be rejected, for the same stated reason,
// in the same order. Each case below is written against the PRE-conversion
// behaviour, not against the new code.

import { describe, expect, it } from "vitest";
import {
  FUND_INVALID_AMOUNT,
  FUND_NON_POSITIVE_AMOUNT,
  POLICY_AGENT_PASSWORD_REQUIRED,
  POLICY_FORM_DEFAULTS,
  POLICY_INVALID_CAPS,
  POLICY_INVALID_EXPIRY,
  POLICY_INVALID_HOURS,
  POLICY_INVALID_WINDOW,
  balanceCheckFailedMessage,
  insufficientBalanceMessage,
  typedNameConfirms,
  validateFundAmount,
  validatePolicyForm,
  type PolicyFormInput,
} from "../agent-forms";

function policy(over: Partial<PolicyFormInput> = {}): PolicyFormInput {
  return {
    perTx: "1",
    daily: "10",
    weekly: "",
    monthly: "",
    window: "",
    expiry: "",
    agentPassword: "pw",
    ...over,
  };
}

describe("fund amount — the checks the prompts ran", () => {
  it("accepts a plain amount and carries the trimmed string through", () => {
    const v = validateFundAmount("  2.5  ");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.amountLyth).toBe("2.5");
      expect(v.amountLythoshi).toBe(2_500_000_000_000_000_000n);
    }
  });

  it("rejects a malformed amount with the ORIGINAL wording", () => {
    for (const raw of ["abc", "1.2.3", "", "   "]) {
      const v = validateFundAmount(raw);
      expect(v.ok, raw).toBe(false);
      if (!v.ok) expect(v.error).toBe(FUND_INVALID_AMOUNT);
    }
  });

  it("the SDK parser accepts a unit suffix — recorded, not changed", () => {
    // "1 LYTH" parses. Surprising, and NOT a behaviour this conversion
    // introduced: the native path called the same parser, so it accepted it
    // too. Pinned so the fact is visible rather than rediscovered, and so a
    // future tightening is a deliberate diff here.
    expect(validateFundAmount("1 LYTH").ok).toBe(true);
  });

  it("rejects zero with the POSITIVE wording, not the valid-amount one", () => {
    // Order matters: a parseable zero is a different mistake from garbage, and
    // the two corrections differ. Reporting "not valid" for "0" would send the
    // user looking for a typo that isn't there.
    const v = validateFundAmount("0");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe(FUND_NON_POSITIVE_AMOUNT);
  });

  it("rejects a negative amount", () => {
    const v = validateFundAmount("-1");
    expect(v.ok).toBe(false);
  });

  it("parse failure outranks the positivity check", () => {
    // "abc" is not positive either; it must still report the parse failure.
    const v = validateFundAmount("abc");
    if (!v.ok) expect(v.error).toBe(FUND_INVALID_AMOUNT);
  });
});

describe("fund amount — the balance messages, verbatim", () => {
  it("insufficient balance names both figures", () => {
    expect(insufficientBalanceMessage("3", "10")).toBe(
      "Insufficient balance. The principal holds 3 LYTH but 10 LYTH is needed (plus fees). Fund the principal first.",
    );
  });

  it("a failed balance read asks rather than blocks", () => {
    // Deliberately not a refusal: the chain surfaces the real error either way,
    // and refusing on an RPC blip strands a user whose funds are fine.
    const msg = balanceCheckFailedMessage("connection refused");
    expect(msg).toBe(
      "Could not check the principal's balance (connection refused). Continue anyway? The transaction will fail on-chain if funds are short.",
    );
    expect(msg).toContain("Continue anyway?");
  });
});

describe("policy form — the seven prompts' checks", () => {
  it("accepts the defaults the prompts pre-filled", () => {
    const v = validatePolicyForm(policy({ ...POLICY_FORM_DEFAULTS, agentPassword: "pw" }), false);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.fields.perTxCapLythoshi).toBe(1_000_000_000_000_000_000n);
      expect(v.fields.dailyCapLythoshi).toBe(10_000_000_000_000_000_000n);
    }
  });

  it("blank means NO CAP (0n), never a rejection", () => {
    const v = validatePolicyForm(policy({ weekly: "", monthly: "  " }), false);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.fields.weeklyCapLythoshi).toBe(0n);
      expect(v.fields.monthlyCapLythoshi).toBe(0n);
    }
  });

  it("a malformed cap is rejected with the ORIGINAL wording", () => {
    for (const key of ["perTx", "daily", "weekly", "monthly"] as const) {
      const v = validatePolicyForm(policy({ [key]: "not-a-number" }), false);
      expect(v.ok, key).toBe(false);
      if (!v.ok) expect(v.error).toBe(POLICY_INVALID_CAPS);
    }
  });

  it("a malformed time window is rejected with the ORIGINAL wording", () => {
    for (const w of ["9", "9 to 17", "abc", "9-", "-17", "9-17-20"]) {
      const v = validatePolicyForm(policy({ window: w }), false);
      expect(v.ok, w).toBe(false);
      if (!v.ok) expect(v.error).toBe(POLICY_INVALID_WINDOW);
    }
  });

  it("accepts the window shapes the regex allowed, spaces included", () => {
    for (const w of ["9-17", "09-17", " 9 - 17 ", "0-23"]) {
      const v = validatePolicyForm(policy({ window: w }), false);
      expect(v.ok, w).toBe(true);
    }
  });

  it("hours above 23 are rejected with the HOURS wording, not the shape one", () => {
    const v = validatePolicyForm(policy({ window: "9-24" }), false);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe(POLICY_INVALID_HOURS);

    const v2 = validatePolicyForm(policy({ window: "99-17" }), false);
    if (!v2.ok) expect(v2.error).toBe(POLICY_INVALID_HOURS);
  });

  it("a malformed expiry is rejected with the ORIGINAL wording", () => {
    const v = validatePolicyForm(policy({ expiry: "not-a-date" }), false);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe(POLICY_INVALID_EXPIRY);
  });

  it("a valid expiry becomes UNIX seconds", () => {
    const v = validatePolicyForm(policy({ expiry: "2027-01-01" }), false);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.fields.policyExpiryUnixSeconds).toBe(
        BigInt(Math.floor(Date.parse("2027-01-01") / 1000)),
      );
    }
  });

  it("caps are checked BEFORE the window (the original order)", () => {
    // Both are wrong; the caps message must win, as it did between prompts.
    const v = validatePolicyForm(policy({ perTx: "bad", window: "bad" }), false);
    if (!v.ok) expect(v.error).toBe(POLICY_INVALID_CAPS);
  });

  it("the window is checked BEFORE the expiry", () => {
    const v = validatePolicyForm(policy({ window: "bad", expiry: "bad" }), false);
    if (!v.ok) expect(v.error).toBe(POLICY_INVALID_WINDOW);
  });
});

describe("policy form — the agent-password branch", () => {
  it("a FRESH policy requires the agent password", () => {
    // The old flow treated an empty password as a silent cancel. In a form that
    // silence becomes a stated reason — strictly more informative, never more
    // permissive.
    const v = validatePolicyForm(policy({ agentPassword: "" }), false);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe(POLICY_AGENT_PASSWORD_REQUIRED);
  });

  it("an UPDATE does not require it — signed by the principal alone", () => {
    const v = validatePolicyForm(policy({ agentPassword: "" }), true);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.agentPassword).toBe("");
  });

  it("an UPDATE never carries an agent password onward", () => {
    // Defensive: even if the field held a value, the update path must not sign
    // with the agent key.
    const v = validatePolicyForm(policy({ agentPassword: "typed-anyway" }), true);
    if (v.ok) expect(v.agentPassword).toBe("");
  });
});

describe("typed-name confirm — exact match, no loosening", () => {
  it("only the exact name authorises", () => {
    expect(typedNameConfirms("agent-1", "agent-1")).toBe(true);
  });

  it("case, whitespace and partials do NOT authorise", () => {
    // Trimming would be a quiet loosening: the point of a typed confirm is that
    // the user reproduced the name deliberately.
    for (const typed of ["Agent-1", "agent-1 ", " agent-1", "agent", "", "agent-11"]) {
      expect(typedNameConfirms(typed, "agent-1"), typed).toBe(false);
    }
  });
});
