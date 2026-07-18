// The has-name probe and the nudge predicate.
//
// The whole design is an asymmetry: falsely nagging someone who already owns a
// name is worse than missing a nudge, and nagging on an answer the wallet could
// not get is nagging about its own connectivity. So EVERY uncertain path
// reports "has a name".

import { beforeEach, describe, expect, it, vi } from "vitest";

const names = vi.hoisted(() => ({ local: [] as string[] }));
vi.mock("../my-names", async (orig) => ({
  ...(await orig<typeof import("../my-names")>()),
  readRegisteredNames: () => names.local,
}));

const rpc = vi.hoisted(() => ({
  nameOf: null as unknown,
  throws: false,
  providerThrows: false,
  calls: 0,
}));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  getProvider: () => {
    if (rpc.providerThrows) throw new Error("untrusted operator");
    return {
      rpcClient: {
        lythNameOf: async () => {
          rpc.calls += 1;
          if (rpc.throws) throw new Error("rpc down");
          return rpc.nameOf;
        },
      },
    };
  },
}));

import {
  dismissNameNudgeForever,
  loadHasNameVerdict,
  NAME_NUDGE_SNOOZE_MS,
  nameNudgeKey,
  purgeNameNudgeForAddress,
  readNameNudgeState,
  shouldShowNameNudge,
  snoozeNameNudge,
  type NameNudgeState,
} from "../has-name";

const A = "mono1aaa";
const B = "mono1bbb";
const NOW = 1_700_000_000_000;

beforeEach(() => {
  localStorage.clear();
  names.local = [];
  rpc.nameOf = null;
  rpc.throws = false;
  rpc.providerThrows = false;
  rpc.calls = 0;
});

describe("loadHasNameVerdict — biased to true", () => {
  it("a local registration record short-circuits with NO network", async () => {
    names.local = ["alice.mono"];
    expect(await loadHasNameVerdict(A)).toBe(true);
    expect(rpc.calls).toBe(0);
  });

  it("a resolved reverse name is true", async () => {
    rpc.nameOf = { name: "alice.mono" };
    expect(await loadHasNameVerdict(A)).toBe(true);
  });

  it("a successful NULL read is the ONLY false — the single nudge path", async () => {
    rpc.nameOf = { name: null };
    expect(await loadHasNameVerdict(A)).toBe(false);
  });

  it("an empty-string name counts as no name", async () => {
    rpc.nameOf = { name: "   " };
    expect(await loadHasNameVerdict(A)).toBe(false);
  });

  it("an RPC throw is true (uncertainty never nags)", async () => {
    rpc.throws = true;
    expect(await loadHasNameVerdict(A)).toBe(true);
  });

  it("a gated/untrusted provider is true", async () => {
    rpc.providerThrows = true;
    expect(await loadHasNameVerdict(A)).toBe(true);
  });

  it("a blank address is true (nothing to nudge about)", async () => {
    expect(await loadHasNameVerdict("   ")).toBe(true);
    expect(rpc.calls).toBe(0);
  });
});

describe("shouldShowNameNudge", () => {
  const snoozed = (until: number): NameNudgeState => ({
    dismissedForever: false,
    snoozedUntilMs: until,
  });

  it("never shows unless the probe said DEFINITIVELY no name", () => {
    expect(shouldShowNameNudge(null, false, NOW)).toBe(false);
    expect(shouldShowNameNudge(snoozed(0), false, NOW)).toBe(false);
  });

  it("shows when never dismissed", () => {
    expect(shouldShowNameNudge(null, true, NOW)).toBe(true);
  });

  it("never shows after a permanent dismissal", () => {
    const state: NameNudgeState = { dismissedForever: true, snoozedUntilMs: null };
    expect(shouldShowNameNudge(state, true, NOW)).toBe(false);
    expect(shouldShowNameNudge(state, true, NOW + NAME_NUDGE_SNOOZE_MS * 100)).toBe(false);
  });

  it("respects the snooze, returning AT the boundary", () => {
    const until = NOW + NAME_NUDGE_SNOOZE_MS;
    expect(shouldShowNameNudge(snoozed(until), true, until - 1)).toBe(false);
    expect(shouldShowNameNudge(snoozed(until), true, until)).toBe(true); // inclusive
    expect(shouldShowNameNudge(snoozed(until), true, until + 1)).toBe(true);
  });
});

describe("nudge state storage — per address", () => {
  it("snooze applies to one address only", () => {
    snoozeNameNudge(A, NOW);
    expect(readNameNudgeState(A)).toEqual({
      dismissedForever: false,
      snoozedUntilMs: NOW + NAME_NUDGE_SNOOZE_MS,
    });
    expect(readNameNudgeState(B)).toBeNull();
  });

  it("permanent dismissal applies to one address only", () => {
    dismissNameNudgeForever(A);
    expect(readNameNudgeState(A)?.dismissedForever).toBe(true);
    expect(readNameNudgeState(B)).toBeNull();
    expect(shouldShowNameNudge(readNameNudgeState(B), true, NOW)).toBe(true);
  });

  it("corrupt JSON defaults to show", () => {
    localStorage.setItem(nameNudgeKey(A), "{not json");
    expect(readNameNudgeState(A)).toBeNull();
    expect(shouldShowNameNudge(readNameNudgeState(A), true, NOW)).toBe(true);
  });

  it("a non-finite snooze reads as absent", () => {
    localStorage.setItem(
      nameNudgeKey(A),
      JSON.stringify({ dismissedForever: false, snoozedUntilMs: "soon" }),
    );
    expect(readNameNudgeState(A)).toEqual({ dismissedForever: false, snoozedUntilMs: null });
  });

  it("purge drops exactly this address's state", () => {
    snoozeNameNudge(A, NOW);
    dismissNameNudgeForever(B);
    purgeNameNudgeForAddress(A);
    expect(readNameNudgeState(A)).toBeNull();
    expect(readNameNudgeState(B)?.dismissedForever).toBe(true);
  });
});
