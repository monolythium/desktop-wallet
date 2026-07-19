// The delegation revert taxonomy.
//
// Two properties matter here and they pull in opposite directions. The six
// mapped codes must produce their exact copy, because that copy tells the user
// what to change. And everything else must pass the node's own words through
// untouched, because a friendly sentence that discards the underlying string
// leaves a real bug with no evidence — the user can only report "it failed".

import { describe, expect, it } from "vitest";
import {
  INACTIVE_CLUSTER_MESSAGE,
  NO_CLAIMABLE_REWARDS_MESSAGE,
  PER_WALLET_CAP_REVERT_MESSAGE,
  REVERT_INACTIVE_CLUSTER,
  REVERT_NO_CLAIMABLE_REWARDS,
  REVERT_PER_WALLET_CAP,
  REVERT_REWARD_ESCROW_UNDERFUNDED,
  REVERT_TOO_MANY_DELEGATIONS,
  REVERT_WALLET_TOTAL,
  REWARD_ESCROW_UNDERFUNDED_MESSAGE,
  TOO_MANY_DELEGATIONS_MESSAGE,
  WALLET_TOTAL_CAP_REVERT_MESSAGE,
  classifyDelegationRevert,
  isRetryableDelegationRevert,
} from "../delegation-reverts";

/** code, a reason needle the chain might emit, and the copy the user must see. */
const MAPPED: ReadonlyArray<[number, string, string]> = [
  [REVERT_PER_WALLET_CAP, "PerWalletCapExceeded", PER_WALLET_CAP_REVERT_MESSAGE],
  [REVERT_WALLET_TOTAL, "WalletTotalExceeded", WALLET_TOTAL_CAP_REVERT_MESSAGE],
  [REVERT_TOO_MANY_DELEGATIONS, "TooManyDelegations", TOO_MANY_DELEGATIONS_MESSAGE],
  [REVERT_INACTIVE_CLUSTER, "InactiveCluster", INACTIVE_CLUSTER_MESSAGE],
  [REVERT_NO_CLAIMABLE_REWARDS, "NoClaimableRewards", NO_CLAIMABLE_REWARDS_MESSAGE],
  [
    REVERT_REWARD_ESCROW_UNDERFUNDED,
    "RewardEscrowUnderfunded",
    REWARD_ESCROW_UNDERFUNDED_MESSAGE,
  ],
];

describe("the six mapped codes", () => {
  it("maps by numeric code alone", () => {
    for (const [code, , message] of MAPPED) {
      expect(classifyDelegationRevert("", code)).toBe(message);
    }
  });

  it("maps by reason needle alone", () => {
    for (const [, needle, message] of MAPPED) {
      expect(classifyDelegationRevert(needle)).toBe(message);
    }
  });

  it("maps a needle case-insensitively and inside a longer sentence", () => {
    for (const [, needle, message] of MAPPED) {
      const wrapped = `upstream unavailable: mempool: execution reverted: ${needle.toUpperCase()} (0x02..)`;
      expect(classifyDelegationRevert(wrapped)).toBe(message);
    }
  });

  it("agrees when reason and code are both supplied", () => {
    for (const [code, needle, message] of MAPPED) {
      expect(classifyDelegationRevert(needle, code)).toBe(message);
    }
  });

  it("matches the hex spelling for the two cap codes", () => {
    expect(classifyDelegationRevert("reverted 0x0213")).toBe(
      PER_WALLET_CAP_REVERT_MESSAGE,
    );
    expect(classifyDelegationRevert("reverted 0x0205")).toBe(
      WALLET_TOTAL_CAP_REVERT_MESSAGE,
    );
  });

  it("keeps the two cap codes distinct — neither needle steals the other", () => {
    expect(classifyDelegationRevert("PerWalletCapExceeded")).not.toBe(
      WALLET_TOTAL_CAP_REVERT_MESSAGE,
    );
    expect(classifyDelegationRevert("WalletTotalExceeded")).not.toBe(
      PER_WALLET_CAP_REVERT_MESSAGE,
    );
    expect(classifyDelegationRevert("", REVERT_PER_WALLET_CAP)).not.toBe(
      WALLET_TOTAL_CAP_REVERT_MESSAGE,
    );
  });

  it("matches the escrow code by its short needle too", () => {
    expect(classifyDelegationRevert("escrowUnderfunded")).toBe(
      REWARD_ESCROW_UNDERFUNDED_MESSAGE,
    );
  });

  it("every mapped message is distinct", () => {
    const messages = MAPPED.map(([, , m]) => m);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("unmapped reasons keep the node's own words", () => {
  // The caller surfaces the raw reason when this returns null. A generic
  // sentence here would destroy the only evidence a bug report can carry.
  const UNMAPPED = [
    "WeightOutOfRange", // 0x0204 — deliberately unmapped: our inputs prevent it
    "ZeroWeight", // 0x0203
    "DelegationCapExceeded", // 0x020A — aggregate cap ships disabled
    "UnexpectedValue", // 0x020E — unreachable, every call sends value = 0
    "Fatal", // carries no revert bytes; we cannot tell subtypes apart
    "upstream unavailable: mempool: some brand new thing",
    "",
  ];

  it("returns null rather than a generic sentence", () => {
    for (const reason of UNMAPPED) {
      expect(classifyDelegationRevert(reason)).toBeNull();
    }
  });

  it("returns null for unknown numeric codes", () => {
    for (const code of [0x0204, 0x0203, 0x020a, 0x020e, 0x0000, 0x9999]) {
      expect(classifyDelegationRevert("", code)).toBeNull();
    }
  });

  it("does not classify on the -32047 envelope alone", () => {
    // mono-core flattens admission failures into this; it says nothing about why.
    expect(
      classifyDelegationRevert("upstream unavailable: mempool: -32047"),
    ).toBeNull();
  });
});

describe("retryability", () => {
  it("is true ONLY for the escrow tripwire", () => {
    for (const [code, needle, ] of MAPPED) {
      const expected = code === REVERT_REWARD_ESCROW_UNDERFUNDED;
      expect(isRetryableDelegationRevert(needle)).toBe(expected);
      expect(isRetryableDelegationRevert("", code)).toBe(expected);
    }
  });

  it("is false for anything unmapped", () => {
    expect(isRetryableDelegationRevert("WeightOutOfRange")).toBe(false);
    expect(isRetryableDelegationRevert("")).toBe(false);
  });

  it("only the escrow message invites a retry in its wording", () => {
    // A cap or inactive-cluster message must not tell the user to try again —
    // the same action would fail identically.
    for (const [code, , message] of MAPPED) {
      if (code === REVERT_REWARD_ESCROW_UNDERFUNDED) {
        expect(message).toContain("try");
      } else {
        expect(message.toLowerCase()).not.toContain("try again");
      }
    }
  });
});

describe("one definition per code", () => {
  it("re-exports the cap messages rather than restating them", async () => {
    // Two copies of a user-facing string drift; the taxonomy owns the table but
    // the messages keep their single definition next to the preflight.
    const caps = await import("../delegation-caps");
    expect(PER_WALLET_CAP_REVERT_MESSAGE).toBe(caps.PER_WALLET_CAP_REVERT_MESSAGE);
    expect(WALLET_TOTAL_CAP_REVERT_MESSAGE).toBe(caps.WALLET_TOTAL_CAP_REVERT_MESSAGE);
  });
});
