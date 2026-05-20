// Token discovery — log scan classification + cache behavior.

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import {
  TOPIC_TRANSFER,
  TOPIC_TRANSFER_BATCH,
  TOPIC_TRANSFER_SINGLE,
  _resetDiscoveryCacheForTest,
  discoverTokens,
} from "../token-discovery";
import { _resetAlldesktop MCP clientsForTest, readdesktop MCP client } from "../log-cursor";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

interface LogStub {
  address: string;
  topics: string[];
}

interface Fixture {
  /** Latest block number (decimal). */
  latestBlock: bigint;
  /** Logs returned by each Transfer query. Keyed by topic0. */
  logs: Record<string, LogStub[]>;
}

function makeFetch(fx: Fixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (body.method === "eth_chainId") return ok("0x10f2c");
    if (body.method === "eth_blockNumber") {
      return ok("0x" + fx.latestBlock.toString(16));
    }
    if (body.method === "eth_getLogs") {
      const filter = body.params[0] as { topics: (string | null)[] };
      const topic0 = filter.topics[0];
      if (typeof topic0 !== "string") return ok([]);
      const logs = fx.logs[topic0.toLowerCase()] ?? [];
      return ok(logs);
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `unhandled: ${body.method}` },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function installProvider(fx: Fixture): void {
  setProviderForTest(
    new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
    ),
  );
}

beforeEach(() => {
  resetProviderForTest();
  _resetDiscoveryCacheForTest();
  _resetAlldesktop MCP clientsForTest();
});

describe("token-discovery · topic hashes", () => {
  it("pins canonical Transfer event topics", () => {
    // Transfer(address,address,uint256) — keccak hash is well known.
    expect(TOPIC_TRANSFER).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
    expect(TOPIC_TRANSFER_SINGLE).toBe(
      "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62",
    );
    expect(TOPIC_TRANSFER_BATCH).toBe(
      "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb",
    );
  });
});

describe("token-discovery · classification", () => {
  it("classifies a 3-topic Transfer as ERC-20", async () => {
    installProvider({
      latestBlock: 200_000n,
      logs: {
        [TOPIC_TRANSFER]: [
          {
            address: "0xaaa0000000000000000000000000000000000001",
            topics: [TOPIC_TRANSFER, "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          },
        ],
      },
    });
    const out = await discoverTokens(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual([
      { contract: "0xaaa0000000000000000000000000000000000001", kind: "erc20" },
    ]);
  });

  it("classifies a 4-topic Transfer as ERC-721", async () => {
    installProvider({
      latestBlock: 200_000n,
      logs: {
        [TOPIC_TRANSFER]: [
          {
            address: "0xbbb0000000000000000000000000000000000002",
            topics: [
              TOPIC_TRANSFER,
              "0x" + "0".repeat(64),
              "0x" + "0".repeat(64),
              "0x" + "0".repeat(63) + "1", // tokenId indexed
            ],
          },
        ],
      },
    });
    const out = await discoverTokens(TEST_ADDRESS);
    expect(out.value?.[0]?.kind).toBe("erc721");
  });

  it("classifies TransferSingle as ERC-1155", async () => {
    installProvider({
      latestBlock: 200_000n,
      logs: {
        [TOPIC_TRANSFER_SINGLE]: [
          {
            address: "0xccc0000000000000000000000000000000000003",
            topics: [TOPIC_TRANSFER_SINGLE, "0x" + "0".repeat(64), "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          },
        ],
      },
    });
    const out = await discoverTokens(TEST_ADDRESS);
    expect(out.value?.[0]?.kind).toBe("erc1155");
  });

  it("classifies TransferBatch as ERC-1155", async () => {
    installProvider({
      latestBlock: 200_000n,
      logs: {
        [TOPIC_TRANSFER_BATCH]: [
          {
            address: "0xddd0000000000000000000000000000000000004",
            topics: [TOPIC_TRANSFER_BATCH, "0x" + "0".repeat(64), "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          },
        ],
      },
    });
    const out = await discoverTokens(TEST_ADDRESS);
    expect(out.value?.[0]?.kind).toBe("erc1155");
  });

  it("deduplicates contracts touched in multiple queries", async () => {
    installProvider({
      latestBlock: 200_000n,
      logs: {
        [TOPIC_TRANSFER]: [
          {
            address: "0xaaa0000000000000000000000000000000000001",
            topics: [TOPIC_TRANSFER, "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          },
          {
            address: "0xaaa0000000000000000000000000000000000001",
            topics: [TOPIC_TRANSFER, "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          },
        ],
      },
    });
    const out = await discoverTokens(TEST_ADDRESS);
    expect(out.value).toHaveLength(1);
  });

  it("returns an empty list when no transfers exist", async () => {
    installProvider({ latestBlock: 200_000n, logs: {} });
    const out = await discoverTokens(TEST_ADDRESS);
    expect(out.value).toEqual([]);
  });
});

describe("token-discovery · scan window", () => {
  it("scans from `latest - 100_000` by default", async () => {
    let captured: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse((init as { body: string }).body);
      const id = body.id;
      const ok = (r: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (body.method === "eth_chainId") return ok("0x10f2c");
      if (body.method === "eth_blockNumber") return ok("0x" + (300_000n).toString(16));
      if (body.method === "eth_getLogs") {
        captured = (body.params[0] as { fromBlock: string }).fromBlock;
        return ok([]);
      }
      return ok(null);
    };
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fetchImpl })),
    );
    await discoverTokens(TEST_ADDRESS);
    // 300_000 - 100_000 = 200_000 = 0x30d40
    expect(captured).toBe("0x30d40");
  });

  it("clamps fromBlock to 0 for early chains", async () => {
    let captured: string | undefined;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse((init as { body: string }).body);
      const id = body.id;
      const ok = (r: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (body.method === "eth_chainId") return ok("0x10f2c");
      if (body.method === "eth_blockNumber") return ok("0x42"); // 66
      if (body.method === "eth_getLogs") {
        captured = (body.params[0] as { fromBlock: string }).fromBlock;
        return ok([]);
      }
      return ok(null);
    };
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fetchImpl })),
    );
    await discoverTokens(TEST_ADDRESS);
    expect(captured).toBe("0x0");
  });
});

describe("token-discovery · cache", () => {
  it("returns cached results without re-scanning", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      callCount += 1;
      const body = JSON.parse((init as { body: string }).body);
      const id = body.id;
      const ok = (r: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (body.method === "eth_chainId") return ok("0x10f2c");
      if (body.method === "eth_blockNumber") return ok("0x" + (200_000n).toString(16));
      return ok([]);
    };
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fetchImpl })),
    );
    await discoverTokens(TEST_ADDRESS);
    const after1 = callCount;
    await discoverTokens(TEST_ADDRESS);
    // Second call should be a cache hit — no new RPC.
    expect(callCount).toBe(after1);
  });

  it("bypasses cache when useCache: false", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      callCount += 1;
      const body = JSON.parse((init as { body: string }).body);
      const id = body.id;
      const ok = (r: unknown) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (body.method === "eth_chainId") return ok("0x10f2c");
      if (body.method === "eth_blockNumber") return ok("0x" + (200_000n).toString(16));
      return ok([]);
    };
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fetchImpl })),
    );
    await discoverTokens(TEST_ADDRESS);
    const after1 = callCount;
    await discoverTokens(TEST_ADDRESS, { useCache: false });
    expect(callCount).toBeGreaterThan(after1);
  });
});

