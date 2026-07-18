// Setup-health: the nag predicate, the completion maths, and the step registry.
//
// The properties worth pinning are the ones that keep this from nagging
// dishonestly: completion always wins over any stored state, an unreadable read
// counts as complete rather than as a reason to nag, and dismissal is scoped to
// one wallet.

import { beforeEach, describe, expect, it } from "vitest";
import {
  deriveSetupSteps,
  dismissSetupNagForever,
  readSetupNagState,
  SETUP_NAG_SNOOZE_MS,
  SETUP_NAG_STORAGE_KEY,
  setupCompletion,
  shouldShowSetupNag,
  snoozeSetupNag,
  type SetupNagState,
  type SetupStep,
} from "../setup-health-nag";

const NOW = 1_700_000_000_000;
const A = "mono1aaa";
const B = "mono1bbb";

beforeEach(() => {
  localStorage.clear();
});

describe("shouldShowSetupNag", () => {
  const snoozed = (until: number): SetupNagState => ({
    dismissedForever: false,
    snoozedUntilMs: until,
  });

  it("completion always wins, over every stored state", () => {
    expect(shouldShowSetupNag(null, true, NOW)).toBe(false);
    expect(shouldShowSetupNag(snoozed(NOW + 1), true, NOW)).toBe(false);
    expect(shouldShowSetupNag({ dismissedForever: true, snoozedUntilMs: null }, true, NOW)).toBe(false);
  });

  it("shows when never dismissed", () => {
    expect(shouldShowSetupNag(null, false, NOW)).toBe(true);
  });

  it("never shows again after a permanent dismissal", () => {
    const state: SetupNagState = { dismissedForever: true, snoozedUntilMs: null };
    expect(shouldShowSetupNag(state, false, NOW)).toBe(false);
    // …not even far in the future, and not if setup later regresses.
    expect(shouldShowSetupNag(state, false, NOW + SETUP_NAG_SNOOZE_MS * 100)).toBe(false);
  });

  it("stays hidden until the snooze expires, and returns AT the boundary", () => {
    const until = NOW + SETUP_NAG_SNOOZE_MS;
    expect(shouldShowSetupNag(snoozed(until), false, until - 1)).toBe(false);
    expect(shouldShowSetupNag(snoozed(until), false, until)).toBe(true); // inclusive
    expect(shouldShowSetupNag(snoozed(until), false, until + 1)).toBe(true);
  });

  it("treats a missing snooze timestamp as expired", () => {
    expect(shouldShowSetupNag({ dismissedForever: false, snoozedUntilMs: null }, false, NOW)).toBe(true);
  });
});

describe("setupCompletion — only applicable steps count", () => {
  const step = (id: string, applicable: boolean, complete: boolean): SetupStep => ({
    id,
    label: id,
    applicable,
    complete,
  });

  it("excludes inapplicable steps from BOTH numerator and denominator", () => {
    const r = setupCompletion([step("a", true, true), step("b", false, false)]);
    expect(r).toEqual({ completed: 1, total: 1, percent: 100, remaining: [] });
  });

  it("a zero denominator is 100 percent (nothing applies = set up)", () => {
    const r = setupCompletion([step("a", false, false)]);
    expect(r.total).toBe(0);
    expect(r.percent).toBe(100);
  });

  it("reports the remaining labels", () => {
    const r = setupCompletion([step("a", true, false), step("b", true, true)]);
    expect(r).toMatchObject({ completed: 1, total: 2, percent: 50, remaining: ["a"] });
  });

  it("handles an empty registry", () => {
    expect(setupCompletion([])).toEqual({ completed: 0, total: 0, percent: 100, remaining: [] });
  });
});

