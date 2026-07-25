// Unit tests for genesis + chain-id trust enforcement.
//
// Table-driven over the pure verdict/resolution helpers (the status
// specification §F split: wrong chain id → untrusted; right chain, wrong/absent
// genesis → regenesis / fail-closed), plus the fail-closed seam gate
// (getProvider refuses an untrusted operator; getProviderUnchecked does not).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChainInfo } from "@monolythium/core-sdk";
import type { ChainStatsResponse } from "@monolythium/core-sdk";
import {
  CHAIN_TRUST_TIMEOUT_MS,
  probeActiveChainOperator,
  NETWORK_SLUG,
  fleetSignals,
  probeOperator,
  quarantinedVerdict,
  resolveFleet,
  resolveTrustedHead,
  unreachableVerdict,
  verdictFromStats,
  type OperatorVerdict,
} from "../chain-trust";
import {
  getProvider,
  getProviderUnchecked,
  markActiveOperatorTrusted,
  markActiveOperatorUntrusted,
  resetProviderForTest,
  setProviderForTest,
  type MonolythiumClient,
} from "../client";
import { HEALTH_TICK_MS, classifyNoOperatorReason } from "../chain-health";
import { ACTIVE_CHAIN_KEY, USER_CHAINS_KEY } from "../chains";
import { writeOperatorOverride } from "../operator-override";

// The fleet resolver reads its operator list from listPeers; pin it to a small
// two-operator set so the injected probe drives the failover deterministically.
vi.mock("../peers", async (orig) => ({
  ...(await orig<typeof import("../peers")>()),
  listPeers: () => [
    { url: "http://active", label: "a", region: null, tier: "gateway" },
    { url: "http://other", label: "b", region: null, tier: "official" },
  ],
}));

const PIN = getChainInfo(NETWORK_SLUG);
const PIN_CHAIN = PIN.chain_id;
const PIN_GENESIS = PIN.genesis_hash;

function stats(over: Partial<ChainStatsResponse>): ChainStatsResponse {
  return {
    schemaVersion: 1,
    chainId: PIN_CHAIN,
    genesisHash: PIN_GENESIS,
    latestHeight: 100,
    latestBlockHash: "0xhead",
    latestTimestamp: null,
    peerCount: 3,
    mempool: { ready: 0, pending: 0, mailboxDepth: 0 },
    indexer: null,
    clusters: { total: 4, pageSize: 10 },
    ...over,
  };
}

describe("verdictFromStats — the §F chain-id vs genesis split", () => {
  it("right chain + matching genesis → trusted", () => {
    const v = verdictFromStats(stats({}), PIN_CHAIN, PIN_GENESIS);
    expect(v.trusted).toBe(true);
    expect(v.wrongChainId).toBe(false);
    expect(v.genesisMismatch).toBe(false);
    expect(v.headId).toBe("0xhead");
  });

  it("compares genesis case-insensitively", () => {
    const v = verdictFromStats(stats({ genesisHash: PIN_GENESIS.toUpperCase() }), PIN_CHAIN, PIN_GENESIS);
    expect(v.trusted).toBe(true);
  });

  it("wrong chain id → wrongChainId (untrusted), never a genesis verdict", () => {
    const v = verdictFromStats(stats({ chainId: 1, genesisHash: "0xdifferent" }), PIN_CHAIN, PIN_GENESIS);
    expect(v.wrongChainId).toBe(true);
    expect(v.genesisMismatch).toBe(false); // a wrong-chain op is not classified on genesis
    expect(v.trusted).toBe(false);
  });

  it("right chain, different genesis → genesisMismatch (regenesis)", () => {
    const v = verdictFromStats(stats({ genesisHash: "0xdeadbeef" }), PIN_CHAIN, PIN_GENESIS);
    expect(v.genesisMismatch).toBe(true);
    expect(v.wrongChainId).toBe(false);
    expect(v.trusted).toBe(false);
  });

  it("fail-closed: right chain, absent genesis proves nothing → not trusted, not a mismatch", () => {
    const v = verdictFromStats(stats({ genesisHash: null }), PIN_CHAIN, PIN_GENESIS);
    expect(v.trusted).toBe(false);
    expect(v.genesisMismatch).toBe(false); // null observed is not a definitive mismatch
    expect(v.wrongChainId).toBe(false);
  });

  it("fail-closed on the head identity: null latestBlockHash falls back to the height", () => {
    const v = verdictFromStats(stats({ latestBlockHash: null, latestHeight: 77 }), PIN_CHAIN, PIN_GENESIS);
    expect(v.headId).toBe("77");
  });

  it("records observed genesis + chain id additively without changing the trust decision", () => {
    // A mismatch: the observed values are recorded, but the trust verdict is
    // exactly what it was before the fields existed (fail-closed, not trusted).
    const v = verdictFromStats(stats({ chainId: 1, genesisHash: "0xOTHER" }), PIN_CHAIN, PIN_GENESIS);
    expect(v.observedChainId).toBe(1);
    expect(v.observedGenesis).toBe("0xOTHER");
    expect(v.trusted).toBe(false);
    expect(v.wrongChainId).toBe(true);
    // A trusted operator records its (matching) values too.
    const t = verdictFromStats(stats({}), PIN_CHAIN, PIN_GENESIS);
    expect(t.observedChainId).toBe(PIN_CHAIN);
    expect(t.observedGenesis).toBe(PIN_GENESIS);
    expect(t.trusted).toBe(true);
    // Absent genesis records null and stays fail-closed.
    expect(verdictFromStats(stats({ genesisHash: null }), PIN_CHAIN, PIN_GENESIS).observedGenesis).toBeNull();
  });
});

