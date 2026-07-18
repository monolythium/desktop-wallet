// fee-display seam (T3): the single-LYTH rule, the conformance gate, and strict
// structured-fee validation with NO fallback.

import { describe, expect, it } from "vitest";
import { FEE_DISPLAY_CONFORMANCE_PREFIX, renderFeeDisplay } from "../fee-display";

const FORBIDDEN = /gas|gwei|wei|lythoshi|execution unit/i;

// A consistent native structured fee. Unit COUNTS are numbers (safe-integer
// checked by the SDK); prices/totals are decimal-like strings.
const validStructured = {
  total_lythoshi: "42000000000000",
  cycles_used: 21000,
  base_price_per_cycle_lythoshi: "1000000000",
  state_io_units: 0,
  state_io_price_per_unit_lythoshi: "0",
  priority_tip_lythoshi: "1000000000",
};

describe("renderFeeDisplay — legacy-compat", () => {
  it("renders exactly one single-LYTH string with no forbidden wording", () => {
    const r = renderFeeDisplay({ chargeLythoshi: 42_000_000_000_000n });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("legacy");
      expect(r.totalLythoshi).toBe(42_000_000_000_000n);
      expect(r.defaultText).not.toMatch(FORBIDDEN);
      expect(r.defaultText).toMatch(/LYTH/); // denominated, unit included
    }
  });
});

describe("renderFeeDisplay — structured fee (§11 strict, no fallback)", () => {
  it("a valid structured fee wins and carries the SDK detail texts", () => {
    const r = renderFeeDisplay({ chargeLythoshi: 999n, structuredFee: validStructured });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("structured");
      expect(r.totalLythoshi).toBe(42_000_000_000_000n); // total_lythoshi, NOT the 999 charge
      expect(r.detailTexts.length).toBeGreaterThan(0);
    }
  });

  it("an embedded gasPrice fails with 'unexpected field' and does NOT fall back", () => {
    const r = renderFeeDisplay({ chargeLythoshi: 42_000_000_000_000n, structuredFee: { ...validStructured, gasPrice: "5" } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failures.join("; ")).toMatch(/unexpected field 'gasPrice'/);
      // no fallback to the 42e12 charge — this is an error state, not a number
    }
  });

  it("a missing canonical field is malformed, not a fallback", () => {
    const { priority_tip_lythoshi: _omit, ...missing } = validStructured;
    const r = renderFeeDisplay({ chargeLythoshi: 42_000_000_000_000n, structuredFee: missing });
    expect(r.ok).toBe(false);
  });
});

describe("the conformance prefix constant", () => {
  it("is the exact ADR-0039 prefix string", () => {
    expect(FEE_DISPLAY_CONFORMANCE_PREFIX).toBe("fee display failed ADR-0039 conformance");
  });
});
