// Unit tests for genesis + chain-id trust enforcement.
//
// Table-driven over the pure verdict/resolution helpers (the status
// specification §F split: wrong chain id → untrusted; right chain, wrong/absent
// genesis → regenesis / fail-closed), plus the fail-closed seam gate
// (getTrustedProvider refuses an untrusted operator).

import { afterEach, describe, expect, it } from "vitest";
import { getChainInfo } from "@monolythium/core-sdk";
import type { ChainStatsResponse } from "@monolythium/core-sdk";
import {
  NETWORK_SLUG,
  fleetSignals,
  quarantinedVerdict,
  resolveFleet,
  unreachableVerdict,
  verdictFromStats,
  type OperatorVerdict,
} from "../chain-trust";
import {
  getTrustedProvider,
  markActiveOperatorTrusted,
  markActiveOperatorUntrusted,
  resetProviderForTest,
  setProviderForTest,
  type MonolythiumClient,
} from "../client";

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
});

describe("resolveFleet → trusted head or F1-classified cause (§F.7 precedence, not re-derived)", () => {
  const trusted: OperatorVerdict = { url: "a", wrongChainId: false, genesisMismatch: false, quarantined: false, trusted: true, height: 100, headId: "0xh" };
  const wrongChain: OperatorVerdict = { url: "b", wrongChainId: true, genesisMismatch: false, quarantined: false, trusted: false, height: null, headId: null };
  const regenesis: OperatorVerdict = { url: "c", wrongChainId: false, genesisMismatch: true, quarantined: false, trusted: false, height: null, headId: null };

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

describe("fail-closed seam — getTrustedProvider refuses an untrusted operator", () => {
  afterEach(() => resetProviderForTest());

  it("returns the provider when trusted, throws once marked untrusted, recovers when re-trusted", () => {
    setProviderForTest({ rpcClient: {} as MonolythiumClient["rpcClient"], endpoint: "http://op" });

    // Default (not yet checked) is optimistic — the pin is compile-time correct.
    expect(() => getTrustedProvider()).not.toThrow();

    markActiveOperatorUntrusted("regenesis");
    expect(() => getTrustedProvider()).toThrow(/untrusted operator \(chain regenesis\)/);

    markActiveOperatorTrusted();
    expect(getTrustedProvider().endpoint).toBe("http://op");
  });
});