describe("verdictFromStats — null pin (custom chain, chain-id-only trust) [G1]", () => {
  it("trusted iff chainId matches; genesisMismatch can NEVER fire", () => {
    const okAny = verdictFromStats(stats({ genesisHash: "0xanything" }), PIN_CHAIN, null);
    expect(okAny.trusted).toBe(true);
    expect(okAny.genesisMismatch).toBe(false);
    // right chain id, absent genesis → still trusted (no genesis to prove)
    expect(verdictFromStats(stats({ genesisHash: null }), PIN_CHAIN, null).trusted).toBe(true);
    // wrong chain id → untrusted, still never a genesis mismatch
    const wrong = verdictFromStats(stats({ chainId: 999, genesisHash: "0xanything" }), PIN_CHAIN, null);
    expect(wrong.trusted).toBe(false);
    expect(wrong.wrongChainId).toBe(true);
    expect(wrong.genesisMismatch).toBe(false);
    // the observed genesis is still recorded (for display), just not judged on
    expect(okAny.observedGenesis).toBe("0xanything");
  });

  it("regenesis is unreachable from custom-chain verdicts (no pin ⇒ no mismatch ⇒ never regenesis)", () => {
    const customVerdicts = [
      verdictFromStats(stats({ genesisHash: "0xa" }), PIN_CHAIN, null),
      verdictFromStats(stats({ chainId: 1, genesisHash: "0xb" }), PIN_CHAIN, null),
    ];
    expect(fleetSignals(customVerdicts).anyGenesisMismatch).toBe(false);
    expect(classifyNoOperatorReason(fleetSignals(customVerdicts))).not.toBe("regenesis");
  });
});

