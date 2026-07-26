// The balance display ladder.
//
// The protection this encodes: no input combination may yield a figure the
// wallet cannot stand behind. Two failure modes are specifically hunted here —
// a fabricated zero while the value is unknown, and a remembered value riding
// through a window where the chain isn't trusted.

import { describe, expect, it } from "vitest";
import { balanceDisplayState, type BalanceDisplayState } from "../balance-display";

const LIVE = "5000000000000000000"; // 5 LYTH
const SEED = "3000000000000000000"; // 3 LYTH

describe("balanceDisplayState — the ordered ladder", () => {
  const table: {
    name: string;
    notLive: boolean;
    live: string | null;
    seed: string | null;
    expected: BalanceDisplayState;
  }[] = [
    {
      name: "live value only → fresh value",
      notLive: false,
      live: LIVE,
      seed: null,
      expected: { kind: "value", lythoshi: LIVE, stale: false },
    },
    {
      name: "seed only → stale value",
      notLive: false,
      live: null,
      seed: SEED,
      expected: { kind: "value", lythoshi: SEED, stale: true },
    },
    {
      name: "live beats seed (and is not marked stale)",
      notLive: false,
      live: LIVE,
      seed: SEED,
      expected: { kind: "value", lythoshi: LIVE, stale: false },
    },
    {
      name: "neither → loading",
      notLive: false,
      live: null,
      seed: null,
      expected: { kind: "loading" },
    },
    {
      name: "not-live hides, even with a live value",
      notLive: true,
      live: LIVE,
      seed: null,
      expected: { kind: "hidden" },
    },
    {
      name: "not-live hides, even with a seed (the honesty pin)",
      notLive: true,
      live: null,
      seed: SEED,
      expected: { kind: "hidden" },
    },
    {
      name: "not-live hides with both present",
      notLive: true,
      live: LIVE,
      seed: SEED,
      expected: { kind: "hidden" },
    },
    {
      name: "not-live with nothing still hides (not loading)",
      notLive: true,
      live: null,
      seed: null,
      expected: { kind: "hidden" },
    },
  ];

  for (const row of table) {
    it(row.name, () => {
      expect(balanceDisplayState(row.notLive, row.live, row.seed)).toEqual(row.expected);
    });
  }
});

describe("an honest zero is a VALUE, not a loading state", () => {
  it("a live '0' renders as a value", () => {
    expect(balanceDisplayState(false, "0", null)).toEqual({
      kind: "value",
      lythoshi: "0",
      stale: false,
    });
  });

  it("a seeded '0' renders as a stale value", () => {
    expect(balanceDisplayState(false, null, "0")).toEqual({
      kind: "value",
      lythoshi: "0",
      stale: true,
    });
  });

  it("a live '0' still beats a non-zero seed", () => {
    // The balance really did go to zero — showing the remembered 5 LYTH would
    // be the lie here, not the zero.
    expect(balanceDisplayState(false, "0", SEED)).toEqual({
      kind: "value",
      lythoshi: "0",
      stale: false,
    });
  });
});

describe("the banned state is unreachable", () => {
  it("no input combination yields a value when both sources are absent", () => {
    for (const notLive of [true, false]) {
      for (const live of [null, "", "   "]) {
        for (const seed of [null, "", "   "]) {
          const state = balanceDisplayState(notLive, live, seed);
          expect(state.kind).not.toBe("value");
        }
      }
    }
  });

  it("a blank read never presents as a figure", () => {
    expect(balanceDisplayState(false, "", null)).toEqual({ kind: "loading" });
    expect(balanceDisplayState(false, "   ", null)).toEqual({ kind: "loading" });
    expect(balanceDisplayState(false, "", "")).toEqual({ kind: "loading" });
  });

  it("a blank live read falls through to the seed rather than blanking it", () => {
    expect(balanceDisplayState(false, "", SEED)).toEqual({
      kind: "value",
      lythoshi: SEED,
      stale: true,
    });
  });
});