describe("token-discovery · cursor advance", () => {
  it("advances the persisted cursor to latestBlock on each scan", async () => {
    installProvider({ latestBlock: 200_000n, logs: {} });
    await discoverTokens(TEST_ADDRESS);
    const cursor = readdesktop MCP client<Array<unknown>>("discovery", TEST_ADDRESS);
    expect(cursor?.lastBlock).toBe(200_000n);
  });

  it("merges prior cursor payload into the union on incremental scan", async () => {
    // First scan picks up CONTRACT_A.
    installProvider({
      latestBlock: 200_000n,
      logs: {
        [TOPIC_TRANSFER]: [
          {
            address: "0xaaa0000000000000000000000000000000000001",
            topics: [TOPIC_TRANSFER, "0x" + "0".repeat(64), "0x" + "0".repeat(64)],
          },
        ],
      },
    });
    const r1 = await discoverTokens(TEST_ADDRESS);
    expect(r1.value).toHaveLength(1);
    // Reset the discovery freshness cache so the next call doesn't
    // short-circuit on cache. desktop MCP client stays — that's what we're testing.
    _resetDiscoveryCacheForTest();
    // Second scan from cursor+1, no new logs returned, should still
    // include CONTRACT_A via the cursor merge.
    installProvider({ latestBlock: 220_000n, logs: {} });
    const r2 = await discoverTokens(TEST_ADDRESS);
    expect(r2.value).toHaveLength(1);
    expect(r2.value?.[0]?.contract).toBe("0xaaa0000000000000000000000000000000000001");
  });

  it("force-rescan clears the cursor", async () => {
    installProvider({ latestBlock: 200_000n, logs: {} });
    await discoverTokens(TEST_ADDRESS);
    expect(readdesktop MCP client("discovery", TEST_ADDRESS)).not.toBeNull();
    _resetDiscoveryCacheForTest();
    installProvider({ latestBlock: 220_000n, logs: {} });
    await discoverTokens(TEST_ADDRESS, { useCache: false });
    const cursor = readdesktop MCP client<Array<unknown>>("discovery", TEST_ADDRESS);
    // After the force-rescan the cursor was cleared THEN repopulated
    // to 220k — proves the clear ran (would otherwise stay at 200k
    // if the cursor branch took the incremental fast-path).
    expect(cursor?.lastBlock).toBe(220_000n);
  });
});
