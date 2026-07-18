// Home's refresh triggers, race token and coalescing.
//
// Two properties are load-bearing:
//   • a superseded response is dropped WHOLESALE — applying it partially (an
//     old balance beside fresh activity) yields a self-inconsistent screen that
//     still looks authoritative;
//   • the poll cannot stack. visibilitychange, focus and an interval tick can
//     all fire in the same instant, so at most one pipeline runs at a time and a
//     hidden window polls nobody.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import type { ChainHealth } from "../../sdk/chain-health";

vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({
    health: { kind: "live", height: 1 } as ChainHealth,
    chainId: 69420,
    endpoint: "x",
  }),
}));

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", address: "0xabc", name: "W" }),
}));

vi.mock("../../sdk/useChainSnapshot", () => ({
  useChainSnapshot: () => ({ status: "loading", snapshot: null }),
}));

/** Each call returns a promise the test resolves by hand, so overlapping loads
 *  can be ordered deliberately. */
const rig = vi.hoisted(() => ({
  calls: [] as { resolve: (v: unknown) => void }[],
  activityCalls: [] as { resolve: (v: unknown) => void }[],
}));

function tokenStatus(lythoshi: string) {
  return {
    endpoint: "x",
    nativeBalance: { ok: true, value: "x" },
    nativeBalanceLythoshi: { ok: true, value: lythoshi },
    tokenBalances: { ok: false, error: "n/a" },
    addressLabel: { ok: false, error: "n/a" },
    assetPolicy: { ok: false, error: "n/a" },
  };
}

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveTokenStatus: vi.fn(
    () => new Promise((resolve) => rig.calls.push({ resolve: resolve as (v: unknown) => void })),
  ),
  loadLiveAddressActivity: vi.fn(
    () =>
      new Promise((resolve) => rig.activityCalls.push({ resolve: resolve as (v: unknown) => void })),
  ),
  loadLiveDelegationStatus: vi.fn(async () => null),
}));

vi.mock("../../sdk/delegation", async (orig) => ({
  ...(await orig<typeof import("../../sdk/delegation")>()),
  fetchPendingRewards: vi.fn(async () => null),
}));

vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(async () => new Map()) }));
vi.mock("../../sdk/last-known-balance", () => ({
  loadLastKnownBalance: vi.fn(async () => null),
  saveLastKnownBalance: vi.fn(async () => {}),
}));

const endpointSubs = vi.hoisted(() => ({ fns: [] as (() => void)[] }));
vi.mock("../../sdk/client", async (orig) => ({
  ...(await orig<typeof import("../../sdk/client")>()),
  subscribeEndpoint: (fn: () => void) => {
    endpointSubs.fns.push(fn);
    return () => {
      endpointSubs.fns = endpointSubs.fns.filter((f) => f !== fn);
    };
  },
}));

import { renderWithProviders } from "../../test/renderWithProviders";
import { Home } from "../Home";

function heroAmount(): Element | null {
  return document.querySelector(".w-hero__amount");
}

