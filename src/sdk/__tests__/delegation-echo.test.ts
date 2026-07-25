// What the user sees before pressing anything.
//
// The forms take integer basis points while every cap beside them is stated in
// percent, so a user who reads "50%" and types 50 signs 0.50% — a hundredfold
// understatement with nothing in the form body to reveal it. Renaming the field
// is necessary but not sufficient: someone who has learned to type 50 keeps
// typing it. The echo is what makes the label checkable, because it shows what
// the typed number actually means while it is being typed.
//
// Neither helper enforces anything. Both describe conditions the review handlers
// already evaluate; they only move WHEN the user learns them.

import { describe, expect, it } from "vitest";
import { weightActionGate, weightEchoLine } from "../delegation-input";

const ONE = 10n ** 18n;
const lythoshi = (whole: bigint) => (whole * ONE).toString();

describe("weightEchoLine", () => {
  it("says what the typed weight means as a percentage", () => {
    expect(weightEchoLine("1000", null)).toContain("10.00%");
    expect(weightEchoLine("50", null)).toContain("0.50%");
  });

  it("shows the hundredfold error the label alone cannot prevent", () => {
    // The whole point: someone aiming at 50% types 50 and sees 0.50%.
    expect(weightEchoLine("50", null)).toContain("0.50%");
    expect(weightEchoLine("5000", null)).toContain("50.00%");
  });

  it("names the unit that was typed, not only the percentage", () => {
    expect(weightEchoLine("1000", null)).toContain("1000 bps");
  });

  it("adds the chain-exact credit when the balance is known", () => {
    // 1000 LYTH at 1000 bps → 100 LYTH credited.
    expect(weightEchoLine("1000", lythoshi(1000n))).toContain("100 LYTH");
  });

  it("shows a zero credit rather than hiding it — the inert case, before Review", () => {
    // 2 LYTH at 4999 bps → 0.9998 → floors to 0. The user should see this
    // BEFORE pressing Review, not be refused after.
    expect(weightEchoLine("4999", lythoshi(2n))).toContain("0 LYTH");
  });

  describe("honest absence — it never fabricates", () => {
    it("omits the credit entirely when the balance is unreadable", () => {
      // A6: null means unknown, and unknown must not render as zero.
      for (const b of [null, undefined, "", "not-a-number"]) {
        const line = weightEchoLine("1000", b);
        expect(line).toContain("10.00%");
        expect(line).not.toContain("LYTH");
      }
    });

    it("says nothing at all when nothing readable was typed", () => {
      for (const raw of ["", "   ", "abc", "1e3", "12.9", "0"]) {
        expect(weightEchoLine(raw, lythoshi(1000n))).toBeNull();
      }
    });
  });

  it("echoes an over-maximum value as typed rather than clamping it", () => {
    // A5: the echo shows what was typed; the refusal explains. Silently
    // rendering 100.00% would hide the mistake it exists to reveal.
    expect(weightEchoLine("50000", null)).toContain("500.00%");
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    expect(weightEchoLine("1000", lythoshi(1000n))?.toLowerCase()).not.toContain("revert");
  });
});

describe("weightActionGate", () => {
  const BIG = lythoshi(1000n);

  it("allows a weight that is readable, in range and not inert", () => {
    expect(weightActionGate({ raw: "1000", maxBps: 10000, balanceLythoshi: BIG })).toEqual({
      ok: true,
    });
  });

  describe("definite conditions gate, and name the remedy", () => {
    it("gates an empty or unreadable field", () => {
      for (const raw of ["", "  ", "abc", "1e3"]) {
        const g = weightActionGate({ raw, maxBps: 10000, balanceLythoshi: BIG });
        expect(g.ok).toBe(false);
        expect(g.ok === false && g.label).toBe("Enter a weight");
      }
    });

    it("gates a weight above the maximum", () => {
      const g = weightActionGate({ raw: "10001", maxBps: 10000, balanceLythoshi: BIG });
      expect(g.ok === false && g.label).toBe("Reduce the weight");
    });

    it("gates a redelegate above the source weight", () => {
      const g = weightActionGate({ raw: "3000", maxBps: 2000, balanceLythoshi: BIG });
      expect(g.ok === false && g.label).toBe("Reduce the weight");
    });

    it("gates a weight that would credit nothing", () => {
      const g = weightActionGate({ raw: "4999", maxBps: 10000, balanceLythoshi: lythoshi(2n) });
      expect(g.ok === false && g.label).toBe("Too small to credit");
    });

    it("gates a definite cap violation", () => {
      const g = weightActionGate({
        raw: "1000",
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
        weightActionGate({ raw: "1000", maxBps: 10000, balanceLythoshi: null }),
      ).toEqual({ ok: true });
    });

    it("does not gate on a cap whose read did not resolve", () => {
      // capViolated is only ever true when the delegation read resolved; absent
      // means unknown, and unknown leaves the button enabled.
      expect(
        weightActionGate({ raw: "1000", maxBps: 10000, balanceLythoshi: BIG }),
      ).toEqual({ ok: true });
      expect(
        weightActionGate({
          raw: "1000",
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
    for (const raw of ["", "10001", "4999"]) {
      const g = weightActionGate({ raw, maxBps: 10000, balanceLythoshi: lythoshi(2n) });
      expect(g.ok === false && g.label.toLowerCase()).not.toContain("revert");
    }
  });
});
