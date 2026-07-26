// The activity taxonomy and the direction table.
//
// This file IS the specification for two things the feed previously guessed at:
// WHICH operation a row is, and WHICH WAY the value moved. Both used to be
// decided at render time from a free field that defaulted to outgoing, so a row
// the chain gave no direction for still drew an outgoing arrow and a minus sign.
//
// Every case below states the RULE, not just the outcome, because the rule is
// what a future reader needs: direction is a property OF THE KIND, resolved once
// at classify time, and the renderer never compares addresses.

import { describe, expect, it } from "vitest";
import {
  activityDirectionOf,
  activityKindOf,
  DELEGATION_OPERANDS,
  type ActivityKind,
} from "../activity-kind";

/** The indexer row fields the classifier reads. */
function r(partial: Partial<Parameters<typeof activityKindOf>[0]> = {}) {
  return { kind: "transfer", subKind: null, direction: null, tokenId: null, ...partial };
}

describe("activityKindOf — the taxonomy", () => {
  it("splits a native transfer into send and receive by the indexer's direction", () => {
    // The direction is baked into the KIND here, once. Nothing downstream
    // re-derives it, and nothing compares the wallet's own address.
    expect(activityKindOf(r({ kind: "transfer", direction: "out" }))).toBe("tx_send");
    expect(activityKindOf(r({ kind: "transfer", direction: "in" }))).toBe("tx_receive");
  });

  it("classifies a non-native token movement as token_transfer, direction or not", () => {
    const token = { kind: "transfer", tokenId: "0xdeadbeef" };
    expect(activityKindOf(r({ ...token, direction: "out" }))).toBe("token_transfer");
    expect(activityKindOf(r({ ...token, direction: "in" }))).toBe("token_transfer");
    expect(activityKindOf(r({ ...token, direction: null }))).toBe("token_transfer");
  });

  it("treats every all-zero token id as native, at any length", () => {
    // The canonical sentinel is 0x + 64 zeros, but accepting any all-zero length
    // is deliberate defensiveness — a shorter zero id is still not a token.
    for (const tokenId of [null, "0x", "0x0", `0x${"00".repeat(32)}`]) {
      expect(activityKindOf(r({ kind: "transfer", direction: "out", tokenId }))).toBe(
        "tx_send",
      );
    }
  });

  it("separates the three delegation operations", () => {
    expect(activityKindOf(r({ kind: "delegation", subKind: "delegated" }))).toBe("delegate");
    expect(activityKindOf(r({ kind: "delegation", subKind: "undelegated" }))).toBe("undelegate");
    expect(activityKindOf(r({ kind: "delegation", subKind: "redelegated" }))).toBe("redelegate");
  });

  it("classifies a reward claim", () => {
    expect(activityKindOf(r({ kind: "delegation", subKind: "claimed" }))).toBe("claim");
    expect(activityKindOf(r({ kind: "reward" }))).toBe("claim");
  });

  it("puts a claim AHEAD of the delegation families", () => {
    // A claim aggregates across the whole stake and is reported against no real
    // target. Matching the delegation family first would bucket every claim as a
    // delegation and lose the reward reading entirely.
    expect(activityKindOf(r({ kind: "delegation", subKind: "claimed" }))).toBe("claim");
    expect(activityKindOf(r({ kind: "staking-reward" }))).toBe("claim");
  });

  it("returns unclassified rather than guessing", () => {
    // The honest path. A row the wallet cannot place says so; it never picks a
    // kind just to have something to render.
    expect(activityKindOf(r({ kind: "something-the-chain-added" }))).toBe("unclassified");
    expect(activityKindOf(r({ kind: "" }))).toBe("unclassified");
  });

  it("leaves a direction-less NATIVE transfer unclassified", () => {
    // It is neither a send nor a receive, and inventing one would assert a fund
    // movement the chain never reported.
    expect(activityKindOf(r({ kind: "transfer", direction: null, tokenId: null }))).toBe(
      "unclassified",
    );
  });

  it("uses the chain's OWN direction for an unrecognised kind, rather than dropping it", () => {
    // The deliberate line between honesty and over-strictness. Defaulting an
    // ABSENT direction to outgoing was the fabrication, and it is gone. But when
    // the indexer explicitly states a direction on a kind we do not recognise,
    // that statement is the chain's own data — using it is reporting, not
    // guessing, and refusing it would blank out legitimate rows whose kind
    // string we simply did not anticipate.
    expect(activityKindOf(r({ kind: "some-future-kind", direction: "out" }))).toBe("tx_send");
    expect(activityKindOf(r({ kind: "some-future-kind", direction: "in" }))).toBe("tx_receive");
    expect(activityKindOf(r({ kind: "some-future-kind", direction: null }))).toBe("unclassified");
  });

  it("never throws on any indexer string", () => {
    for (const kind of ["", "legacy-op", "stake-v1", "DELEGATE", "🤝"]) {
      expect(() => activityKindOf(r({ kind }))).not.toThrow();
    }
  });
});

