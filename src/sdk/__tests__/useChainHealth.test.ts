// Behavioral tests for the chain-health heartbeat hook.
//
// Drives the poll with fake timers over the real pure core, feeding scripted
// head reads through the client seam (setProviderForTest, the reconcile-test
// pattern). Asserts CONNECTING → LIVE on the first tick, LIVE → STALLED after
// the threshold (worst-case 3 ticks at the 5 s cadence), → OFFLINE on failure,
// recovery back to LIVE, and that unmounting cleans up (no leaked timer keeps
// reading). Rendered with react-dom (no testing-library); JSX is avoided via
// createElement so the file stays a *.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  resetProviderForTest,
  setProviderForTest,
  type MonolythiumClient,
} from "../client";
import { HEALTH_TICK_MS, STALL_THRESHOLD_MS } from "../chain-health";
import { useChainHealth, type ChainHealthView } from "../useChainHealth";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Stats = {
  chainId: number;
  latestHeight: number;
  latestBlockHash: string | null;
  latestTimestamp: number | null;
};

// The scripted head read for the current phase, and a call counter used to
// prove the poll stops after unmount.
let statsImpl: () => Promise<Stats>;
let reads = 0;

function head(height: number, hash: string | null): Stats {
  return { chainId: 69420, latestHeight: height, latestBlockHash: hash, latestTimestamp: null };
}

function installFakeClient() {
  const rpcClient = {
    lythChainStats: () => {
      reads += 1;
      return statsImpl();
    },
  } as unknown as MonolythiumClient["rpcClient"];
  setProviderForTest({ rpcClient, endpoint: "http://test-operator" });
}

let container: HTMLDivElement;
let root: Root;
let view: ChainHealthView | null;
let mounted = true;

function Probe({ enabled }: { enabled: boolean }) {
  view = useChainHealth(enabled);
  return null;
}

async function settle() {
  // Flush the pending read promise chain (loadChainHead → tick → setView).
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(enabled = true) {
  await act(async () => {
    root.render(createElement(Probe, { enabled }));
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  reads = 0;
  statsImpl = async () => head(100, "0xaa");
  installFakeClient();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  view = null;
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
  resetProviderForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useChainHealth heartbeat", () => {
  it("starts at CONNECTING and lifts to LIVE on the first tick", async () => {
    // A synchronous render commits the effect but does NOT await the read, so
    // the intermediate CONNECTING state is observable before the tick resolves.
    act(() => {
      root.render(createElement(Probe, { enabled: true }));
    });
    expect(view!.health.kind).toBe("loading");
    await settle();
    expect(view!.health).toEqual({ kind: "live", height: 100 });
    expect(view!.chainId).toBe(69420);
    expect(view!.endpoint).toBe("http://test-operator");
  });

  it("stays idle (CONNECTING) and never reads while disabled", async () => {
    await mount(false);
    expect(view!.health.kind).toBe("loading");
    await advance(HEALTH_TICK_MS * 3);
    expect(reads).toBe(0);
  });

  it("goes LIVE → STALLED after the threshold, in exactly 3 ticks at the 5 s cadence", async () => {
    // Head is stuck at 100/0xaa for every read.
    await mount();
    expect(view!.health).toEqual({ kind: "live", height: 100 });

    // ticks at t=5000 and t=10000 — still within the window.
    await advance(HEALTH_TICK_MS);
    expect(view!.health.kind).toBe("live");
    await advance(HEALTH_TICK_MS);
    expect(view!.health.kind).toBe("live");

    // tick at t=15000 — now - baseline === threshold → STALLED (inclusive).
    await advance(HEALTH_TICK_MS);
    expect(view!.health).toEqual({ kind: "stalled", height: 100 });
    expect(STALL_THRESHOLD_MS).toBe(3 * HEALTH_TICK_MS);
  });

  it("stays LIVE while the head keeps advancing", async () => {
    let h = 100;
    statsImpl = async () => head(h, `0x${h.toString(16)}`);
    await mount();
    for (let i = 0; i < 4; i++) {
      h += 1;
      await advance(HEALTH_TICK_MS);
      expect(view!.health).toEqual({ kind: "live", height: h });
    }
  });

  it("goes OFFLINE when the read fails, then recovers to LIVE", async () => {
    await mount();
    expect(view!.health.kind).toBe("live");

    // Connectivity drops.
    statsImpl = async () => {
      throw new Error("network down");
    };
    await advance(HEALTH_TICK_MS);
    expect(view!.health.kind).toBe("offline");

    // Connectivity returns with a fresh head.
    statsImpl = async () => head(200, "0xbb");
    await advance(HEALTH_TICK_MS);
    expect(view!.health).toEqual({ kind: "live", height: 200 });
  });

  it("stops reading after unmount (no leaked timer)", async () => {
    await mount();
    const readsAtUnmount = reads;
    expect(readsAtUnmount).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    mounted = false;

    await advance(HEALTH_TICK_MS * 5);
    expect(reads).toBe(readsAtUnmount);
  });
});