describe("resolveFleet → trusted head or F1-classified cause (§F.7 precedence, not re-derived)", () => {
  const trusted: OperatorVerdict = { url: "a", wrongChainId: false, genesisMismatch: false, quarantined: false, trusted: true, height: 100, headId: "0xh", observedGenesis: "0xh", observedChainId: 69420 };
  const wrongChain: OperatorVerdict = { url: "b", wrongChainId: true, genesisMismatch: false, quarantined: false, trusted: false, height: null, headId: null, observedGenesis: null, observedChainId: 1 };
  const regenesis: OperatorVerdict = { url: "c", wrongChainId: false, genesisMismatch: true, quarantined: false, trusted: false, height: null, headId: null, observedGenesis: "0xother", observedChainId: 69420 };

  // [verdicts, expected kind or "ok"]
  const cases: Array<[string, OperatorVerdict[], "ok" | "untrusted" | "regenesis" | "quarantined" | "offline"]> = [
    ["one trusted operator → ok head (§O5)", [trusted], "ok"],
    ["a trusted operator wins even amid degraded peers (§O5)", [wrongChain, regenesis, trusted], "ok"],
    ["wrong chain id, none trusted → untrusted", [wrongChain], "untrusted"],
    ["right chain wrong genesis, none trusted → regenesis", [regenesis], "regenesis"],
    ["regenesis outranks wrong-chain", [wrongChain, regenesis], "regenesis"],
    ["a unanimous quarantine → quarantined", [quarantinedVerdict("x"), quarantinedVerdict("y")], "quarantined"],
    ["a PARTIAL quarantine is NOT quarantined (unanimity, §G)", [quarantinedVerdict("x"), unreachableVerdict("y")], "offline"],
    ["all unreachable → offline", [unreachableVerdict("x")], "offline"],
    ["empty fleet → offline (never quarantined)", [], "offline"],
  ];

  for (const [name, verdicts, expected] of cases) {
    it(name, () => {
      const res = resolveFleet(verdicts, PIN_CHAIN);
      if (expected === "ok") {
        expect(res.ok).toBe(true);
        if (res.ok) expect(res.chainId).toBe(PIN_CHAIN);
      } else {
        expect(res.ok).toBe(false);
        // map the F1 cause → the kind the banner will show.
        if (!res.ok) {
          const kind = res.cause === "unreachable" ? "offline" : res.cause;
          expect(kind).toBe(expected);
        }
      }
    });
  }

  it("fleetSignals reduces the active set correctly (unanimity requires a non-empty set)", () => {
    expect(fleetSignals([quarantinedVerdict("x"), quarantinedVerdict("y")]).allQuarantined).toBe(true);
    expect(fleetSignals([quarantinedVerdict("x"), unreachableVerdict("y")]).allQuarantined).toBe(false);
    expect(fleetSignals([]).allQuarantined).toBe(false);
    expect(fleetSignals([wrongChain, regenesis]).anyGenesisMismatch).toBe(true);
    expect(fleetSignals([wrongChain]).anyWrongChainId).toBe(true);
  });
});

describe("resolveTrustedHead — fleet + failover + quarantine (health follows the read path)", () => {
  afterEach(() => resetProviderForTest());

  function installActive(impl: () => Promise<ChainStatsResponse>): void {
    const rpcClient = { lythChainStats: impl } as unknown as MonolythiumClient["rpcClient"];
    setProviderForTest({ rpcClient, endpoint: "http://active" });
  }
  const trustedVerdict = (url: string): OperatorVerdict => ({
    url, wrongChainId: false, genesisMismatch: false, quarantined: false, trusted: true, height: 100, headId: "0xh", observedGenesis: "0xh", observedChainId: 69420,
  });

  it("fast path: a trusted active operator resolves to it, no fleet probe", async () => {
    installActive(async () => stats({}));
    const probe = vi.fn() as unknown as typeof probeOperator;
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toBe("http://active");
    expect(probe).not.toHaveBeenCalled(); // the active op was trusted — no failover
  });

  it("failover: an untrusted active op with another trusted operator → the read path moves to it", async () => {
    installActive(async () => ({ ...stats({}), chainId: 1 })); // active on the wrong chain
    const probe: typeof probeOperator = async (url) =>
      url === "http://other" ? trustedVerdict(url) : unreachableVerdict(url);
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.url).toBe("http://other"); // health now reads from the trusted operator
  });

  it("a wrong-chain fleet with no trusted operator → untrusted (§F.7 via F1)", async () => {
    installActive(async () => ({ ...stats({}), chainId: 1 }));
    const probe: typeof probeOperator = async (url) => unreachableVerdict(url);
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.cause).toBe("untrusted");
  });

  it("a unanimously quarantined fleet → quarantined (active -32047 recognized via isQuarantineError)", async () => {
    installActive(async () => {
      throw new Error("upstream unavailable: chain quarantined: reason=CheckpointStateRootMismatch");
    });
    const probe: typeof probeOperator = async (url) => quarantinedVerdict(url);
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.cause).toBe("quarantined");
  });

  it("a partially quarantined fleet is NOT quarantined → offline (§G unanimity)", async () => {
    installActive(async () => {
      throw new Error("chain quarantined");
    });
    const probe: typeof probeOperator = async (url) => unreachableVerdict(url); // other merely unreachable
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.cause).toBe("unreachable");
  });

  it("the builtin path ALWAYS enforces genesis: right chain + wrong genesis → regenesis (G1)", async () => {
    // No active chain set ⇒ builtin ⇒ resolveTrustedHead pins from getChainInfo
    // (non-null genesis). A wrong genesis surfaces a definitive mismatch, proving
    // the null-pin custom branch is never taken for the builtin chain.
    installActive(async () => ({ ...stats({}), genesisHash: "0xwronggenesis00000000" }));
    const probe: typeof probeOperator = async (url) => unreachableVerdict(url);
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.cause).toBe("regenesis");
  });
});

