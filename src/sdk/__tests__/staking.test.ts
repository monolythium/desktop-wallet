// Golden-vector + helper coverage for the staking seam.
//
// Pins the delegation-precompile calldata selectors (a wrong selector would be
// rejected on-chain — here it fails fast in CI) and the pure reward-formatting
// helpers. No live chain: the calldata builders + helpers are pure.

import { describe, expect, it } from "vitest";
import { DELEGATION_SELECTORS } from "@monolythium/core-sdk";
import type { PendingRewardsResponse } from "@monolythium/core-sdk";
import {
  DELEGATION_PRECOMPILE,
  buildClaimRewardsCalldata,
  buildCompleteRedemptionCalldata,
  buildDelegateCalldata,
  buildRedelegateCalldata,
  buildSetAutoCompoundCalldata,
  buildUndelegateCalldata,
  formatRewardLyth,
  hasClaimableRewards,
} from "../staking";

function selectorOf(calldata: string): string {
  return calldata.slice(0, 10);
}

describe("delegation precompile target", () => {
  it("pins the 0x…100a delegation precompile address", () => {
    expect(DELEGATION_PRECOMPILE).toBe(
      "0x000000000000000000000000000000000000100a",
    );
  });
});

describe("staking calldata selectors", () => {
  it("delegate uses the chain-canonical selector", () => {
    expect(selectorOf(buildDelegateCalldata(1, 1000))).toBe(DELEGATION_SELECTORS.delegate);
  });

  it("undelegate uses the chain-canonical selector", () => {
    expect(selectorOf(buildUndelegateCalldata(1))).toBe(DELEGATION_SELECTORS.undelegate);
  });

  it("redelegate uses the chain-canonical selector", () => {
    expect(selectorOf(buildRedelegateCalldata(1, 2, 1000))).toBe(
      DELEGATION_SELECTORS.redelegate,
    );
  });

  it("claim uses the chain-canonical selector", () => {
    expect(selectorOf(buildClaimRewardsCalldata())).toBe(DELEGATION_SELECTORS.claim);
  });

  it("setAutoCompound uses the chain-canonical selector", () => {
    expect(selectorOf(buildSetAutoCompoundCalldata(true))).toBe(
      DELEGATION_SELECTORS.setAutoCompound,
    );
    expect(selectorOf(buildSetAutoCompoundCalldata(false))).toBe(
      DELEGATION_SELECTORS.setAutoCompound,
    );
  });

  it("completeRedemption uses the chain-canonical selector", () => {
    expect(selectorOf(buildCompleteRedemptionCalldata(0))).toBe(
      DELEGATION_SELECTORS.completeRedemption,
    );
  });
});

describe("formatRewardLyth", () => {
  it("formats a hex lythoshi quantity as whole LYTH (1 LYTH = 1e8 lythoshi)", () => {
    // 1 LYTH = 100_000_000 lythoshi = 0x5f5e100
    expect(formatRewardLyth("0x5f5e100")).toBe("1");
  });

  it("collapses empty / nullish / malformed input to 0 (never throws)", () => {
    expect(formatRewardLyth(null)).toBe("0");
    expect(formatRewardLyth(undefined)).toBe("0");
    expect(formatRewardLyth("")).toBe("0");
    expect(formatRewardLyth("not-a-number")).toBe("0");
  });

  it("formats a zero quantity as 0", () => {
    expect(formatRewardLyth("0x0")).toBe("0");
  });
});

function rewards(total: string, autoCompound = false): PendingRewardsResponse {
  return {
    wallet: "mono1test",
    totalAmountLythoshi: total,
    settledPendingLythoshi: "0x0",
    unsettledAmountLythoshi: "0x0",
    autoCompound,
    rows: [],
    block: null,
  };
}

describe("hasClaimableRewards", () => {
  it("is true for a non-zero total", () => {
    expect(hasClaimableRewards(rewards("0x5f5e100"))).toBe(true);
  });

  it("is false for a zero total", () => {
    expect(hasClaimableRewards(rewards("0x0"))).toBe(false);
  });

  it("is false for a null response (pre-load)", () => {
    expect(hasClaimableRewards(null)).toBe(false);
  });

  it("is false for a malformed total (never throws)", () => {
    expect(hasClaimableRewards(rewards("garbage"))).toBe(false);
  });
});
