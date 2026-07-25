// Behavioral tests for the chain-health heartbeat hook.
//
// Drives the poll with fake timers over the real pure core, feeding scripted
// head reads through the client seam (setProviderForTest, the reconcile-test
// pattern) and the warm-start store through a mock. Asserts CONNECTING → LIVE,
// LIVE → STALLED after the threshold, → OFFLINE + recovery, trust states, warm-
// start RECONNECTING (never LIVE from a cache), a persisted stall verdicting
// STALLED immediately, save-on-advance, and clean unmount. Rendered with
// react-dom; JSX is avoided via createElement so the file stays a *.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getChainInfo } from "@monolythium/core-sdk";
import {
  activeOperatorTrust,
  resetProviderForTest,
  setProviderForTest,
  type MonolythiumClient,
} from "../client";
import { __resetChainsForTests, addUserChain, setActiveChain } from "../chains";
import { NETWORK_SLUG } from "../chain-trust";
import { HEALTH_TICK_MS, STALL_THRESHOLD_MS } from "../chain-health";
import {
  useChainHealth,
  __resetChainHealthModuleForTests,
  type ChainHealthView,
} from "../useChainHealth";

// The fleet is just the active endpoint here, so the trust resolver's failover
// probe makes no real network calls. `throwOnce` lets a test make the fleet read
// itself fail, which is how a tick rejects OUTSIDE the verdict helper's catch.
const peersCtl = vi.hoisted(() => ({ throwOnce: false }));
vi.mock("../peers", async (orig) => ({
  ...(await orig<typeof import("../peers")>()),
  listPeers: () => {
    if (peersCtl.throwOnce) {
      peersCtl.throwOnce = false;
      throw new Error("operator store unreadable");
    }
    return [{ url: "http://test-operator", label: "test", region: null, tier: "gateway" }];
  },
}));

// The warm-start store is mocked so the hook never touches the real Tauri store.
const warm = vi.hoisted(() => ({
  loadWarmStartHead: vi.fn(),
  saveWarmStartHead: vi.fn(),
}));
vi.mock("../chain-health-store", () => warm);

