// A failure that has already been classified must not be classified again.
//
// THE DEFECT SIX PASSES PAID FOR. The drawer's rule table matches a bare
// "revert" substring, and "revert" is a substring of "reverted". So any message
// containing either word had its whole body replaced with the generic "the
// network reverted this transaction" sentence — including a delegation error the
// taxonomy had already turned into the node's own actionable reason. The
// taxonomy conformed at its layer and was undone one layer up.
//
// The tax was visible: every message added since needed its own bespoke
// assertion that it avoided the word. That is the fourth guard-failure mode this
// repository documents — those pins only cover the messages that exist. A future
// author writing a perfectly reasonable sentence containing "reverted" loses
// their body silently, and no per-message pin notices.
//
// These tests assert the PROPERTY the six pins were approximating.

import { describe, expect, it } from "vitest";
import {
  ClassifiedWalletError,
  classifySendError,
  extractSendError,
} from "../send-error";
import { withDelegationRevertCopy } from "../delegation-reverts";

const GENERIC = "The network reverted this transaction during execution";

describe("a classified failure survives the drawer intact", () => {
  it("keeps its own words even when they contain the word that used to eat them", () => {
    const mapped =
      "That cluster is no longer active — the chain reverted your delegation. Choose one from the active set.";
    const c = classifySendError(mapped, undefined, true);
    expect(c.body).toBe(mapped);
    expect(c.body).not.toContain(GENERIC);
  });

  it("proves the flag is what saves it — the same text is eaten without it", () => {
    // Without the marker this is exactly the old behaviour, which is why the
    // per-message pins existed.
    const mapped = "This cluster is at its cap and the chain reverted the delegation.";
    expect(classifySendError(mapped, undefined, false).body).toContain(GENERIC);
    expect(classifySendError(mapped, undefined, true).body).toBe(mapped);
  });

  it("covers any future message, not only today's six", () => {
    for (const mapped of [
      "Rewards are temporarily unfunded on-chain — reverted, try again shortly.",
      "Execution reverted at the precompile gate.",
      "A revert happened and here is what to do about it.",
    ]) {
      expect(classifySendError(mapped, undefined, true).body).toBe(mapped);
    }
  });

  it("does not invent a severity or a headline that contradicts the copy", () => {
    const c = classifySendError("Some mapped delegation reason.", undefined, true);
    expect(c.severity).toBe("err");
    expect(c.headline.length).toBeGreaterThan(0);
  });
});

describe("the send path is unaffected — blast radius", () => {
  it("still classifies a genuine unmapped revert on a send", () => {
    const c = classifySendError("execution reverted: out of gas");
    expect(c.kind).toBe("transaction-reverted");
    expect(c.body).toContain(GENERIC);
  });

  it("still classifies a bare 'reverted' from a node", () => {
    expect(classifySendError("the transaction reverted").kind).toBe("transaction-reverted");
  });

  it("leaves every other branch alone", () => {
    expect(classifySendError("insufficient balance for max execution-unit cost").kind).toBe(
      "insufficient-funds",
    );
    expect(classifySendError("user rejected the request").kind).toBe("user-rejected");
  });
});

describe("extractSendError marks a classified failure", () => {
  it("flags a ClassifiedWalletError anywhere in the cause chain", () => {
    const e = new ClassifiedWalletError("mapped reason", { cause: new Error("node said revert") });
    expect(extractSendError(e).classified).toBe(true);
  });

  it("does not flag an ordinary error", () => {
    expect(extractSendError(new Error("plain")).classified).toBeFalsy();
  });

  it("keeps the mapped message as the outermost one", () => {
    const e = new ClassifiedWalletError("mapped reason", { cause: new Error("inner") });
    expect(extractSendError(e).message).toBe("mapped reason");
  });

  it("still finds the node's numeric code through the chain", () => {
    const inner = Object.assign(new Error("inner"), { code: -32047 });
    const e = new ClassifiedWalletError("mapped reason", { cause: inner });
    expect(extractSendError(e).code).toBe(-32047);
  });
});

describe("the delegation taxonomy marks what it maps", () => {
  it("throws a classified error for a recognised revert", async () => {
    const err = await withDelegationRevertCopy(async () => {
      throw new Error("execution reverted: PerWalletCapExceeded");
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ClassifiedWalletError);
    expect(extractSendError(err).classified).toBe(true);
  });

  it("leaves an unmapped failure unmarked, so the rule table still gets it", async () => {
    // G1: an unrecognised reason keeps the node's own words AND stays eligible
    // for the generic branches — the taxonomy is not weakened.
    const err = await withDelegationRevertCopy(async () => {
      throw new Error("some unrecognised node failure");
    }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ClassifiedWalletError);
    expect(extractSendError(err).classified).toBeFalsy();
  });
});
