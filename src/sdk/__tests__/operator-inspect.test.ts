import { describe, expect, it } from "vitest";
import {
  inspectOperators,
  inspectSummary,
  sortInspectRows,
  toRiskInput,
  type OperatorInspectRow,
} from "../operator-inspect";
import type { Peer, ProbeResult } from "../peers";
import type { OperatorVerdict } from "../chain-trust";

function peer(url: string, over: Partial<Peer> = {}): Peer {
  return { url, label: url, region: null, tier: "official", ...over };
}
function verdict(url: string, over: Partial<OperatorVerdict> = {}): OperatorVerdict {
  return {
    url, wrongChainId: false, genesisMismatch: false, quarantined: false,
    trusted: false, height: null, headId: null, observedGenesis: null, observedChainId: null, ...over,
  };
}
function probe(url: string, over: Partial<ProbeResult> = {}): ProbeResult {
  return { url, reachable: true, latencyMs: 50, chainIdOk: true, ...over };
}
function row(url: string, over: Partial<OperatorInspectRow> = {}): OperatorInspectRow {
  return {
    peer: peer(url),
    verdict: verdict(url),
    probe: probe(url),
    capabilities: { indexer_history: { status: "available" } },
    indexerCurrentHeight: 100,
    indexerLatestHeight: 100,
    ...over,
  };
}

describe("inspectOperators", () => {
  it("folds a never-settling sub-probe to its honest absence at the deadline", async () => {
    const never = new Promise<never>(() => {}); // resolves never
    const rows = await inspectOperators({
      peers: () => [peer("http://a")],
      verdict: () => never,
      reach: () => never,
      caps: () => never,
      indexer: () => never,
      deadlineMs: 20,
    });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.verdict.trusted).toBe(false); // → unreachableVerdict
    expect(r.probe.reachable).toBe(false); // → timed-out probe
    expect(r.probe.error).toBe("timeout");
    expect(r.capabilities).toBeNull();
    expect(r.indexerCurrentHeight).toBeNull();
  });

  it("assembles a row from each sub-probe when they resolve", async () => {
    const rows = await inspectOperators({
      peers: () => [peer("http://a")],
      verdict: async (url) => verdict(url, { trusted: true, height: 9 }),
      reach: async (url) => probe(url, { latencyMs: 42, blockHeight: 9 }),
      caps: async () => ({ indexer_history: { status: "available" } }),
      indexer: async () => ({ current: 8, latest: 9 }),
      deadlineMs: 500,
    });
    const r = rows[0]!;
    expect(r.verdict.trusted).toBe(true);
    expect(r.probe.latencyMs).toBe(42);
    expect(r.indexerCurrentHeight).toBe(8);
    expect(r.indexerLatestHeight).toBe(9);
  });
});

describe("inspectSummary", () => {
  it("live = reachable AND right chain; verified = trusted", () => {
    const rows = [
      row("a", { verdict: verdict("a", { trusted: true }) }), // live + verified
      row("b", { verdict: verdict("b", { trusted: true }), probe: probe("b", { reachable: false, chainIdOk: false }) }), // verified but not live
      row("c", { verdict: verdict("c", { quarantined: true }), probe: probe("c") }), // live, not verified
      row("d", { probe: probe("d", { reachable: true, chainIdOk: false }) }), // reachable wrong chain — not live
    ];
    expect(inspectSummary(rows)).toEqual({ total: 4, live: 2, verified: 2 });
  });
});

describe("sortInspectRows", () => {
  it("verified+reachable first by latency asc; ties + degraded keep catalogue order", () => {
    const rows = [
      row("slow", { verdict: verdict("slow", { trusted: true }), probe: probe("slow", { latencyMs: 300 }) }),
      row("down", { verdict: verdict("down"), probe: probe("down", { reachable: false, chainIdOk: false }) }),
      row("fast", { verdict: verdict("fast", { trusted: true }), probe: probe("fast", { latencyMs: 20 }) }),
      row("down2", { verdict: verdict("down2"), probe: probe("down2", { reachable: false, chainIdOk: false }) }),
    ];
    expect(sortInspectRows(rows).map((r) => r.peer.url)).toEqual(["fast", "slow", "down", "down2"]);
  });

  it("is stable for degraded rows (pure — input unchanged)", () => {
    const rows = [row("x", { verdict: verdict("x") }), row("y", { verdict: verdict("y") })];
    sortInspectRows(rows);
    expect(rows.map((r) => r.peer.url)).toEqual(["x", "y"]);
  });
});

describe("toRiskInput", () => {
  it("maps the row to classifier input; latency null when unreachable", () => {
    const trusted = toRiskInput(row("a", { verdict: verdict("a", { trusted: true }), probe: probe("a", { latencyMs: 77 }) }));
    expect(trusted).toMatchObject({ ok: true, trustedGenesis: true, latencyMs: 77, pendingChange: null });
    const down = toRiskInput(row("b", { probe: probe("b", { reachable: false, chainIdOk: false, latencyMs: 4000 }) }));
    expect(down.ok).toBe(false);
    expect(down.latencyMs).toBeNull(); // no fabricated latency for an unreachable probe
  });
});
