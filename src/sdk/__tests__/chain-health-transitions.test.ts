// The status specification §L transition table as a test table, plus the §N
// edge cases that are testable at the pure-core level (clock skew, a degraded →
// different-degraded flip). Each row asserts `from --(observation @ now)--> to`
// against the real reducer, so the spec's table is a regression fixture.

import { describe, expect, it } from "vitest";
import {
  INITIAL_HEALTH_STATE,
  STALL_THRESHOLD_MS,
  reconnectingSeed,
  reduceHealth,
  type ChainHealthKind,
  type DegradedCause,
  type HealthState,
  type Observation,
} from "../chain-health";

const okObs = (height: number, headId: string): Observation => ({ ok: true, height, headId, chainId: 69420 });
const failObs = (cause: DegradedCause): Observation => ({ ok: false, cause });

const live = (height: number, headId: string, advancedAtMs: number): HealthState => ({
  health: { kind: "live", height },
  lastHeadId: headId,
  lastAdvancedAtMs: advancedAtMs,
});
const stalled = (height: number, headId: string, advancedAtMs: number): HealthState => ({
  health: { kind: "stalled", height },
  lastHeadId: headId,
  lastAdvancedAtMs: advancedAtMs,
});
const degraded = (kind: "offline" | "untrusted" | "regenesis" | "quarantined", headId: string, advancedAtMs: number): HealthState => ({
  health: kind === "offline" ? { kind, reason: "x" } : { kind },
  lastHeadId: headId,
  lastAdvancedAtMs: advancedAtMs,
});

// [name, from, observation, nowMs, expected-to kind]
const rows: Array<[string, HealthState, Observation, number, ChainHealthKind]> = [
  ["loading → live (first ok tick)", INITIAL_HEALTH_STATE, okObs(100, "0xa"), 1_000, "live"],
  ["reconnecting → live (head advanced while closed)", reconnectingSeed({ height: 50, headId: "0xold", advancedAtMs: 0 }), okObs(51, "0xnew"), 5_000, "live"],
  ["reconnecting → stalled (persisted head past threshold)", reconnectingSeed({ height: 50, headId: "0xold", advancedAtMs: 0 }), okObs(50, "0xold"), STALL_THRESHOLD_MS, "stalled"],
  ["live → live (new head hex)", live(100, "0xa", 0), okObs(101, "0xb"), 5_000, "live"],
  ["live → live (same head, within window)", live(100, "0xa", 0), okObs(100, "0xa"), STALL_THRESHOLD_MS - 1, "live"],
  ["live → stalled (same head ≥ threshold, inclusive)", live(100, "0xa", 0), okObs(100, "0xa"), STALL_THRESHOLD_MS, "stalled"],
  ["live → offline (P✗ unreachable)", live(100, "0xa", 0), failObs("unreachable"), 5_000, "offline"],
  ["live → untrusted (P✗ untrusted)", live(100, "0xa", 0), failObs("untrusted"), 5_000, "untrusted"],
  ["live → regenesis (P✗ regenesis)", live(100, "0xa", 0), failObs("regenesis"), 5_000, "regenesis"],
  ["live → quarantined (P✗ quarantined)", live(100, "0xa", 0), failObs("quarantined"), 5_000, "quarantined"],
  ["stalled → live (new head)", stalled(100, "0xa", 0), okObs(101, "0xb"), 40_000, "live"],
  ["stalled → offline (P✗)", stalled(100, "0xa", 0), failObs("unreachable"), 40_000, "offline"],
  ["offline → live (P✓ recovers)", degraded("offline", "0xa", 0), okObs(101, "0xb"), 8_000, "live"],
  ["untrusted → regenesis (a different degraded cause)", degraded("untrusted", "0xa", 0), failObs("regenesis"), 8_000, "regenesis"],
  ["quarantined → live (P✓ recovers)", degraded("quarantined", "0xa", 0), okObs(200, "0xc"), 8_000, "live"],
];

describe("chain-health §L transition table", () => {
  for (const [name, from, obs, nowMs, expected] of rows) {
    it(name, () => {
      expect(reduceHealth(from, obs, nowMs).health.kind).toBe(expected);
    });
  }
});

describe("§N edge cases (pure)", () => {
  it("clock skew: a persisted advance time in the FUTURE never yields a false stall", () => {
    // now < lastAdvancedAt (clock moved back / a stale future timestamp).
    const next = reduceHealth(live(100, "0xa", 20_000), okObs(100, "0xa"), 5_000);
    expect(next.health.kind).toBe("live"); // not stalled
  });

  it("a failed tick leaves the stall timer untouched, so recovery times correctly", () => {
    const afterFail = reduceHealth(live(100, "0xa", 0), failObs("unreachable"), 5_000);
    expect(afterFail.lastAdvancedAtMs).toBe(0); // untouched by the offline tick
    // A later ok tick with the SAME head, now past the threshold → STALLED (the
    // outage didn't reset the clock).
    const recovered = reduceHealth(afterFail, okObs(100, "0xa"), STALL_THRESHOLD_MS);
    expect(recovered.health.kind).toBe("stalled");
  });
});
