// One limit, one number, one name.
//
// The per-wallet-cap revert copy hard-coded fifty percent while the form
// warnings beside it interpolated the binding cap. An aggregate cap of 3000 bps
// made the form say 30% and the revert say 50% in the same session — the
// specification documents that inconsistency, and this wallet reproduced it
// exactly. Reproducing it was the defect; the fix is to stop.
//
// The limit also went by two names in adjacent sentences. Settled on one.

import { describe, expect, it } from "vitest";
import {
  PER_WALLET_CAP_REVERT_MESSAGE,
  delegateCapWarning,
  perWalletCapRevertMessage,
  preflightDelegationVerdict,
} from "../delegation-caps";
import { classifyDelegationRevert } from "../delegation-reverts";

describe("perWalletCapRevertMessage", () => {
  it("states the cap it was given", () => {
    expect(perWalletCapRevertMessage(3000)).toContain("30%");
    expect(perWalletCapRevertMessage(5000)).toContain("50%");
  });

  it("defaults to the protocol floor when no live cap is known", () => {
    expect(PER_WALLET_CAP_REVERT_MESSAGE).toContain("50%");
    expect(perWalletCapRevertMessage()).toBe(PER_WALLET_CAP_REVERT_MESSAGE);
  });
});

describe("the revert copy agrees with the form warnings", () => {
  it("quotes the same number the form quotes, at a tightened cap", () => {
    // A 3000 bps aggregate cap tightens the binding cap to 30%.
    const form = delegateCapWarning({
      existingWeightBps: 3000,
      totalDelegatedBps: 3000,
      additionalBps: 100,
      aggregateCapBps: 3000,
    });
    const verdict = preflightDelegationVerdict({
      action: "delegate",
      dstExistingWeightBps: 3000,
      totalDelegatedBps: 3000,
      moveBps: 100,
      capBps: 3000,
    });
    expect(form.note).toContain("30%");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.message).toContain("30%");
    expect(verdict.ok === false && verdict.message).not.toContain("50%");
  });

  it("carries the live cap through the chain-revert classification too", () => {
    expect(classifyDelegationRevert("PerWalletCapExceeded", undefined, 3000)).toContain("30%");
  });

  it("falls back to the floor when the chain revert arrives with no cap in hand", () => {
    expect(classifyDelegationRevert("PerWalletCapExceeded")).toContain("50%");
  });
});

describe("one name for the limit", () => {
  const state = (existingWeightBps: number, additionalBps: number) =>
    delegateCapWarning({
      existingWeightBps,
      totalDelegatedBps: existingWeightBps,
      additionalBps,
      aggregateCapBps: null,
    });

  it("calls it a per-wallet cap in the resting note", () => {
    expect(state(0, 100).note).toContain("Per-wallet cap");
  });

  it("calls it the same thing when it is reached", () => {
    const w = state(5000, 100).warning!;
    expect(w).toContain("per-wallet cap");
    expect(w).not.toContain("per-cluster maximum");
  });

  it("calls it the same thing when it is exceeded", () => {
    const w = state(4000, 2000).warning!;
    expect(w).toContain("per-wallet cap");
  });

  it("uses that one name in the revert copy as well", () => {
    expect(PER_WALLET_CAP_REVERT_MESSAGE).toContain("per-wallet cap");
  });
});
