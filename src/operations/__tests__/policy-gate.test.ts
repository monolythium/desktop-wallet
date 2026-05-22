// Phase 8 — OperationsDrawer policy gate evaluation. Pure logic
// tests so the dozen-or-so branch combinations have direct coverage
// without spinning up the React tree.

import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../../sdk/policy";
import { evaluatePolicyGate } from "../policy-gate";

describe("evaluatePolicyGate", () => {
  it("skips when the tx value is below the trigger threshold", () => {
    const out = evaluatePolicyGate({
      policy: {
        ...DEFAULT_POLICY,
        triggerThresholdLyth: 100,
        passkeyRequired: true,
        enrolledForHighValue: true,
      },
      valueLyth: 50,
      enrolledPasskeyCount: 2,
    });
    expect(out).toEqual({ kind: "skip", reason: "below_threshold" });
  });

  it("skips when the policy is off, even above the threshold", () => {
    const out = evaluatePolicyGate({
      policy: {
        ...DEFAULT_POLICY,
        triggerThresholdLyth: 100,
        passkeyRequired: false,
        enrolledForHighValue: true,
      },
      valueLyth: 500,
      enrolledPasskeyCount: 2,
    });
    expect(out).toEqual({ kind: "skip", reason: "policy_off" });
  });

  it("skips when no passkey is enrolled, even with policy on + above threshold", () => {
    const out = evaluatePolicyGate({
      policy: {
        ...DEFAULT_POLICY,
        triggerThresholdLyth: 100,
        passkeyRequired: true,
        enrolledForHighValue: true,
      },
      valueLyth: 500,
      enrolledPasskeyCount: 0,
    });
    expect(out).toEqual({ kind: "skip", reason: "no_passkey" });
  });

  it("requires a challenge above threshold + policy on + ≥1 passkey", () => {
    const out = evaluatePolicyGate({
      policy: {
        ...DEFAULT_POLICY,
        triggerThresholdLyth: 100,
        passkeyRequired: true,
        enrolledForHighValue: true,
      },
      valueLyth: 200,
      enrolledPasskeyCount: 1,
    });
    expect(out).toEqual({ kind: "challenge_required" });
  });

  it("evaluates exact-threshold matches as above-threshold (≥, not >)", () => {
    const out = evaluatePolicyGate({
      policy: {
        ...DEFAULT_POLICY,
        triggerThresholdLyth: 100,
        passkeyRequired: true,
        enrolledForHighValue: true,
      },
      valueLyth: 100,
      enrolledPasskeyCount: 1,
    });
    expect(out).toEqual({ kind: "challenge_required" });
  });

  it("evaluates just-below-threshold as skip", () => {
    const out = evaluatePolicyGate({
      policy: {
        ...DEFAULT_POLICY,
        triggerThresholdLyth: 100,
        passkeyRequired: true,
        enrolledForHighValue: true,
      },
      valueLyth: 99.999,
      enrolledPasskeyCount: 1,
    });
    expect(out).toEqual({ kind: "skip", reason: "below_threshold" });
  });
});