describe("G-CRITICAL — the wire sub-label is FREE TEXT, matched by substring", () => {
  // The behaviour specification transcribes an EXACT-match operand table
  // ("delegated" / "undelegated" / "redelegated") with a drop-anything-else
  // rule. That is wrong for this chain: the installed SDK declares the field as
  // a "kind-specific sub-label such as delegated, unstake, or stake" — free
  // text, typed `string`, not a union. Applying the exact table would silently
  // drop every row carrying one of the other spellings.
  //
  // These assertions exist so a future session reading that specification cannot
  // quietly "correct" the substring matching back to exact matching.

  it("classifies the sub-labels the exact table would have DROPPED", () => {
    expect(activityKindOf(r({ kind: "delegation", subKind: "unstake" }))).toBe("undelegate");
    expect(activityKindOf(r({ kind: "delegation", subKind: "stake" }))).toBe("delegate");
  });

  it("classifies the legacy spellings on the outer kind too", () => {
    expect(activityKindOf(r({ kind: "stake" }))).toBe("delegate");
    expect(activityKindOf(r({ kind: "undeleg" }))).toBe("undelegate");
  });

  it("keeps redelegate ahead of delegate — 'redelegated' contains 'delegated'", () => {
    // Ordering is load-bearing: a substring matcher that tested "deleg" first
    // would bucket every redelegation as a plain delegation.
    expect(activityKindOf(r({ kind: "delegation", subKind: "redelegated" }))).toBe("redelegate");
    expect(activityKindOf(r({ kind: "redelegate" }))).toBe("redelegate");
  });

  it("keeps undelegate ahead of delegate — 'undelegated' contains 'delegated'", () => {
    expect(activityKindOf(r({ kind: "delegation", subKind: "undelegated" }))).toBe("undelegate");
  });

  it("exports the operands as ONE shared set so the label path cannot drift", () => {
    // The kind classifier and the type-label classifier must agree on what
    // counts as a delegation family. Sharing the operands is what makes that
    // structural rather than a promise in a comment.
    expect(DELEGATION_OPERANDS.redelegate.length).toBeGreaterThan(0);
    expect(DELEGATION_OPERANDS.undelegate).toContain("undeleg");
    expect(DELEGATION_OPERANDS.delegate).toContain("stake");
  });
});

describe("activityDirectionOf — the direction table", () => {
  // One row per kind. The RULE is in the comment; the expectation is the outcome.
  const table: Array<{
    kind: ActivityKind;
    raw: string | null;
    expected: "in" | "out" | "none";
    rule: string;
  }> = [
    { kind: "tx_send", raw: "out", expected: "out", rule: "the kind itself — resolved at classify time from direction=out" },
    { kind: "tx_receive", raw: "in", expected: "in", rule: "the kind itself — from direction=in" },
    { kind: "token_transfer", raw: "out", expected: "out", rule: "the row's own direction field, re-read" },
    { kind: "token_transfer", raw: "in", expected: "in", rule: "the row's own direction field, re-read" },
    { kind: "token_transfer", raw: null, expected: "none", rule: "no direction reported ⇒ none claimed" },
    { kind: "delegate", raw: null, expected: "out", rule: "kind alone — value leaves the spendable balance" },
    { kind: "undelegate", raw: null, expected: "out", rule: "kind alone — the row is the zero-value instruction; the return arrives as its own incoming row" },
    { kind: "redelegate", raw: null, expected: "out", rule: "kind alone — weight moves between clusters, never through the wallet" },
    { kind: "claim", raw: null, expected: "in", rule: "kind alone — reward moves TO the wallet" },
    { kind: "unclassified", raw: "out", expected: "none", rule: "never claim a direction for a row we could not classify, even if the field is set" },
  ];

  for (const { kind, raw, expected, rule } of table) {
    it(`${kind} (raw=${String(raw)}) → ${expected}: ${rule}`, () => {
      expect(activityDirectionOf(kind, raw)).toBe(expected);
    });
  }

  it("an unclassified row NEVER inherits the raw field", () => {
    // The old behaviour defaulted an absent direction to "out". The new rule is
    // stronger: an unclassified row claims nothing even when the chain DID send
    // a direction, because we do not know what operation that direction describes.
    for (const raw of ["in", "out", null, "sideways"]) {
      expect(activityDirectionOf("unclassified", raw)).toBe("none");
    }
  });

  it("delegation directions do not depend on the raw field at all", () => {
    for (const raw of ["in", "out", null]) {
      expect(activityDirectionOf("delegate", raw)).toBe("out");
      expect(activityDirectionOf("undelegate", raw)).toBe("out");
      expect(activityDirectionOf("redelegate", raw)).toBe("out");
      expect(activityDirectionOf("claim", raw)).toBe("in");
    }
  });
});

describe("self-send — two legs, two rows", () => {
  it("classifies the two legs of one self-send as distinct kinds", () => {
    // A self-transfer emits two entries at the SAME anchor (native transfers all
    // carry the logIndex sentinel), one in and one out. Because direction is
    // baked into the kind, the legs classify apart and both survive — the feed
    // shows the outgoing leg and the incoming leg separately, which is the truth.
    const out = activityKindOf(r({ kind: "transfer", direction: "out" }));
    const inn = activityKindOf(r({ kind: "transfer", direction: "in" }));
    expect(out).toBe("tx_send");
    expect(inn).toBe("tx_receive");
    expect(out).not.toBe(inn);
  });
});