describe("resolveTrustedHead — custom chain active (chain-id-only, no genesis pin)", () => {
  afterEach(() => {
    resetProviderForTest();
    localStorage.clear();
  });

  it("an active operator on the custom chain id is trusted regardless of genesis", async () => {
    // Activate a custom chain (0x539 = 1337) whose rpc is the active endpoint.
    localStorage.setItem(
      USER_CHAINS_KEY,
      JSON.stringify({
        "0x539": { chainId: "0x539", chainIdNum: 1337, name: "Local", rpc: "http://active", official: false, builtin: false },
      }),
    );
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    const rpcClient = {
      lythChainStats: async () => ({ ...stats({}), chainId: 1337, genesisHash: "0xunrelatedgenesis" }),
    } as unknown as MonolythiumClient["rpcClient"];
    setProviderForTest({ rpcClient, endpoint: "http://active" });
    const probe: typeof probeOperator = async (url) => unreachableVerdict(url);
    const res = await resolveTrustedHead(probe);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.url).toBe("http://active");
      expect(res.chainId).toBe(1337);
    }
  });
});

describe("resolveTrustedHead — hot-reload: a saved override changes the walk with no restart", () => {
  afterEach(() => {
    resetProviderForTest();
    localStorage.clear();
  });

  it("walks the newly-saved override fleet on the very next call", async () => {
    // Active operator on the wrong chain so the fleet walk always runs.
    const rpcClient = { lythChainStats: async () => ({ ...stats({}), chainId: 1 }) } as unknown as MonolythiumClient["rpcClient"];
    setProviderForTest({ rpcClient, endpoint: "http://active" });
    const probed: string[] = [];
    const probe: typeof probeOperator = async (url) => {
      probed.push(url);
      return unreachableVerdict(url);
    };

    // Before: the default fleet (the mocked listPeers minus the active op).
    await resolveTrustedHead(probe);
    expect(probed).toEqual(["http://other"]);

    // Save an override — no restart, no reset call. The next resolve walks it.
    probed.length = 0;
    expect(
      writeOperatorOverride([
        { name: "c1", region: "", rpc: "http://custom1:8545" },
        { name: "c2", region: "", rpc: "http://custom2:8545" },
      ]),
    ).toEqual({ ok: true });
    await resolveTrustedHead(probe);
    expect([...probed].sort()).toEqual(["http://custom1:8545", "http://custom2:8545"]);
  });
});

describe("fail-closed seam — getProvider refuses an untrusted operator", () => {
  afterEach(() => resetProviderForTest());

  it("returns the provider when trusted, throws once marked untrusted, recovers when re-trusted", () => {
    setProviderForTest({ rpcClient: {} as MonolythiumClient["rpcClient"], endpoint: "http://op" });

    // Open because setProviderForTest installs a VERIFIED operator — the pair
    // production only ever has together. There is no longer a state in which the
    // seam is open on an assumption; the unverified cold start is its own case,
    // covered in client.test.ts.
    expect(() => getProvider()).not.toThrow();

    markActiveOperatorUntrusted("regenesis");
    expect(() => getProvider()).toThrow(/untrusted operator \(chain regenesis\)/);
    // The probe/endpoint accessor stays usable so recovery can be detected.
    expect(() => getProviderUnchecked()).not.toThrow();
    expect(getProviderUnchecked().endpoint).toBe("http://op");

    markActiveOperatorTrusted();
    expect(getProvider().endpoint).toBe("http://op");
  });
});

