// Law 4.4 — escalation is EARNED.
//
// The always-on limit note stays quiet; only a real boundary gets the loud box.
// The failure this prevents is alarm fatigue: a warning shape shown on every
// visit stops registering, and it is the same shape that has to carry "this is
// as far as you can go" at the moment it matters.
//
// The second describe block is the guardrail that makes the restyle safe: a
// presentational change must not move the blocking decision by even one basis
// point.

import { describe, expect, it } from "vitest";
import {
  capWarningEscalates,
  delegateCapWarning,
  exceedsPerClusterCap,
  preflightDelegationVerdict,
} from "../delegation-caps";

/** 25% aggregate cap → the binding per-cluster limit used throughout. */
const CAP = 2_500;

function state(over: {
  existingWeightBps?: number;
  totalDelegatedBps?: number;
  additionalBps?: number | null;
}) {
  return delegateCapWarning({
    existingWeightBps: over.existingWeightBps ?? 0,
    totalDelegatedBps: over.totalDelegatedBps ?? 0,
    additionalBps: over.additionalBps ?? null,
    aggregateCapBps: CAP,
  });
}

describe("quiet below the boundary", () => {
  it("no amount entered → note only", () => {
    const s = state({ additionalBps: null });
    expect(s.warning).toBeNull();
    expect(capWarningEscalates(s)).toBe(false);
    // The note is ALWAYS present — it is information, not an alarm.
    expect(s.note).toContain("Per-wallet cap");
  });

  it("a comfortable amount → note only", () => {
    const s = state({ additionalBps: 500 });
    expect(capWarningEscalates(s)).toBe(false);
  });

  it("exactly at the cap, arriving → still quiet (allowed, not exceeded)", () => {
    const s = state({ existingWeightBps: 0, additionalBps: CAP });
    expect(exceedsPerClusterCap(0, CAP, CAP)).toBe(false);
    expect(capWarningEscalates(s)).toBe(false);
  });
});

describe("loud at the boundary", () => {
  it("already at the per-cluster cap → escalates", () => {
    const s = state({ existingWeightBps: CAP, additionalBps: null });
    expect(capWarningEscalates(s)).toBe(true);
    expect(s.warning).toContain("already at the");
  });

  it("one basis point over the cap → escalates", () => {
    const s = state({ existingWeightBps: 0, additionalBps: CAP + 1 });
    expect(capWarningEscalates(s)).toBe(true);
    expect(s.warning).toContain("exceed");
  });

  it("over the wallet's 100% total → escalates", () => {
    const s = state({ totalDelegatedBps: 9_900, additionalBps: 200 });
    expect(capWarningEscalates(s)).toBe(true);
    expect(s.warning).toContain("at most");
  });

  it("the note still renders beside the loud warning", () => {
    // Escalating must not swallow the information the user needs to act.
    const s = state({ existingWeightBps: CAP });
    expect(s.note).toContain("Per-wallet cap");
    expect(s.warning).not.toBeNull();
  });
});

describe("guardrail — the restyle moved no gating", () => {
  it("escalation is presentational: it never decides blocking", () => {
    // A state that escalates visually, and the verdict that actually blocks.
    // These are separate functions and must stay so; the loud box is a signal,
    // the verdict is the decision.
    const loud = state({ existingWeightBps: 0, additionalBps: CAP + 1 });
    expect(capWarningEscalates(loud)).toBe(true);

    const verdict = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 0,
      totalDelegatedBps: 0,
      moveBps: CAP + 1,
      capBps: CAP,
    });
    // The verdict blocks on its own arithmetic, not on the warning's presence.
    expect(verdict.ok).toBe(false);
  });

  it("the over-cap path still blocks after the restyle", () => {
    expect(
      preflightDelegationVerdict({
        action: "delegate",
        dstExistingWeightBps: CAP,
        totalDelegatedBps: CAP,
        moveBps: 1,
        capBps: CAP,
      }).ok,
    ).toBe(false);
  });

  it("an allowed delegation still passes", () => {
    expect(
      preflightDelegationVerdict({
        action: "delegate",
        dstExistingWeightBps: 0,
        totalDelegatedBps: 0,
        moveBps: 500,
        capBps: CAP,
      }).ok,
    ).toBe(true);
  });
});
