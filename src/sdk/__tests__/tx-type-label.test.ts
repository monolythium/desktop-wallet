import { describe, expect, it } from "vitest";
import { txTypeLabelForActivity, txTypeLabelForOpKind } from "../tx-type-label";

describe("txTypeLabelForOpKind", () => {
  it("maps every operation kind to a neutral type-noun", () => {
    expect(txTypeLabelForOpKind("send")).toBe("Outgoing transfer");
    expect(txTypeLabelForOpKind("delegate")).toBe("Stake");
    expect(txTypeLabelForOpKind("undelegate")).toBe("Unstake");
    expect(txTypeLabelForOpKind("redelegate")).toBe("Restake");
    expect(txTypeLabelForOpKind("claim")).toBe("Claim rewards");
    expect(txTypeLabelForOpKind("emergency-key")).toBe("Backup key");
    expect(txTypeLabelForOpKind("agent-policy")).toBe("Agent policy");
    expect(txTypeLabelForOpKind("contract_call")).toBe("Contract call");
  });
});

describe("txTypeLabelForActivity", () => {
  it("recognises the staking families before generic transfers", () => {
    expect(txTypeLabelForActivity({ kind: "delegate" })).toBe("Stake");
    expect(txTypeLabelForActivity({ kind: "undelegate" })).toBe("Unstake");
    expect(txTypeLabelForActivity({ kind: "redelegate" })).toBe("Restake");
    expect(txTypeLabelForActivity({ kind: "reward", subKind: null })).toBe(
      "Claim rewards",
    );
  });

  it("labels transfers by direction", () => {
    expect(txTypeLabelForActivity({ kind: "transfer", direction: "in" })).toBe(
      "Incoming transfer",
    );
    expect(txTypeLabelForActivity({ kind: "transfer", direction: "out" })).toBe(
      "Outgoing transfer",
    );
  });

  it("never returns a bare 'Transaction' for an unknown kind", () => {
    const label = txTypeLabelForActivity({ kind: "something-new", direction: null });
    expect(label).toBe("Outgoing transfer");
    expect(label).not.toBe("Transaction");
  });
});
