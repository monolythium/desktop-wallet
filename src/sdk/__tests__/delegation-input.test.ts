// The anchored parse for fund-relevant delegation fields.
//
// These are not hypothetical inputs. Every string asserted as refused below was
// verified to be accepted by the previous `parseInt(raw, 10)` parse and silently
// reduced to a different number — on fields whose value becomes a signed
// delegation weight or a destination cluster id.

import { describe, expect, it } from "vitest";
import {
  allocationsEligibilityVerdict,
  parseExactNonNegativeInteger,
  resolveRedelegateDestination,
} from "../delegation-input";

describe("parseExactNonNegativeInteger", () => {
  describe("the verified hazards — refused, never truncated", () => {
    it("refuses exponent forms, which a number input accepts and parseInt read as 1", () => {
      // parseInt("1e1", 10) === 1 — a user aiming at cluster 10 reached cluster 1.
      expect(parseExactNonNegativeInteger("1e1")).toBeNull();
      // parseInt("1e3", 10) === 1 — 1000 bps (10%) entered, 1 bps (0.01%) signed.
      expect(parseExactNonNegativeInteger("1e3")).toBeNull();
      expect(parseExactNonNegativeInteger("1e5")).toBeNull();
      expect(parseExactNonNegativeInteger("1E3")).toBeNull();
    });

    it("refuses a decimal rather than truncating toward zero", () => {
      // parseInt("12.9", 10) === 12
      expect(parseExactNonNegativeInteger("12.9")).toBeNull();
      expect(parseExactNonNegativeInteger("1.5")).toBeNull();
      expect(parseExactNonNegativeInteger("0.9")).toBeNull();
    });

    it("refuses trailing garbage rather than reading the numeric prefix", () => {
      // parseInt("50abc", 10) === 50
      expect(parseExactNonNegativeInteger("50abc")).toBeNull();
      expect(parseExactNonNegativeInteger("10 000")).toBeNull();
      expect(parseExactNonNegativeInteger("5,000")).toBeNull();
    });
  });

  describe("plainly invalid input", () => {
    it("refuses an empty or whitespace-only field", () => {
      expect(parseExactNonNegativeInteger("")).toBeNull();
      expect(parseExactNonNegativeInteger("   ")).toBeNull();
    });

    it("refuses a sign, because every field it guards is non-negative", () => {
      expect(parseExactNonNegativeInteger("-1")).toBeNull();
      expect(parseExactNonNegativeInteger("+1")).toBeNull();
    });

    it("refuses non-numeric text", () => {
      expect(parseExactNonNegativeInteger("abc")).toBeNull();
      expect(parseExactNonNegativeInteger("Infinity")).toBeNull();
      expect(parseExactNonNegativeInteger("NaN")).toBeNull();
    });

    it("refuses a digit string too large to survive as an exact number", () => {
      // Beyond Number.MAX_SAFE_INTEGER the parsed value no longer equals what was
      // typed, which is the whole failure this function exists to prevent.
      expect(parseExactNonNegativeInteger("9007199254740993")).toBeNull();
      expect(parseExactNonNegativeInteger("999999999999999999999")).toBeNull();
    });
  });

  describe("legitimate values — accepted unchanged", () => {
    it("accepts the weights the delegation forms are built around", () => {
      expect(parseExactNonNegativeInteger("1")).toBe(1);
      expect(parseExactNonNegativeInteger("1000")).toBe(1000);
      expect(parseExactNonNegativeInteger("5000")).toBe(5000);
      expect(parseExactNonNegativeInteger("10000")).toBe(10000);
    });

    it("accepts zero, because a cluster id may legitimately be 0", () => {
      expect(parseExactNonNegativeInteger("0")).toBe(0);
    });

    it("accepts leading zeros, which are unambiguous", () => {
      expect(parseExactNonNegativeInteger("0010")).toBe(10);
    });

    it("trims surrounding whitespace before testing", () => {
      // Trimming agrees with the autovote custom field, which already trims, and
      // cannot rescue a hazardous value — " 1e1 " is still refused.
      expect(parseExactNonNegativeInteger("  12  ")).toBe(12);
      expect(parseExactNonNegativeInteger("\t500\n")).toBe(500);
      expect(parseExactNonNegativeInteger(" 1e1 ")).toBeNull();
    });
  });

  describe("non-string input", () => {
    it("refuses null and undefined rather than coercing", () => {
      expect(parseExactNonNegativeInteger(null)).toBeNull();
      expect(parseExactNonNegativeInteger(undefined)).toBeNull();
    });
  });
});

