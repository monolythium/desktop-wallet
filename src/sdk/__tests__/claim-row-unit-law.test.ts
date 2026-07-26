// The indexed claim-row unit law.
//
// The indexer serves two shapes that look alike and mean different things: a
// delegation WEIGHT row carries a whole-LYTH counter, and a reward CLAIM row
// carries an 18-decimal lythoshi amount. Applying one row's unit to the other
// is a 10^18x display error in whichever direction it happens — a 0.5 LYTH
// claim shown as five hundred quadrillion, or the reverse.
//
// The wallet is safe from this by CONSTRUCTION rather than by care, and that is
// what these tests pin: the delegation bucket never reads `amount` at all (it
// renders `weightBps` as a percent), and every bucket that does read `amount`
// converts it from lythoshi through the one exact formatter. There is no branch
// that renders a raw `amount` integer as a human figure.
//
// Pinned because the property is currently implicit — it holds because of how
// the branches happen to be written, and a future edit could break it silently.

import { describe, expect, it } from "vitest";
import type { LiveAddressActivityRow } from "../live";
import { activityKindToTxKind, activityRowToTx } from "../activity-rows";

/** One LYTH, in raw lythoshi — the wire form the indexer serves amounts in. */
const ONE_LYTH = "1000000000000000000";
/** A half-LYTH claim: the figure a 10^18x mis-branch would blow up. */
const HALF_LYTH = "500000000000000000";

function row(partial: Partial<LiveAddressActivityRow>): LiveAddressActivityRow {
  return {
    blockHeight: 1000n,
    txIndex: 2,
    logIndex: 0,
    kind: "transfer",
    direction: "in",
    counterparty: "mono1cccccccccccccccccccccccccccccccccccccc",
    tokenId: null,
    amount: ONE_LYTH,
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: null,
    txHash: null,
    clusterName: null,
    ...partial,
  };
}

describe("a reward row's amount is lythoshi, converted exactly", () => {
  it("renders a half-LYTH claim as 0.5, not as its raw integer", () => {
    const tx = activityRowToTx(row({ kind: "reward", amount: HALF_LYTH }));
    expect(tx.amountText).toBe("0.5");
    expect(tx.unit).toBe("LYTH");
    // The blast radius this law exists to prevent.
    expect(tx.amountText).not.toBe(HALF_LYTH);
    expect(tx.amountText).not.toContain("500000000000000");
  });

  it("renders one LYTH as 1", () => {
    const tx = activityRowToTx(row({ kind: "reward", amount: ONE_LYTH }));
    expect(tx.amountText).toBe("1");
    expect(tx.unit).toBe("LYTH");
  });

  it("treats a claim carrying a WEIGHT field as a reward amount, not a weight", () => {
    // Defensive: even if a reward row also carried weightBps, the reward bucket
    // must not switch to the percent rendering.
    const tx = activityRowToTx(
      row({ kind: "reward", amount: HALF_LYTH, weightBps: 5000 }),
    );
    expect(tx.amountText).toBe("0.5");
    expect(tx.unit).toBe("LYTH");
    expect(tx.amountText).not.toContain("%");
  });
});

describe("a delegation row's amount is NEVER read", () => {
  it("renders the weight as a percent and ignores any amount present", () => {
    // A delegation row's counter is whole-LYTH; rendering it through the
    // lythoshi formatter would divide a real weight into near-zero, and
    // rendering it raw would overstate by 10^18. The bucket reads neither.
    const tx = activityRowToTx(
      row({ kind: "delegation", weightBps: 5000, amount: ONE_LYTH }),
    );
    expect(tx.amountText).toBe("50.00%");
    expect(tx.unit).toBe("weight");
    expect(tx.amountText).not.toContain("1000000000000000000");
    expect(tx.amountText).not.toBe("1");
  });

  it("shows an honest em-dash source (null) when the row carries no weight", () => {
    const tx = activityRowToTx(row({ kind: "delegation", weightBps: null }));
    expect(tx.amountText).toBeNull();
  });

  it("never renders a raw lythoshi integer for any delegation spelling", () => {
    for (const kind of ["delegation", "delegate", "undelegate", "stake", "redelegate"]) {
      const tx = activityRowToTx(row({ kind, weightBps: 2500, amount: ONE_LYTH }));
      expect(tx.unit).toBe("weight");
      expect(tx.amountText).toBe("25.00%");
    }
  });
});

describe("the bucket routing that makes the law hold", () => {
  it("routes reward spellings to the reward bucket AHEAD of delegation ones", () => {
    // `reward` is tested first, so a row naming both still resolves as a reward
    // and keeps the lythoshi treatment.
    expect(activityKindToTxKind("reward")).toBe("reward");
    expect(activityKindToTxKind("delegation reward")).toBe("reward");
    expect(activityKindToTxKind("staking-reward")).toBe("reward");
  });

  it("routes plain delegation spellings to the delegate bucket", () => {
    expect(activityKindToTxKind("delegation")).toBe("delegate");
    expect(activityKindToTxKind("undelegate")).toBe("delegate");
    expect(activityKindToTxKind("redelegate")).toBe("delegate");
  });

  it("a native transfer keeps the lythoshi treatment", () => {
    const tx = activityRowToTx(row({ kind: "transfer", amount: HALF_LYTH }));
    expect(tx.amountText).toBe("0.5");
    expect(tx.unit).toBe("LYTH");
  });
});
