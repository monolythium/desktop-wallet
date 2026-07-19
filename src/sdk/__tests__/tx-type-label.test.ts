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

  it("matches the reserved private-transfer operands (never synthesized)", () => {
    // The chain does not emit these today; the row renders honestly if it lands.
    expect(txTypeLabelForActivity({ kind: "crossing" })).toBe("Private transfer");
    expect(txTypeLabelForActivity({ kind: "cross_to_private" })).toBe(
      "Private transfer",
    );
    expect(
      txTypeLabelForActivity({ kind: "transfer", subKind: "crossing" }),
    ).toBe("Private transfer");
  });

  it("labels a direction-less TOKEN movement 'Token transfer', not an outgoing one", () => {
    // Asserting "Outgoing transfer" on a row the indexer gave no direction for
    // would claim the user sent funds they may well have received.
    expect(
      txTypeLabelForActivity({
        kind: "transfer",
        direction: null,
        tokenId: "0xdeadbeef",
      }),
    ).toBe("Token transfer");
  });

  it("keeps direction authoritative when the indexer DID supply one", () => {
    const base = { kind: "transfer", tokenId: "0xdeadbeef" };
    expect(txTypeLabelForActivity({ ...base, direction: "in" })).toBe(
      "Incoming transfer",
    );
    expect(txTypeLabelForActivity({ ...base, direction: "out" })).toBe(
      "Outgoing transfer",
    );
  });

  it("does NOT fire the token rule for a direction-less NATIVE row", () => {
    // Native LYTH is the null / zero-address token id — a direction-less native
    // row keeps the existing fallback rather than being relabelled.
    for (const tokenId of [null, undefined, "0x0", `0x${"00".repeat(32)}`]) {
      expect(
        txTypeLabelForActivity({ kind: "transfer", direction: null, tokenId }),
      ).toBe("Outgoing transfer");
    }
  });

  it("keeps the delegation families ahead of the token rule", () => {
    // A delegation row carrying a token id and no direction must still classify
    // as a delegation — family matching wins.
    expect(
      txTypeLabelForActivity({
        kind: "delegate",
        direction: null,
        tokenId: "0xdeadbeef",
      }),
    ).toBe("Delegate");
  });
});