describe("deriveSetupSteps — the .mono name step", () => {
  const base = {
    steleEnabled: true,
    registeredNames: [] as string[],
    reverseName: null as string | null,
    reverseUnresolved: false,
  };

  it("is inapplicable while Stele is off (its surface is unreachable)", () => {
    const steps = deriveSetupSteps({ ...base, steleEnabled: false });
    expect(steps[0]!.applicable).toBe(false);
    // …so the chip's denominator is zero and it hides.
    expect(setupCompletion(steps).percent).toBe(100);
  });

  it("is incomplete with Stele on and no name anywhere", () => {
    const steps = deriveSetupSteps(base);
    expect(steps[0]).toMatchObject({ applicable: true, complete: false, label: ".mono name" });
  });

  it("completes on a locally recorded registration", () => {
    expect(deriveSetupSteps({ ...base, registeredNames: ["alice.mono"] })[0]!.complete).toBe(true);
  });

  it("completes on a resolved reverse name", () => {
    expect(deriveSetupSteps({ ...base, reverseName: "alice.mono" })[0]!.complete).toBe(true);
  });

  it("BIASED TO TRUE: an unreadable reverse read completes it (never nag on unknown)", () => {
    expect(deriveSetupSteps({ ...base, reverseUnresolved: true })[0]!.complete).toBe(true);
  });

  it("an empty reverse name does not count as a name", () => {
    expect(deriveSetupSteps({ ...base, reverseName: "   " })[0]!.complete).toBe(false);
  });
});

describe("nag storage — per-wallet scope", () => {
  it("a snooze applies to one wallet only", () => {
    snoozeSetupNag(A, NOW);
    expect(readSetupNagState(A)).toEqual({
      dismissedForever: false,
      snoozedUntilMs: NOW + SETUP_NAG_SNOOZE_MS,
    });
    expect(readSetupNagState(B)).toBeNull();
  });

  it("a permanent dismissal applies to one wallet only", () => {
    dismissSetupNagForever(A);
    expect(readSetupNagState(A)).toEqual({ dismissedForever: true, snoozedUntilMs: null });
    expect(readSetupNagState(B)).toBeNull();
    // …so a newly added wallet still sees the chip.
    expect(shouldShowSetupNag(readSetupNagState(B), false, NOW)).toBe(true);
  });

  it("a later dismissal replaces the earlier state for that wallet", () => {
    snoozeSetupNag(A, NOW);
    dismissSetupNagForever(A);
    expect(readSetupNagState(A)?.dismissedForever).toBe(true);
  });

  it("writing one wallet preserves the other's state", () => {
    snoozeSetupNag(A, NOW);
    dismissSetupNagForever(B);
    expect(readSetupNagState(A)?.snoozedUntilMs).toBe(NOW + SETUP_NAG_SNOOZE_MS);
    expect(readSetupNagState(B)?.dismissedForever).toBe(true);
  });
});

describe("nag storage — tolerance", () => {
  it("corrupt JSON defaults to show, without throwing", () => {
    localStorage.setItem(SETUP_NAG_STORAGE_KEY, "{not json");
    expect(readSetupNagState(A)).toBeNull();
    expect(shouldShowSetupNag(readSetupNagState(A), false, NOW)).toBe(true);
  });

  it("a non-object payload defaults to show", () => {
    localStorage.setItem(SETUP_NAG_STORAGE_KEY, JSON.stringify(["nope"]));
    expect(readSetupNagState(A)).toBeNull();
  });

  it("a malformed entry is dropped, leaving siblings intact", () => {
    localStorage.setItem(
      SETUP_NAG_STORAGE_KEY,
      JSON.stringify({ [A]: "garbage", [B]: { dismissedForever: true } }),
    );
    expect(readSetupNagState(A)).toBeNull();
    expect(readSetupNagState(B)?.dismissedForever).toBe(true);
  });

  it("a non-finite snooze timestamp reads as absent (→ show)", () => {
    localStorage.setItem(
      SETUP_NAG_STORAGE_KEY,
      JSON.stringify({ [A]: { dismissedForever: false, snoozedUntilMs: "soon" } }),
    );
    expect(readSetupNagState(A)).toEqual({ dismissedForever: false, snoozedUntilMs: null });
    expect(shouldShowSetupNag(readSetupNagState(A), false, NOW)).toBe(true);
  });
});
