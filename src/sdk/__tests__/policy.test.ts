// Two-tier policy — config CRUD + posture computation.

import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_POLICY,
  describePolicyPosture,
  getPolicy,
  isAboveThreshold,
  POLICY_THRESHOLD_MAX_LYTH,
  POLICY_THRESHOLD_MIN_LYTH,
  resetPolicy,
  setPolicy,
} from "../policy";

beforeEach(() => {
  resetPolicy();
});

describe("policy · CRUD", () => {
  it("returns defaults when no policy is stored", () => {
    const p = getPolicy();
    expect(p).toEqual(DEFAULT_POLICY);
  });

  it("persists + reads back a threshold", () => {
    setPolicy({ triggerThresholdLyth: 250 });
    expect(getPolicy().triggerThresholdLyth).toBe(250);
  });

  it("clamps threshold to the allowed range", () => {
    setPolicy({ triggerThresholdLyth: 0 });
    expect(getPolicy().triggerThresholdLyth).toBe(POLICY_THRESHOLD_MIN_LYTH);
    setPolicy({ triggerThresholdLyth: 99_999 });
    expect(getPolicy().triggerThresholdLyth).toBe(POLICY_THRESHOLD_MAX_LYTH);
  });

  it("rejects NaN and falls back to default", () => {
    setPolicy({ triggerThresholdLyth: Number.NaN });
    expect(getPolicy().triggerThresholdLyth).toBe(DEFAULT_POLICY.triggerThresholdLyth);
  });

  it("supports partial updates without clobbering other fields", () => {
    setPolicy({ triggerThresholdLyth: 300, passkeyRequired: true });
    setPolicy({ triggerThresholdLyth: 500 });
    const p = getPolicy();
    expect(p.triggerThresholdLyth).toBe(500);
    expect(p.passkeyRequired).toBe(true);
  });

  it("reset restores defaults", () => {
    setPolicy({ triggerThresholdLyth: 250, passkeyRequired: true });
    resetPolicy();
    expect(getPolicy()).toEqual(DEFAULT_POLICY);
  });
});

describe("policy · isAboveThreshold", () => {
  it("returns true when value ≥ threshold", () => {
    const p = setPolicy({ triggerThresholdLyth: 100 });
    expect(isAboveThreshold(p, 99)).toBe(false);
    expect(isAboveThreshold(p, 100)).toBe(true);
    expect(isAboveThreshold(p, 101)).toBe(true);
  });
});

describe("policy · describePolicyPosture", () => {
  it("multisig overrides everything else", () => {
    const policy = setPolicy({ passkeyRequired: true, enrolledForHighValue: true });
    const r = describePolicyPosture({
      policy,
      multisigActive: true,
      multisigThreshold: 2,
      multisigSignerCount: 3,
    });
    expect(r.label).toBe("Multisig 2-of-3");
    expect(r.tone).toBe("strong");
  });

  it("two-factor active when enrolled + required", () => {
    const policy = setPolicy({ passkeyRequired: true, enrolledForHighValue: true });
    const r = describePolicyPosture({ policy, multisigActive: false });
    expect(r.label).toBe("Two-factor active");
    expect(r.tone).toBe("strong");
  });

  it("two-factor available when enrolled but not required", () => {
    const policy = setPolicy({ passkeyRequired: false, enrolledForHighValue: true });
    const r = describePolicyPosture({ policy, multisigActive: false });
    expect(r.label).toBe("Two-factor available");
    expect(r.tone).toBe("ok");
  });

  it("single-factor when no passkey enrolled", () => {
    const policy = setPolicy({ passkeyRequired: false, enrolledForHighValue: false });
    const r = describePolicyPosture({ policy, multisigActive: false });
    expect(r.label).toBe("Single-factor");
    expect(r.tone).toBe("weak");
  });
});