// Not hardened, so a custom chain can be activated to exercise the chain-switch
// view reset. build-mode has no other bearing on the heartbeat.
vi.mock("../build-mode", () => ({ isHardenedBuild: () => false }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PIN = getChainInfo(NETWORK_SLUG);
const WALLET = "0xwallet";

type Stats = {
  chainId: number;
  genesisHash: string | null;
  latestHeight: number;
  latestBlockHash: string | null;
  latestTimestamp: number | null;
};

let statsImpl: () => Promise<Stats>;
let reads = 0;

// A trusted head: the pinned chain id + genesis, with a varying head hash.
function head(height: number, hash: string | null): Stats {
  return {
    chainId: PIN.chain_id,
    genesisHash: PIN.genesis_hash,
    latestHeight: height,
    latestBlockHash: hash,
    latestTimestamp: null,
  };
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

function Probe({ address }: { address: string | null }) {
  view = useChainHealth(address);
  return null;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(address: string | null = WALLET) {
  await act(async () => {
    root.render(createElement(Probe, { address }));
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  reads = 0;
  peersCtl.throwOnce = false;
  statsImpl = async () => head(100, "0xaa");
  warm.loadWarmStartHead.mockReset();
  warm.loadWarmStartHead.mockResolvedValue(null);
  warm.saveWarmStartHead.mockReset();
  warm.saveWarmStartHead.mockResolvedValue(undefined);
  __resetChainHealthModuleForTests();
  localStorage.clear(); // drop any active-chain selection a prior test persisted
  __resetChainsForTests();
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
    act(() => {
      root.render(createElement(Probe, { address: WALLET }));
    });
    expect(view!.health.kind).toBe("loading");
    await settle();
    expect(view!.health).toEqual({ kind: "live", height: 100 });
    expect(view!.chainId).toBe(69420);
    expect(view!.endpoint).toBe("http://test-operator");
  });

  it("stays idle (CONNECTING) and never reads without an address", async () => {
    await mount(null);
    expect(view!.health.kind).toBe("loading");
    await advance(HEALTH_TICK_MS * 3);
    expect(reads).toBe(0);
  });

  it("resets the published view to loading on a chain switch (no stale LIVE carryover)", async () => {
    await mount();
    expect(view!.health).toEqual({ kind: "live", height: 100 });

    // Make the new chain's head read hang so nothing can flip the view back to
    // live — isolating the reset. Without the reset, the prior chain's LIVE would
    // carry over and chainKindNotLive would trust the unverified new chain.
    statsImpl = () => new Promise<Stats>(() => {});
    await act(async () => {
      addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
      expect(setActiveChain("0x539").ok).toBe(true);
    });

    expect(view!.health.kind).toBe("loading");
  });

  it("goes LIVE → STALLED after the threshold, in exactly 3 ticks at the 5 s cadence", async () => {
    await mount();
    expect(view!.health).toEqual({ kind: "live", height: 100 });
    await advance(HEALTH_TICK_MS);
    expect(view!.health.kind).toBe("live");
    await advance(HEALTH_TICK_MS);
    expect(view!.health.kind).toBe("live");
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

  it("goes UNTRUSTED when the active operator answers a different chain id", async () => {
    statsImpl = async () => ({ ...head(100, "0xaa"), chainId: 1 });
    await mount();
    expect(view!.health.kind).toBe("untrusted");
    expect(activeOperatorTrust()).toBe("untrusted");
  });

  it("goes ALL-UNTRUSTED (regenesis) on the right chain with a mismatched genesis", async () => {
    statsImpl = async () => ({ ...head(100, "0xaa"), genesisHash: "0xdeadbeef" });
    await mount();
    expect(view!.health.kind).toBe("regenesis");
    expect(activeOperatorTrust()).toBe("regenesis");
  });

  it("marks the seam trusted on a passing check", async () => {
    await mount();
    expect(view!.health.kind).toBe("live");
    expect(activeOperatorTrust()).toBe(null);
  });

  it("goes OFFLINE when the read fails, then recovers to LIVE", async () => {
    await mount();
    expect(view!.health.kind).toBe("live");
    statsImpl = async () => {
      throw new Error("network down");
    };
    await advance(HEALTH_TICK_MS);
    expect(view!.health.kind).toBe("offline");
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

describe("useChainHealth warm-start (§I)", () => {
  it("seeds RECONNECTING from the cache before the first poll — never LIVE from a cache", async () => {
    warm.loadWarmStartHead.mockResolvedValue({ height: 50, headId: "0xold", advancedAtMs: 0 });
    // A poll that never resolves, so the RECONNECTING seed is observable.
    statsImpl = () => new Promise<Stats>(() => {});
    await mount();
    expect(view!.health).toEqual({ kind: "reconnecting", height: 50 });
  });

  it("scopes the warm-start read to the active address + chain", async () => {
    await mount("0xVAULT");
    expect(warm.loadWarmStartHead).toHaveBeenCalledWith("0xvault", "0x10f2c");
  });

  it("a warm reopen with an advanced head confirms LIVE", async () => {
    warm.loadWarmStartHead.mockResolvedValue({ height: 50, headId: "0xold", advancedAtMs: 0 });
    statsImpl = async () => head(51, "0xnew");
    await mount();
    expect(view!.health).toEqual({ kind: "live", height: 51 });
  });

  it("a warm reopen with a persisted stall verdicts STALLED immediately", async () => {
    vi.setSystemTime(STALL_THRESHOLD_MS + 5_000); // the persisted head advanced long ago
    warm.loadWarmStartHead.mockResolvedValue({ height: 50, headId: "0xold", advancedAtMs: 0 });
    statsImpl = async () => head(50, "0xold"); // chain still stuck at the persisted head
    await mount();
    expect(view!.health).toEqual({ kind: "stalled", height: 50 });
  });

  it("persists the last-seen head on a genuine advance", async () => {
    await mount(); // first ok tick advances from null → live #100
    expect(warm.saveWarmStartHead).toHaveBeenCalledWith("0xwallet", "0x10f2c", {
      height: 100,
      headId: "0xaa",
      advancedAtMs: 0,
    });
  });

  it("an in-session remount shows the prior kind instantly — no CONNECTING flash (§N)", async () => {
    await mount(); // → live, updates the module snapshot
    expect(view!.health.kind).toBe("live");

    // Unmount, then remount a FRESH instance WITHOUT resetting the module snapshot.
    act(() => root.unmount());
    mounted = false; // afterEach must not double-unmount the first root
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    act(() => root2.render(createElement(Probe, { address: WALLET })));
    // Instant initial render is the prior kind, not "loading".
    expect(view!.health.kind).toBe("live");
    act(() => root2.unmount());
    container2.remove();
  });
});

describe("the heartbeat survives a failing tick (the successor is always armed)", () => {
  it("a tick that THROWS still arms the next one, and fails closed meanwhile", async () => {
    await mount();
    expect(view!.health).toEqual({ kind: "live", height: 100 });
    expect(activeOperatorTrust()).toBeNull();
    const beforeFailing = reads;

    // Reject the next tick OUTSIDE the verdict helper's catch: the active
    // operator goes wrong-chain so the resolver fans out, and reading the fleet
    // then throws. Nothing downstream of that await can catch it.
    statsImpl = async () => ({ ...head(101, "0xbb"), chainId: 1 });
    peersCtl.throwOnce = true;
    await advance(HEALTH_TICK_MS);
    expect(reads).toBeGreaterThan(beforeFailing); // the failing tick did run

    // A tick that could not produce a verdict has not verified anything, so the
    // seam must refuse rather than coast on the previous verdict.
    expect(activeOperatorTrust()).not.toBeNull();
    expect(view!.health.kind).toBe("offline");

    // …and the heartbeat must still be beating. Without a guaranteed successor
    // no further timer is ever armed and the wallet stays stuck here forever.
    const beforeRecovery = reads;
    statsImpl = async () => head(102, "0xcc");
    await advance(HEALTH_TICK_MS);
    expect(reads).toBeGreaterThan(beforeRecovery);
    expect(view!.health).toEqual({ kind: "live", height: 102 });
    expect(activeOperatorTrust()).toBeNull();
  });
});