/** Settle one queued balance+activity pair. */
async function settle(index: number, lythoshi: string, activityRows: unknown[] = []) {
  await act(async () => {
    rig.calls[index]!.resolve(tokenStatus(lythoshi));
    rig.activityCalls[index]!.resolve({ ok: true, value: activityRows });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => {
  rig.calls = [];
  rig.activityCalls = [];
  endpointSubs.fns = [];
  localStorage.clear();
  setVisibility("visible");
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("refresh triggers", () => {
  it("loads once on mount", () => {
    renderWithProviders(<Home goto={() => {}} />);
    expect(rig.calls).toHaveLength(1);
  });

  it("an endpoint switch triggers a fresh load", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await settle(0, "1000000000000000000");
    expect(rig.calls).toHaveLength(1);

    await act(async () => {
      endpointSubs.fns.forEach((f) => f());
      await Promise.resolve();
    });
    expect(rig.calls).toHaveLength(2);
  });

  it("the window becoming visible triggers a load", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await settle(0, "1000000000000000000");

    await act(async () => {
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(rig.calls).toHaveLength(2);
  });

  it("a visibilitychange to HIDDEN triggers nothing", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await settle(0, "1000000000000000000");

    await act(async () => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(rig.calls).toHaveLength(1);
  });

  it("window focus triggers a load", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await settle(0, "1000000000000000000");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(rig.calls).toHaveLength(2);
  });
});

describe("H3 — a superseded response is dropped WHOLESALE", () => {
  it("nothing from the stale response reaches state — not the balance, not activity", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    expect(rig.calls).toHaveLength(1);

    // Settle the first load so the pipeline is free, then start a second.
    await settle(0, "1000000000000000000"); // 1 LYTH
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(rig.calls).toHaveLength(2);

    // A THIRD trigger supersedes the second before it lands.
    await act(async () => {
      endpointSubs.fns.forEach((f) => f());
      await Promise.resolve();
    });

    // Settle the newer one first, then the superseded one.
    const newest = rig.calls.length - 1;
    await settle(newest, "7000000000000000000"); // 7 LYTH
    expect(heroAmount()?.textContent).toBe("7.00LYTH");

    await settle(1, "3000000000000000000", [{ hash: "0xstale" }]); // superseded
    // Neither its balance NOR its activity was applied.
    expect(heroAmount()?.textContent).toBe("7.00LYTH");
    expect(document.body.textContent).not.toContain("0xstale");
  });
});

describe("H4 — poll hygiene", () => {
  it("coalesces: a trigger while a load is in flight starts no second pipeline", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    expect(rig.calls).toHaveLength(1); // in flight, unsettled

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      endpointSubs.fns.forEach((f) => f());
      await Promise.resolve();
    });

    // All three fired in one instant; none stacked onto the in-flight load.
    expect(rig.calls).toHaveLength(1);
  });

  it("the interval fires while visible", async () => {
    vi.useFakeTimers();
    renderWithProviders(<Home goto={() => {}} />);
    rig.calls[0]!.resolve(tokenStatus("1000000000000000000"));
    rig.activityCalls[0]!.resolve({ ok: true, value: [] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(rig.calls.length).toBeGreaterThan(1);
  });

  it("the interval does NOT fire while hidden", async () => {
    vi.useFakeTimers();
    renderWithProviders(<Home goto={() => {}} />);
    rig.calls[0]!.resolve(tokenStatus("1000000000000000000"));
    rig.activityCalls[0]!.resolve({ ok: true, value: [] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const before = rig.calls.length;

    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000); // four ticks' worth
    });
    expect(rig.calls).toHaveLength(before);
  });

  it("clears the interval on unmount (no orphaned timer)", async () => {
    vi.useFakeTimers();
    const { unmount } = renderWithProviders(<Home goto={() => {}} />);
    rig.calls[0]!.resolve(tokenStatus("1000000000000000000"));
    rig.activityCalls[0]!.resolve({ ok: true, value: [] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    unmount();
    const before = rig.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rig.calls).toHaveLength(before);
  });

  it("does not re-arm the interval when state updates re-render", async () => {
    // The real re-render driver is a settling load: four setState calls plus a
    // token-metadata update. If the interval effect depended on the load
    // callback it would tear down and re-arm on each of those.
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    // Count only Home's own cadence — other providers arm their own timers.
    const homeTimers = () => spy.mock.calls.filter((c) => c[1] === 5_000).length;

    renderWithProviders(<Home goto={() => {}} />);
    const afterMount = homeTimers();
    expect(afterMount).toBeGreaterThan(0);

    rig.calls[0]!.resolve(tokenStatus("1000000000000000000"));
    rig.activityCalls[0]!.resolve({ ok: true, value: [] });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unchanged: the callbacks live in a ref, so the effect never re-ran.
    expect(homeTimers()).toBe(afterMount);
    spy.mockRestore();
  });
});
