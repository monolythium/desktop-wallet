// Unit tests for the pure chain-health decision core.
//
// Table-driven (a for..of over inline case arrays — the house idiom; it.each is
// used nowhere in this suite). Covers the constants, the inclusive stall
// predicate + its tick arithmetic, the degraded-cause precedence (status
// specification §F.7), the failed-poll → kind map (§D.3), and every
// observation → state transition this pass can produce (§D.2 + §E), plus the
// success/degraded mutual exclusion invariant (§A).

import { describe, expect, it } from "vitest";
import {
  HEALTH_TICK_MS,
  INITIAL_HEALTH_STATE,
  STALL_THRESHOLD_MS,
  STALL_WORST_CASE_TICKS,
  chainHealthForFailedPoll,
  chainHealthStallVerdict,
  chainKindNotLive,
  classifyNoOperatorReason,
  reconnectingSeed,
  reduceHealth,
  type DegradedCause,
  type FleetTrustSignals,
  type HealthState,
  type Observation,
} from "../chain-health";

const okObs = (height: number, headId: string): Observation => ({
  ok: true,
  height,
  headId,
  chainId: 69420,
});
const failObs = (cause: DegradedCause, reason?: string): Observation => ({
  ok: false,
  cause,
  reason,
});

describe("constants (status specification §B, adapted)", () => {
  it("uses the specification's 5000 ms tick and 15000 ms stall threshold", () => {
    expect(HEALTH_TICK_MS).toBe(5_000);
    expect(STALL_THRESHOLD_MS).toBe(15_000);
  });

  it("worst-case stall detection is ceil(threshold / tick) = 3 ticks", () => {
    expect(STALL_WORST_CASE_TICKS).toBe(3);
    expect(STALL_WORST_CASE_TICKS).toBe(Math.ceil(STALL_THRESHOLD_MS / HEALTH_TICK_MS));
    expect(STALL_WORST_CASE_TICKS * HEALTH_TICK_MS).toBe(15_000);
  });
});

describe("chainHealthStallVerdict — inclusive at the threshold (§E)", () => {
  // [now, lastAdvancedAt, threshold, expected]
  const cases: Array<[number, number, number, boolean]> = [
    [15_000, 0, 15_000, true], // exactly at threshold → stalled (inclusive >=)
    [14_999, 0, 15_000, false], // one ms under → not stalled
    [15_001, 0, 15_000, true], // over → stalled
    [0, 0, 15_000, false], // no elapsed time → not stalled
    [30_000, 15_000, 15_000, true], // non-zero base, exactly at threshold
    [29_999, 15_000, 15_000, false], // non-zero base, one ms under
  ];
  for (const [now, base, threshold, expected] of cases) {
    it(`verdict(${now}, ${base}, ${threshold}) === ${expected}`, () => {
      expect(chainHealthStallVerdict(now, base, threshold)).toBe(expected);
    });
  }
});

describe("classifyNoOperatorReason — precedence regenesis > untrusted > quarantined > unreachable (§F.7)", () => {
  // [signals, expected]
  const cases: Array<[FleetTrustSignals, DegradedCause]> = [
    // regenesis outranks everything else present.
    [{ activeCount: 3, anyGenesisMismatch: true, anyWrongChainId: true, allQuarantined: true }, "regenesis"],
    // untrusted outranks quarantined + unreachable.
    [{ activeCount: 3, anyGenesisMismatch: false, anyWrongChainId: true, allQuarantined: true }, "untrusted"],
    // quarantined only when active AND unanimous.
    [{ activeCount: 3, anyGenesisMismatch: false, anyWrongChainId: false, allQuarantined: true }, "quarantined"],
    // a non-unanimous fleet → unreachable.
    [{ activeCount: 3, anyGenesisMismatch: false, anyWrongChainId: false, allQuarantined: false }, "unreachable"],
    // empty fleet can never be quarantined.
    [{ activeCount: 0, anyGenesisMismatch: false, anyWrongChainId: false, allQuarantined: true }, "unreachable"],
    // nothing flagged → unreachable.
    [{ activeCount: 2, anyGenesisMismatch: false, anyWrongChainId: false, allQuarantined: false }, "unreachable"],
  ];
  for (const [signals, expected] of cases) {
    it(`${JSON.stringify(signals)} → ${expected}`, () => {
      expect(classifyNoOperatorReason(signals)).toBe(expected);
    });
  }
});

