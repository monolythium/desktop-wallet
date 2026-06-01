import { describe, expect, it, vi } from "vitest";
import {
  chainIdMatches,
  latencyBucket,
  listPeers,
  parseHexQuantity,
  pickFastest,
  probePeer,
  TESTNET_CHAIN_ID_HEX,
  type ProbeResult,
} from "../peers";

// ── A small fetch double that maps a per-URL queue of JSON-RPC replies. ──
// `eth_chainId` is the first call per URL; `eth_blockNumber` (if reached) is
// the second. Each entry is either a body object, a thrown error, or "abort".
type Reply =
  | { result: unknown }
  | { error: { message: string } }
  | { httpStatus: number }
  | { throws: string };

function makeFetch(byUrl: Record<string, Reply[]>): typeof fetch {
  const cursors: Record<string, number> = {};
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const queue = byUrl[url] ?? [];
    const i = cursors[url] ?? 0;
    cursors[url] = i + 1;
    const reply = queue[i] ?? { result: TESTNET_CHAIN_ID_HEX };
    if ("throws" in reply) throw new Error(reply.throws);
    if ("httpStatus" in reply) {
      return new Response("", { status: reply.httpStatus });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...reply }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function probe(over: Partial<ProbeResult>): ProbeResult {
  return { url: "http://p", reachable: true, latencyMs: 50, chainIdOk: true, ...over };
}

describe("parseHexQuantity", () => {
  it("parses hex strings, decimal strings, and numbers", () => {
    expect(parseHexQuantity("0x10f2c")).toBe(69420);
    expect(parseHexQuantity("0x10F2C")).toBe(69420);
    expect(parseHexQuantity("69420")).toBe(69420);
    expect(parseHexQuantity(69420)).toBe(69420);
  });

  it("returns undefined for unparseable input", () => {
    expect(parseHexQuantity("")).toBeUndefined();
    expect(parseHexQuantity("zzz")).toBeUndefined();
    expect(parseHexQuantity(null)).toBeUndefined();
    expect(parseHexQuantity({})).toBeUndefined();
  });
});

describe("chainIdMatches", () => {
  it("accepts the testnet id in hex and decimal, rejects others", () => {
    expect(chainIdMatches("0x10f2c")).toBe(true);
    expect(chainIdMatches("69420")).toBe(true);
    expect(chainIdMatches("0x1")).toBe(false);
    expect(chainIdMatches("0x539")).toBe(false); // 1337
    expect(chainIdMatches(null)).toBe(false);
  });
});

describe("latencyBucket", () => {
  it("buckets by the ok/warn thresholds", () => {
    expect(latencyBucket(10)).toBe("ok");
    expect(latencyBucket(119)).toBe("ok");
    expect(latencyBucket(120)).toBe("warn");
    expect(latencyBucket(349)).toBe("warn");
    expect(latencyBucket(350)).toBe("slow");
    expect(latencyBucket(5000)).toBe("slow");
  });
});

describe("listPeers", () => {
  it("lists the gateway first, then the official endpoints, de-duped", () => {
    const peers = listPeers();
    expect(peers.length).toBeGreaterThan(1);
    expect(peers[0]!.tier).toBe("gateway");
    expect(peers[0]!.label).toBe("Public gateway");
    const urls = peers.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length); // no duplicates
    // Official endpoints carry a region + a notes-derived label.
    const official = peers.find((p) => p.tier === "official");
    expect(official).toBeDefined();
    expect(official!.region).toBeTruthy();
  });
});

describe("probePeer (response parsing)", () => {
  it("marks a matching-chain peer reachable + eligible with a block height", async () => {
    const fetchImpl = makeFetch({
      "http://good": [{ result: TESTNET_CHAIN_ID_HEX }, { result: "0x3e8" }],
    });
    const r = await probePeer("http://good", fetchImpl);
    expect(r.reachable).toBe(true);
    expect(r.chainIdOk).toBe(true);
    expect(r.blockHeight).toBe(1000);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("marks a wrong-chain peer reachable but NOT eligible (no fabrication)", async () => {
    const fetchImpl = makeFetch({ "http://wrong": [{ result: "0x1" }] });
    const r = await probePeer("http://wrong", fetchImpl);
    expect(r.reachable).toBe(true);
    expect(r.chainIdOk).toBe(false);
    expect(r.blockHeight).toBeUndefined();
  });

  it("treats a JSON-RPC error body as reachable-but-ineligible", async () => {
    const fetchImpl = makeFetch({ "http://err": [{ error: { message: "boom" } }] });
    const r = await probePeer("http://err", fetchImpl);
    expect(r.reachable).toBe(true);
    expect(r.chainIdOk).toBe(false);
    expect(r.error).toBe("boom");
  });

  it("treats a non-200 HTTP response as unreachable", async () => {
    const fetchImpl = makeFetch({ "http://down": [{ httpStatus: 502 }] });
    const r = await probePeer("http://down", fetchImpl);
    expect(r.reachable).toBe(false);
    expect(r.chainIdOk).toBe(false);
    expect(r.error).toBe("HTTP 502");
  });

  it("treats a thrown fetch (network error) as unreachable", async () => {
    const fetchImpl = makeFetch({ "http://dead": [{ throws: "ECONNREFUSED" }] });
    const r = await probePeer("http://dead", fetchImpl);
    expect(r.reachable).toBe(false);
    expect(r.chainIdOk).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("still reports reachable+eligible when eth_blockNumber fails", async () => {
    const fetchImpl = makeFetch({
      "http://noheight": [{ result: TESTNET_CHAIN_ID_HEX }, { throws: "height failed" }],
    });
    const r = await probePeer("http://noheight", fetchImpl);
    expect(r.reachable).toBe(true);
    expect(r.chainIdOk).toBe(true);
    expect(r.blockHeight).toBeUndefined();
  });
});

describe("pickFastest", () => {
  it("returns null when no peer is reachable + on-chain", () => {
    expect(pickFastest([])).toBeNull();
    expect(
      pickFastest([
        probe({ url: "a", reachable: false }),
        probe({ url: "b", chainIdOk: false }),
      ]),
    ).toBeNull();
  });

  it("never selects a reachable-but-wrong-chain peer even if it is fastest", () => {
    const winner = pickFastest([
      probe({ url: "wrong", latencyMs: 5, chainIdOk: false }),
      probe({ url: "right", latencyMs: 80, chainIdOk: true }),
    ]);
    expect(winner?.url).toBe("right");
  });

  it("picks the lowest latency among eligible peers", () => {
    const winner = pickFastest([
      probe({ url: "slow", latencyMs: 300 }),
      probe({ url: "fast", latencyMs: 40 }),
      probe({ url: "mid", latencyMs: 120 }),
    ]);
    expect(winner?.url).toBe("fast");
  });

  it("breaks a latency tie by the higher block height", () => {
    const winner = pickFastest([
      probe({ url: "low", latencyMs: 50, blockHeight: 100 }),
      probe({ url: "high", latencyMs: 50, blockHeight: 200 }),
    ]);
    expect(winner?.url).toBe("high");
  });
});
