import { describe, expect, it } from "vitest";
import { txTypeLabelForActivity, txTypeLabelForOpKind } from "../tx-type-label";

describe("txTypeLabelForOpKind", () => {
  it("maps every operation kind to a neutral type-noun", () => {
    expect(txTypeLabelForOpKind("send")).toBe("Outgoing transfer");
    expect(txTypeLabelForOpKind("receive")).toBe("Incoming transfer");
    expect(txTypeLabelForOpKind("delegate")).toBe("Delegate");
    expect(txTypeLabelForOpKind("undelegate")).toBe("Undelegate");
    expect(txTypeLabelForOpKind("redelegate")).toBe("Redelegate");
    expect(txTypeLabelForOpKind("claim")).toBe("Claim rewards");
    expect(txTypeLabelForOpKind("emergency-key")).toBe("Backup key");
    expect(txTypeLabelForOpKind("agent-policy")).toBe("Agent policy");
    expect(txTypeLabelForOpKind("contract_call")).toBe("Contract call");
  });
});

describe("txTypeLabelForActivity", () => {
  it("recognises the delegation families before generic transfers", () => {
    expect(txTypeLabelForActivity({ kind: "delegate" })).toBe("Delegate");
    expect(txTypeLabelForActivity({ kind: "undelegate" })).toBe("Undelegate");
    expect(txTypeLabelForActivity({ kind: "redelegate" })).toBe("Redelegate");
    expect(txTypeLabelForActivity({ kind: "reward", subKind: null })).toBe(
      "Claim rewards",
    );
  });

  it("still classifies the indexer's legacy 'stake' kind (operand kept, label renamed)", () => {
    // The indexer `kind` is a free string that may still emit legacy "stake"
    // spellings; the match operand is preserved so the row classifies — only
    // the returned label moved to the delegate vocabulary.
    expect(txTypeLabelForActivity({ kind: "stake" })).toBe("Delegate");
    expect(txTypeLabelForActivity({ kind: "delegated" })).toBe("Delegate");
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