describe("chainHealthForFailedPoll — cause → kind (§D.3)", () => {
  it("maps each trust cause to its like-named kind", () => {
    expect(chainHealthForFailedPoll("regenesis")).toEqual({ kind: "regenesis" });
    expect(chainHealthForFailedPoll("untrusted")).toEqual({ kind: "untrusted" });
    expect(chainHealthForFailedPoll("quarantined")).toEqual({ kind: "quarantined" });
  });
  it("maps unreachable to offline, carrying the reason", () => {
    expect(chainHealthForFailedPoll("unreachable", "boom")).toEqual({ kind: "offline", reason: "boom" });
  });
  it("defaults the offline reason to 'unreachable' when none is given", () => {
    expect(chainHealthForFailedPoll("unreachable")).toEqual({ kind: "offline", reason: "unreachable" });
  });
});

describe("reduceHealth — observation → state (§D.2 + §E)", () => {
  it("first ok tick lifts loading → live and seeds the stall baseline", () => {
    const next = reduceHealth(INITIAL_HEALTH_STATE, okObs(100, "0xaa"), 1_000);
    expect(next.health).toEqual({ kind: "live", height: 100 });
    expect(next.lastHeadId).toBe("0xaa");
    expect(next.lastAdvancedAtMs).toBe(1_000);
  });

  it("a new head advances → live and refreshes lastAdvancedAt", () => {
    const s0: HealthState = { health: { kind: "live", height: 100 }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(101, "0xbb"), 6_000);
    expect(next.health).toEqual({ kind: "live", height: 101 });
    expect(next.lastHeadId).toBe("0xbb");
    expect(next.lastAdvancedAtMs).toBe(6_000);
  });

  it("same head within the window stays live and does NOT move the advance time", () => {
    const s0: HealthState = { health: { kind: "live", height: 100 }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(100, "0xaa"), 1_000 + STALL_THRESHOLD_MS - 1);
    expect(next.health).toEqual({ kind: "live", height: 100 });
    expect(next.lastAdvancedAtMs).toBe(1_000); // preserved
  });

  it("same head at/after the threshold → stalled (inclusive), advance time preserved", () => {
    const s0: HealthState = { health: { kind: "live", height: 100 }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const atThreshold = reduceHealth(s0, okObs(100, "0xaa"), 1_000 + STALL_THRESHOLD_MS);
    expect(atThreshold.health).toEqual({ kind: "stalled", height: 100 });
    expect(atThreshold.lastAdvancedAtMs).toBe(1_000);
  });

  it("stalled → new head recovers to live", () => {
    const s0: HealthState = { health: { kind: "stalled", height: 100 }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(101, "0xbb"), 40_000);
    expect(next.health).toEqual({ kind: "live", height: 101 });
    expect(next.lastAdvancedAtMs).toBe(40_000);
  });

  it("a failed tick → offline and leaves the stall timer untouched (§E)", () => {
    const s0: HealthState = { health: { kind: "live", height: 100 }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, failObs("unreachable", "net down"), 6_000);
    expect(next.health).toEqual({ kind: "offline", reason: "net down" });
    expect(next.lastHeadId).toBe("0xaa"); // untouched
    expect(next.lastAdvancedAtMs).toBe(1_000); // untouched
  });

  it("offline → ok new head recovers to live (§D.4)", () => {
    const s0: HealthState = { health: { kind: "offline", reason: "x" }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(101, "0xbb"), 8_000);
    expect(next.health).toEqual({ kind: "live", height: 101 });
  });

  it("offline → ok SAME head recovers to live when the head is still fresh", () => {
    const s0: HealthState = { health: { kind: "offline", reason: "x" }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(100, "0xaa"), 1_000 + STALL_THRESHOLD_MS - 1);
    expect(next.health).toEqual({ kind: "live", height: 100 });
  });

  it("offline → ok SAME head is honestly STALLED when the head has not advanced past the threshold", () => {
    const s0: HealthState = { health: { kind: "offline", reason: "x" }, lastHeadId: "0xaa", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(100, "0xaa"), 1_000 + STALL_THRESHOLD_MS);
    expect(next.health).toEqual({ kind: "stalled", height: 100 });
  });

  it("treats head identity, not height, as the advance signal (fail-closed headId)", () => {
    // Same headId but a different height (a node quirk) counts as UNCHANGED.
    const s0: HealthState = { health: { kind: "live", height: 100 }, lastHeadId: "42", lastAdvancedAtMs: 1_000 };
    const next = reduceHealth(s0, okObs(999, "42"), 1_000 + STALL_THRESHOLD_MS);
    expect(next.health.kind).toBe("stalled");
  });
});

describe("success/degraded mutual exclusion per tick (§A)", () => {
  const base: HealthState = { health: { kind: "live", height: 5 }, lastHeadId: "0x1", lastAdvancedAtMs: 0 };
  it("an ok observation only ever yields live or stalled", () => {
    for (const now of [0, STALL_THRESHOLD_MS - 1, STALL_THRESHOLD_MS, 100_000]) {
      const advanced = reduceHealth(base, okObs(6, "0x2"), now).health.kind;
      const same = reduceHealth(base, okObs(5, "0x1"), now).health.kind;
      expect(["live", "stalled"]).toContain(advanced);
      expect(["live", "stalled"]).toContain(same);
    }
  });
  it("a failed observation only ever yields a degraded kind", () => {
    for (const cause of ["regenesis", "untrusted", "quarantined", "unreachable"] as const) {
      const kind = reduceHealth(base, failObs(cause), 1).health.kind;
      expect(["offline", "untrusted", "regenesis", "quarantined"]).toContain(kind);
    }
  });
});

describe("chainKindNotLive — balance/activity gating (§N/§O)", () => {
  it("is true for the degraded kinds and stalled — including quarantined (§O hides the balance)", () => {
    for (const kind of ["offline", "quarantined", "untrusted", "regenesis", "stalled"] as const) {
      expect(chainKindNotLive(kind)).toBe(true);
    }
  });
  it("is false for live, the transient kinds, and null", () => {
    for (const kind of ["live", "loading", "reconnecting", null] as const) {
      expect(chainKindNotLive(kind)).toBe(false);
    }
  });
});

describe("reconnectingSeed — warm-start seed (§I)", () => {
  it("seeds RECONNECTING (never live) carrying the head identity + advance time", () => {
    const seeded = reconnectingSeed({ height: 42, headId: "0xseed", advancedAtMs: 1_000 });
    expect(seeded.health).toEqual({ kind: "reconnecting", height: 42 });
    expect(seeded.lastHeadId).toBe("0xseed");
    expect(seeded.lastAdvancedAtMs).toBe(1_000);
  });

  it("a seeded machine verdicts STALLED immediately when the persisted head is past the threshold", () => {
    const seeded = reconnectingSeed({ height: 42, headId: "0xseed", advancedAtMs: 0 });
    // First ok tick: same head as persisted, now past the threshold → STALLED.
    const next = reduceHealth(seeded, { ok: true, height: 42, headId: "0xseed", chainId: 69420 }, STALL_THRESHOLD_MS);
    expect(next.health).toEqual({ kind: "stalled", height: 42 });
  });

  it("a seeded machine goes LIVE when the head advanced while closed", () => {
    const seeded = reconnectingSeed({ height: 42, headId: "0xseed", advancedAtMs: 0 });
    const next = reduceHealth(seeded, { ok: true, height: 43, headId: "0xnew", chainId: 69420 }, 5_000);
    expect(next.health).toEqual({ kind: "live", height: 43 });
  });
});

describe("worst-case stall detection latency = 3 ticks at the 5 s cadence (§E)", () => {
  it("a head stuck from the first ok tick verdicts STALLED exactly at tick 3 (15000 ms)", () => {
    let state = INITIAL_HEALTH_STATE;
    let t = 0;
    // tick 0: first ok → live, baseline at t=0.
    state = reduceHealth(state, okObs(100, "0xstuck"), t);
    expect(state.health.kind).toBe("live");
    // ticks 1..2 (t = 5000, 10000): still within the window → live.
    for (const k of [1, 2]) {
      t = k * HEALTH_TICK_MS;
      state = reduceHealth(state, okObs(100, "0xstuck"), t);
      expect(state.health.kind).toBe("live");
    }
    // tick 3 (t = 15000): now - baseline === threshold → STALLED (inclusive).
    t = STALL_WORST_CASE_TICKS * HEALTH_TICK_MS;
    state = reduceHealth(state, okObs(100, "0xstuck"), t);
    expect(state.health.kind).toBe("stalled");
  });
});