describe("the trust read is bounded — a hung operator cannot stall the verdict", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    resetProviderForTest();
  });

  /** An active operator whose `lyth_chainStats` never settles. */
  function installHangingActive(): void {
    const rpcClient = {
      lythChainStats: () => new Promise<ChainStatsResponse>(() => {}),
    } as unknown as MonolythiumClient["rpcClient"];
    setProviderForTest({ rpcClient, endpoint: "http://active" });
  }

  const PENDING = Symbol("pending");
  /** The resolved value, or PENDING when `p` has not settled by now. */
  async function peek<T>(p: Promise<T>): Promise<T | typeof PENDING> {
    return Promise.race([p, Promise.resolve(PENDING)]);
  }

  it("a never-settling active read yields a degraded cause inside one health tick", async () => {
    installHangingActive();
    const probe: typeof probeOperator = async (url) => unreachableVerdict(url);

    const pending = resolveTrustedHead(probe);
    await vi.advanceTimersByTimeAsync(HEALTH_TICK_MS);

    const res = await peek(pending);
    expect(res).not.toBe(PENDING); // unbounded today: the tick never returns
    expect(res).toEqual({ ok: false, cause: "unreachable" });
  });

  it("a never-settling FLEET probe also yields — the failover fan-out is bounded too", async () => {
    // Active operator is on the wrong chain, so the resolver fans out; the fleet
    // probe then hangs. Both legs must be bounded for the tick to complete.
    const rpcClient = {
      lythChainStats: async () => ({ ...stats({}), chainId: 1 }),
    } as unknown as MonolythiumClient["rpcClient"];
    setProviderForTest({ rpcClient, endpoint: "http://active" });
    const probe: typeof probeOperator = () => new Promise<OperatorVerdict>(() => {});

    const pending = resolveTrustedHead(probe);
    await vi.advanceTimersByTimeAsync(HEALTH_TICK_MS);

    const res = await peek(pending);
    expect(res).not.toBe(PENDING);
    expect(res).toEqual({ ok: false, cause: "untrusted" }); // the active op's wrong chain id still classifies
  });

  it("a slow-but-honest operator answering inside the deadline is still trusted", async () => {
    const rpcClient = {
      lythChainStats: () =>
        new Promise<ChainStatsResponse>((resolve) => {
          setTimeout(() => resolve(stats({})), CHAIN_TRUST_TIMEOUT_MS - 1);
        }),
    } as unknown as MonolythiumClient["rpcClient"];
    setProviderForTest({ rpcClient, endpoint: "http://active" });

    const pending = resolveTrustedHead(vi.fn() as unknown as typeof probeOperator);
    await vi.advanceTimersByTimeAsync(CHAIN_TRUST_TIMEOUT_MS);

    const res = await peek(pending);
    expect(res).not.toBe(PENDING);
    expect(res).toMatchObject({ ok: true, url: "http://active" });
  });

  it("the deadline leaves room for BOTH legs inside one tick (active read, then the fan-out)", () => {
    // resolveHeadOverFleet awaits the active operator, then the fleet fan-out —
    // two sequential deadlines. The tick must not overrun its own period.
    expect(CHAIN_TRUST_TIMEOUT_MS * 2).toBeLessThan(HEALTH_TICK_MS);
  });
});

describe("probeActiveChainOperator — the switch-time gate verifies against the SAME pin the tick uses", () => {
  afterEach(() => {
    resetProviderForTest();
    localStorage.clear();
  });

  /** Records the pin each probe was handed, so the gate can be shown to reuse
   *  the resolver's pin selection rather than re-deriving one of its own. */
  function recordingProbe(): { seen: Array<[number, string | null]>; probe: typeof probeOperator } {
    const seen: Array<[number, string | null]> = [];
    return {
      seen,
      probe: async (url, chainId, genesis) => {
        seen.push([chainId, genesis]);
        return unreachableVerdict(url);
      },
    };
  }

  it("the builtin chain is verified on chain id AND genesis", async () => {
    const { seen, probe } = recordingProbe();
    await probeActiveChainOperator("http://candidate", probe);
    expect(seen).toEqual([[PIN_CHAIN, PIN_GENESIS]]);
  });

  it("a custom chain has no genesis to prove, so its pin is chain-id-only (§15)", async () => {
    localStorage.setItem(
      USER_CHAINS_KEY,
      JSON.stringify({
        "0x539": { chainId: "0x539", chainIdNum: 1337, name: "Local", rpc: "http://local", official: false, builtin: false },
      }),
    );
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539");
    const { seen, probe } = recordingProbe();
    await probeActiveChainOperator("http://candidate", probe);
    expect(seen).toEqual([[1337, null]]);
  });

  it("returns the candidate's own verdict — the caller decides what to do with it", async () => {
    const trusted: typeof probeOperator = async (url) => ({
      url, wrongChainId: false, genesisMismatch: false, quarantined: false, trusted: true,
      height: 9, headId: "0xh", observedGenesis: PIN_GENESIS, observedChainId: PIN_CHAIN,
    });
    await expect(probeActiveChainOperator("http://good", trusted)).resolves.toMatchObject({
      url: "http://good",
      trusted: true,
    });
    await expect(probeActiveChainOperator("http://bad", async (u) => unreachableVerdict(u))).resolves.toMatchObject({
      trusted: false,
    });
  });
});