// The destination a redelegate moves real voting weight to.
//
// The failure this guards is not a revert — it is a WRONG RECIPIENT that the
// chain accepts. A typed id that names some other real cluster produces a valid
// transaction moving weight somewhere the user never named, and no admission
// refusal will catch it. That is why membership fails CLOSED here, unlike every
// other refusal in this flow.
describe("resolveRedelegateDestination", () => {
  const CLUSTERS = [
    { clusterId: 1, active: true },
    { clusterId: 2, active: true },
    { clusterId: 7, active: false },
  ];

  it("accepts an active cluster that is in the directory", () => {
    const v = resolveRedelegateDestination({
      raw: "2",
      sourceClusterId: 1,
      clusters: CLUSTERS,
    });
    expect(v).toEqual({ ok: true, clusterId: 2 });
  });

  it("refuses an id that names no known cluster — the wrong-recipient case", () => {
    const v = resolveRedelegateDestination({
      raw: "99",
      sourceClusterId: 1,
      clusters: CLUSTERS,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("99");
  });

  it("refuses an ineligible cluster, agreeing with the directory disabling its action", () => {
    const v = resolveRedelegateDestination({
      raw: "7",
      sourceClusterId: 1,
      clusters: CLUSTERS,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("7");
  });

  it("treats a non-true eligibility flag as ineligible, exactly as !active does", () => {
    const odd = [{ clusterId: 3, active: undefined as unknown as boolean }];
    const v = resolveRedelegateDestination({
      raw: "3",
      sourceClusterId: 1,
      clusters: odd,
    });
    expect(v.ok).toBe(false);
  });

  it("fails CLOSED when the cluster set is unavailable — membership is unverifiable", () => {
    const v = resolveRedelegateDestination({
      raw: "2",
      sourceClusterId: 1,
      clusters: [],
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("directory");
  });

  it("refuses the source cluster before it reaches the directory checks", () => {
    const v = resolveRedelegateDestination({
      raw: "1",
      sourceClusterId: 1,
      clusters: CLUSTERS,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("differ");
  });

  it("refuses the hazardous parse forms rather than resolving them to a neighbour", () => {
    // "1e1" once became 1 — a real, active cluster, and the wrong one.
    for (const raw of ["1e1", "1e3", "2.9", "2abc", "", "  "]) {
      const v = resolveRedelegateDestination({
        raw,
        sourceClusterId: 5,
        clusters: CLUSTERS,
      });
      expect(v.ok).toBe(false);
    }
  });

  it("does not let a hazardous form reach the directory as a truncated id", () => {
    // Guards the ordering: if the parse ran loosely, "1e1" would resolve to
    // cluster 1 and pass every later check.
    const v = resolveRedelegateDestination({
      raw: "1e1",
      sourceClusterId: 5,
      clusters: CLUSTERS,
    });
    expect(v).not.toEqual({ ok: true, clusterId: 1 });
  });
});

// A custom autovote plan is N delegate() calls. The per-cluster inputs render
// from the unfiltered directory, so an allocation can name a cluster that may
// not receive weight — and the batch pre-flight checks caps and row count but
// never eligibility. Same rule as the redelegate destination, one policy.
describe("allocationsEligibilityVerdict", () => {
  const CLUSTERS = [
    { clusterId: 1, active: true },
    { clusterId: 2, active: true },
    { clusterId: 7, active: false },
  ];

  it("accepts a plan whose every allocation is an active known cluster", () => {
    const v = allocationsEligibilityVerdict({
      allocations: [{ clusterId: 1 }, { clusterId: 2 }],
      clusters: CLUSTERS,
    });
    expect(v).toEqual({ ok: true });
  });

  it("refuses a plan containing an ineligible cluster, naming it", () => {
    const v = allocationsEligibilityVerdict({
      allocations: [{ clusterId: 1 }, { clusterId: 7 }],
      clusters: CLUSTERS,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("7");
  });

  it("refuses a plan containing a cluster the wallet has never seen", () => {
    const v = allocationsEligibilityVerdict({
      allocations: [{ clusterId: 99 }],
      clusters: CLUSTERS,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("99");
  });

  it("fails CLOSED when the cluster set is unavailable, as the destination does", () => {
    const v = allocationsEligibilityVerdict({
      allocations: [{ clusterId: 1 }],
      clusters: [],
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("directory");
  });

  it("blocks on the FIRST offending allocation, as the cap pre-flight does", () => {
    const v = allocationsEligibilityVerdict({
      allocations: [{ clusterId: 7 }, { clusterId: 99 }],
      clusters: CLUSTERS,
    });
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toContain("7");
  });

  it("gives the same answer the destination resolver gives for the same cluster", () => {
    // One policy: whatever a redelegate may not reach, a batch may not either.
    for (const clusterId of [7, 99]) {
      const batch = allocationsEligibilityVerdict({
        allocations: [{ clusterId }],
        clusters: CLUSTERS,
      });
      const single = resolveRedelegateDestination({
        raw: String(clusterId),
        sourceClusterId: 1,
        clusters: CLUSTERS,
      });
      expect(batch.ok).toBe(single.ok);
      expect(batch.ok === false && batch.message).toBe(
        single.ok === false && single.message,
      );
    }
  });

  it("accepts an empty plan — emptiness is the caller's own refusal", () => {
    expect(allocationsEligibilityVerdict({ allocations: [], clusters: CLUSTERS })).toEqual({
      ok: true,
    });
  });
});
