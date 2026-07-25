// What the user sees before pressing anything.
//
// The forms used to take integer basis points while every cap beside them was
// stated in percent, so a user who read "50%" and typed 50 signed 0.50%. The
// fields now take a percent, which removes that trap at the source — but the
// echo still earns its place: it shows the NORMALISED reading of what was typed
// (a typed `0.5` echoes `0.50%`, so a mis-parse is visible while it is still
// being typed) and it states the LYTH the weight would actually credit, which
// needs the live balance and so cannot come from any label.
//
// Neither helper enforces anything. Both describe conditions the review handlers
// already evaluate; they only move WHEN the user learns them.
//
// Every literal below is a PERCENT. The bps figures they map to are named in
// comments where the arithmetic matters.

import { describe, expect, it } from "vitest";
import { weightActionGate, weightEchoLine } from "../delegation-input";

const ONE = 10n ** 18n;
const lythoshi = (whole: bigint) => (whole * ONE).toString();

describe("weightEchoLine", () => {
  it("normalises the typed percent to two decimal places", () => {
    expect(weightEchoLine("10", null)).toContain("10.00%");
    expect(weightEchoLine("0.5", null)).toContain("0.50%");
  });

  it("distinguishes 0.5% from 50% — the pair the old bps field conflated", () => {
    expect(weightEchoLine("0.5", null)).toContain("0.50%");
    expect(weightEchoLine("50", null)).toContain("50.00%");
  });

  it("states a percent rather than a wire unit the user did not type", () => {
    const line = weightEchoLine("10", null);
    expect(line).toContain("10.00%");
    expect(line).not.toContain("bps");
  });

  it("adds the chain-exact credit when the balance is known", () => {
    // 1000 LYTH at 10% (1000 bps) → 100 LYTH credited.
    expect(weightEchoLine("10", lythoshi(1000n))).toContain("100 LYTH");
  });

  it("shows a zero credit rather than hiding it — the inert case, before Review", () => {
    // 2 LYTH at 49.99% (4999 bps) → 0.9998 → floors to 0. The user should see
    // this BEFORE pressing Review, not be refused after.
    expect(weightEchoLine("49.99", lythoshi(2n))).toContain("0 LYTH");
  });

  describe("honest absence — it never fabricates", () => {
    it("omits the credit entirely when the balance is unreadable", () => {
      // A6: null means unknown, and unknown must not render as zero.
      for (const b of [null, undefined, "", "not-a-number"]) {
        const line = weightEchoLine("10", b);
        expect(line).toContain("10.00%");
        expect(line).not.toContain("LYTH");
      }
    });

    it("says nothing at all when nothing readable was typed", () => {
      // "12.999" is the new member: a third decimal is not representable in
      // whole bps, so it is unreadable rather than rounded.
      for (const raw of ["", "   ", "abc", "1e3", "12.999", "0"]) {
        expect(weightEchoLine(raw, lythoshi(1000n))).toBeNull();
      }
    });
  });

  it("echoes an over-maximum value as typed rather than clamping it", () => {
    // A5: the echo shows what was typed; the refusal explains. Silently
    // rendering 100.00% would hide the mistake it exists to reveal.
    expect(weightEchoLine("500", null)).toContain("500.00%");
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    expect(weightEchoLine("10", lythoshi(1000n))?.toLowerCase()).not.toContain("revert");
  });
});

describe("weightActionGate", () => {
  const BIG = lythoshi(1000n);

  it("allows a weight that is readable, in range and not inert", () => {
    expect(weightActionGate({ raw: "10", maxBps: 10000, balanceLythoshi: BIG })).toEqual({
      ok: true,
    });
  });

  describe("definite conditions gate, and name the remedy", () => {
    it("gates an empty or unreadable field", () => {
      // "0.005" joins the list: below one bps, so not representable at all.
      for (const raw of ["", "  ", "abc", "1e3", "0.005"]) {
        const g = weightActionGate({ raw, maxBps: 10000, balanceLythoshi: BIG });
        expect(g.ok).toBe(false);
        expect(g.ok === false && g.label).toBe("Enter a weight");
      }
    });

    it("gates a weight above the maximum", () => {
      // 100.01% → 10001 bps, one past the chain's MAX_TOTAL_WEIGHT_BPS.
      const g = weightActionGate({ raw: "100.01", maxBps: 10000, balanceLythoshi: BIG });
      expect(g.ok === false && g.label).toBe("Reduce the weight");
    });

    it("gates a redelegate above the source weight", () => {
      // 30% asked against a 20% source row.
      const g = weightActionGate({ raw: "30", maxBps: 2000, balanceLythoshi: BIG });
      expect(g.ok === false && g.label).toBe("Reduce the weight");
    });

    it("gates a weight that would credit nothing", () => {
      const g = weightActionGate({ raw: "49.99", maxBps: 10000, balanceLythoshi: lythoshi(2n) });
      expect(g.ok === false && g.label).toBe("Too small to credit");
    });

    it("gates a definite cap violation", () => {
      const g = weightActionGate({
        raw: "10",
        maxBps: 10000,
        balanceLythoshi: BIG,
        capViolated: true,
      });
      expect(g.ok === false && g.label).toBe("Reduce to the cap");
    });
  });

  describe("doubt never gates — the ledger's rule on a new surface", () => {
    it("does not gate on an unreadable balance", () => {
      // The inert test cannot run, so it must not disable the action. The
      // review handler still refuses if it turns out to be wrong.
      expect(
        weightActionGate({ raw: "10", maxBps: 10000, balanceLythoshi: null }),
      ).toEqual({ ok: true });
    });

    it("does not gate on a cap whose read did not resolve", () => {
      // capViolated is only ever true when the delegation read resolved; absent
      // means unknown, and unknown leaves the button enabled.
      expect(
        weightActionGate({ raw: "10", maxBps: 10000, balanceLythoshi: BIG }),
      ).toEqual({ ok: true });
      expect(
        weightActionGate({
          raw: "10",
          maxBps: 10000,
          balanceLythoshi: BIG,
          capViolated: false,
        }),
      ).toEqual({ ok: true });
    });
  });

  it("reports the most fundamental problem first", () => {
    // An unreadable field is not a cap problem, whatever the cap says.
    const g = weightActionGate({
      raw: "",
      maxBps: 10000,
      balanceLythoshi: lythoshi(2n),
      capViolated: true,
    });
    expect(g.ok === false && g.label).toBe("Enter a weight");
  });

  it("uses no label the drawer's error classifier would read as a chain revert", () => {
    for (const raw of ["", "100.01", "49.99"]) {
      const g = weightActionGate({ raw, maxBps: 10000, balanceLythoshi: lythoshi(2n) });
      expect(g.ok === false && g.label.toLowerCase()).not.toContain("revert");
    }
  });
});
