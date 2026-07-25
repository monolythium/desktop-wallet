// The inert delegation: a weight the chain ACCEPTS that does nothing.
//
// The chain credits a whole-LYTH counter, so a weight whose effective value
// floors to zero earns nothing and casts no vote — while still costing a fee.
// Every cap check passes it, because it is well within every cap. This is the
// one guard in the flow about whether the delegation can do what was asked, not
// whether it is allowed.
//
// The fail direction matches the cap re-read, not the destination check: when
// the balance cannot be read the test CANNOT RUN, and a guard that cannot
// evaluate its own condition must not refuse on suspicion.

import { describe, expect, it } from "vitest";
import {
  inertDelegationMessage,
  isInertDelegation,
  minNonInertBps,
} from "../delegation-derive";

const ONE_LYTH = 10n ** 18n;
const lythoshi = (whole: bigint) => (whole * ONE_LYTH).toString();

describe("isInertDelegation", () => {
  it("is inert when the effective weight floors to zero whole LYTH", () => {
    // 2 LYTH at 49.99% → 0.9998 LYTH → floors to 0.
    expect(isInertDelegation(lythoshi(2n), 4999)).toBe(true);
    // 0.4 LYTH at 50% → 0.2 → floors to 0.
    expect(isInertDelegation((4n * ONE_LYTH) / 10n + "", 5000)).toBe(true);
  });

  it("is not inert when at least one whole LYTH is credited", () => {
    expect(isInertDelegation(lythoshi(2n), 5000)).toBe(false); // exactly 1
    expect(isInertDelegation(lythoshi(1000n), 1000)).toBe(false); // 100
  });

  describe("cannot-test cases never report inert", () => {
    it("does not report inert when the balance is unknown", () => {
      // A6: absent balance yields null from the arithmetic — null means CANNOT
      // TEST, not inert. Conflating them turns a read failure into a refusal.
      expect(isInertDelegation(null, 4999)).toBe(false);
      expect(isInertDelegation(undefined, 4999)).toBe(false);
      expect(isInertDelegation("", 4999)).toBe(false);
      expect(isInertDelegation("not-a-number", 4999)).toBe(false);
    });

    it("does not report inert at a zero balance", () => {
      // There is nothing to round down; the zero-weight guard covers this case.
      expect(isInertDelegation("0", 5000)).toBe(false);
    });

    it("does not report inert for a non-positive or malformed weight", () => {
      expect(isInertDelegation(lythoshi(2n), 0)).toBe(false);
      expect(isInertDelegation(lythoshi(2n), -5)).toBe(false);
      expect(isInertDelegation(lythoshi(2n), 1.5)).toBe(false);
    });
  });
});

describe("minNonInertBps", () => {
  it("gives the smallest weight that credits one whole LYTH", () => {
    // 2 LYTH → need 50% → 5000 bps.
    expect(minNonInertBps(lythoshi(2n))).toBe(5000);
    // 10000 LYTH → need 0.01% → 1 bps.
    expect(minNonInertBps(lythoshi(10_000n))).toBe(1);
  });

  it("rounds UP — the floor of the quoted weight must still reach one LYTH", () => {
    // 3 LYTH → 10000/3 = 3333.33 → 3334, not 3333.
    expect(minNonInertBps(lythoshi(3n))).toBe(3334);
    const min = minNonInertBps(lythoshi(3n))!;
    expect(isInertDelegation(lythoshi(3n), min)).toBe(false);
    expect(isInertDelegation(lythoshi(3n), min - 1)).toBe(true);
  });

  it("is null below one whole LYTH — no weight up to 100% reaches one", () => {
    expect(minNonInertBps((ONE_LYTH / 2n).toString())).toBeNull();
  });

  it("never clamps an out-of-range minimum into a usable-looking one", () => {
    // A5: a minimum above 100% is reported as absent, not shrunk to 10000.
    expect(minNonInertBps((ONE_LYTH / 100n).toString())).toBeNull();
  });

  it("is null when the balance is unknown or zero", () => {
    expect(minNonInertBps(null)).toBeNull();
    expect(minNonInertBps("0")).toBeNull();
    expect(minNonInertBps("bad")).toBeNull();
  });
});

describe("inertDelegationMessage", () => {
  it("names the minimum weight in the unit the user actually types", () => {
    const m = inertDelegationMessage(lythoshi(2n));
    expect(m).toContain("5000");
    expect(m).toContain("bps");
  });

  it("says the weight rounds to nothing, not merely that it is small", () => {
    expect(inertDelegationMessage(lythoshi(2n))).toContain("0 LYTH");
  });

  it("says so plainly when no weight can reach one whole LYTH", () => {
    const m = inertDelegationMessage((ONE_LYTH / 2n).toString());
    expect(m).toContain("balance");
    expect(m).not.toContain("NaN");
    expect(m).not.toContain("null");
  });

  it("carries no word the drawer's error classifier would read as a chain revert", () => {
    // Same hazard Phase 2 pinned: a message containing "revert" has its whole
    // body replaced with a generic chain-revert sentence.
    for (const b of [lythoshi(2n), (ONE_LYTH / 2n).toString()]) {
      expect(inertDelegationMessage(b).toLowerCase()).not.toContain("revert");
    }
  });
});

// The contradiction this closes: at a low balance the smallest non-inert weight
// can exceed the per-cluster cap. Quoting it would send the user to a weight the
// cap forbids, and quoting nothing would leave "too small" unexplained. Say
// plainly that no allowed weight works.
describe("inertDelegationMessage — when the minimum exceeds the cap", () => {
  const ONE = 10n ** 18n;

  it("does not offer a cap-refused minimum as something to do", () => {
    // 1.5 LYTH → minimum 6667 bps, above a 5000 cap. The number may appear as
    // the REASON nothing works — that explains the arithmetic — but it must not
    // be phrased as advice, because following it hits the cap.
    const balance = ((3n * ONE) / 2n).toString();
    expect(minNonInertBps(balance)).toBe(6667);
    const m = inertDelegationMessage(balance, 5000);
    expect(m).not.toContain("Use at least");
    expect(m).toContain("no allowed weight works");
  });

  it("says no allowed weight can credit a whole LYTH", () => {
    const balance = ((3n * ONE) / 2n).toString();
    const m = inertDelegationMessage(balance, 5000);
    expect(m.toLowerCase()).toContain("cap");
  });

  it("still quotes the minimum when it fits inside the cap", () => {
    // 3 LYTH → 3334 bps, comfortably under 5000.
    expect(inertDelegationMessage(lythoshi(3n), 5000)).toContain("3334");
  });

  it("quotes the minimum when no cap is supplied", () => {
    expect(inertDelegationMessage(lythoshi(3n))).toContain("3334");
  });
});
