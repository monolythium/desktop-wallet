// token-activity log decoder — ERC-20 / ERC-721 / ERC-1155 single +
// batch + direction classification.

import { beforeEach, describe, expect, it } from "vitest";
import { AbiCoder } from "ethers";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import { loadTokenActivity } from "../token-activity";
import {
  TOPIC_TRANSFER,
  TOPIC_TRANSFER_BATCH,
  TOPIC_TRANSFER_SINGLE,
} from "../token-discovery";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

const ABI = AbiCoder.defaultAbiCoder();
const COUNTERPARTY = "0xbbbb000000000000000000000000000000000bbb";
const ERC20_CONTRACT = "0xa1aa00000000000000000000000000000000000a";
const ERC721_CONTRACT = "0xbbb0000000000000000000000000000000000002";
const ERC1155_CONTRACT = "0x495f947276749ce646f68ac8c248420045cb7b5e";

function topicFor(addr: string): string {
  return "0x" + addr.toLowerCase().slice(2).padStart(64, "0");
}

interface LogRow {
  address: string;
  topics: string[];
  data?: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

interface Fixture {
  latestBlock: bigint;
  logsByTopic: Record<string, LogRow[]>;
}

function makeFetch(fx: Fixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const ok = (r: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (body.method === "eth_chainId") return ok("0x10f2c");
    if (body.method === "eth_blockNumber") return ok("0x" + fx.latestBlock.toString(16));
    if (body.method === "eth_getLogs") {
      const filter = body.params[0] as { topics: (string | null)[] };
      const topic0 = filter.topics[0];
      if (typeof topic0 !== "string") return ok([]);
      const logs = fx.logsByTopic[topic0.toLowerCase()] ?? [];
      // Filter by holder topic position — naive but tests rely on this
      // matching the per-query topic shape.
      const filtered = logs.filter((log) => {
        for (let i = 1; i < filter.topics.length; i += 1) {
          const expected = filter.topics[i];
          if (expected === null || expected === undefined) continue;
          const actual = log.topics[i];
          if (typeof actual !== "string" || actual.toLowerCase() !== expected.toLowerCase()) {
            return false;
          }
        }
        return true;
      });
      return ok(filtered);
    }
    return ok(null);
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
});

describe("loadTokenActivity · ERC-20 transfers", () => {
  it("decodes an incoming ERC-20 transfer", async () => {
    installProvider({
      latestBlock: 200_000n,
      logsByTopic: {
        [TOPIC_TRANSFER]: [
          {
            address: ERC20_CONTRACT,
            topics: [TOPIC_TRANSFER, topicFor(COUNTERPARTY), topicFor(TEST_ADDRESS)],
            data: ABI.encode(["uint256"], [1_234_000_000n]),
            blockNumber: "0x" + (199_999n).toString(16),
            transactionHash: "0xabc",
            logIndex: "0x0",
          },
        ],
      },
    });
    const out = await loadTokenActivity(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    const rows = out.value ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.kind).toBe("erc20");
    expect(row?.direction).toBe("in");
    expect(row?.counterparty).toBe(COUNTERPARTY.toLowerCase());
    expect(row?.amount).toBe(1_234_000_000n);
  });

  it("decodes an outgoing ERC-20 transfer", async () => {
    installProvider({
      latestBlock: 200_000n,
      logsByTopic: {
        [TOPIC_TRANSFER]: [
          {
            address: ERC20_CONTRACT,
            topics: [TOPIC_TRANSFER, topicFor(TEST_ADDRESS), topicFor(COUNTERPARTY)],
            data: ABI.encode(["uint256"], [5_000_000n]),
            blockNumber: "0x" + (199_999n).toString(16),
            transactionHash: "0xdef",
            logIndex: "0x0",
          },
        ],
      },
    });
    const out = await loadTokenActivity(TEST_ADDRESS);
    const row = out.value?.[0];
    expect(row?.direction).toBe("out");
  });
});

describe("loadTokenActivity · ERC-721 transfers", () => {
  it("decodes ERC-721 with indexed tokenId from topic[3]", async () => {
    installProvider({
      latestBlock: 200_000n,
      logsByTopic: {
        [TOPIC_TRANSFER]: [
          {
            address: ERC721_CONTRACT,
            topics: [
              TOPIC_TRANSFER,
              topicFor(COUNTERPARTY),
              topicFor(TEST_ADDRESS),
              "0x" + (42n).toString(16).padStart(64, "0"),
            ],
            data: "0x",
            blockNumber: "0x" + (199_999n).toString(16),
            transactionHash: "0x721",
            logIndex: "0x0",
          },
        ],
      },
    });
    const out = await loadTokenActivity(TEST_ADDRESS);
    const row = out.value?.[0];
    expect(row?.kind).toBe("erc721");
    expect(row?.tokenId).toBe(42n);
  });
});

describe("loadTokenActivity · ERC-1155 transfers", () => {
  it("decodes a TransferSingle log", async () => {
    installProvider({
      latestBlock: 200_000n,
      logsByTopic: {
        [TOPIC_TRANSFER_SINGLE]: [
          {
            address: ERC1155_CONTRACT,
            topics: [
              TOPIC_TRANSFER_SINGLE,
              topicFor(COUNTERPARTY), // operator
              topicFor(COUNTERPARTY), // from
              topicFor(TEST_ADDRESS), // to
            ],
            data: ABI.encode(["uint256", "uint256"], [7n, 3n]),
            blockNumber: "0x" + (199_999n).toString(16),
            transactionHash: "0x1155single",
            logIndex: "0x0",
          },
        ],
      },
    });
    const out = await loadTokenActivity(TEST_ADDRESS);
    const row = out.value?.[0];
    expect(row?.kind).toBe("erc1155");
    expect(row?.direction).toBe("in");
    expect(row?.tokenId).toBe(7n);
    expect(row?.amount).toBe(3n);
  });

  it("decodes a TransferBatch log by summing the values", async () => {
    installProvider({
      latestBlock: 200_000n,
      logsByTopic: {
        [TOPIC_TRANSFER_BATCH]: [
          {
            address: ERC1155_CONTRACT,
            topics: [
              TOPIC_TRANSFER_BATCH,
              topicFor(COUNTERPARTY),
              topicFor(COUNTERPARTY),
              topicFor(TEST_ADDRESS),
            ],
            data: ABI.encode(
              ["uint256[]", "uint256[]"],
              [
                [1n, 2n, 3n],
                [10n, 20n, 30n],
              ],
            ),
            blockNumber: "0x" + (199_999n).toString(16),
            transactionHash: "0x1155batch",
            logIndex: "0x0",
          },
        ],
      },
    });
    const out = await loadTokenActivity(TEST_ADDRESS);
    const row = out.value?.[0];
    expect(row?.amount).toBe(60n); // 10 + 20 + 30
    expect(row?.tokenId).toBe(1n); // first id
  });
});

describe("loadTokenActivity · sort + dedup + limit", () => {
  it("sorts newest first", async () => {
    installProvider({
      latestBlock: 200_000n,
      logsByTopic: {
        [TOPIC_TRANSFER]: [
          {
            address: ERC20_CONTRACT,
            topics: [TOPIC_TRANSFER, topicFor(COUNTERPARTY), topicFor(TEST_ADDRESS)],
            data: ABI.encode(["uint256"], [1n]),
            blockNumber: "0x1",
            transactionHash: "0xolder",
            logIndex: "0x0",
          },
          {
            address: ERC20_CONTRACT,
            topics: [TOPIC_TRANSFER, topicFor(COUNTERPARTY), topicFor(TEST_ADDRESS)],
            data: ABI.encode(["uint256"], [2n]),
            blockNumber: "0x10",
            transactionHash: "0xnewer",
            logIndex: "0x0",
          },
        ],
      },
    });
    const out = await loadTokenActivity(TEST_ADDRESS);
    expect(out.value?.[0]?.txHash).toBe("0xnewer");
    expect(out.value?.[1]?.txHash).toBe("0xolder");
  });

  it("respects the limit option", async () => {
    const many: LogRow[] = [];
    for (let i = 0; i < 5; i += 1) {
      many.push({
        address: ERC20_CONTRACT,
        topics: [TOPIC_TRANSFER, topicFor(COUNTERPARTY), topicFor(TEST_ADDRESS)],
        data: ABI.encode(["uint256"], [BigInt(i)]),
        blockNumber: "0x" + i.toString(16),
        transactionHash: `0x${i}`,
        logIndex: "0x0",
      });
    }
    installProvider({ latestBlock: 200_000n, logsByTopic: { [TOPIC_TRANSFER]: many } });
    const out = await loadTokenActivity(TEST_ADDRESS, { limit: 3 });
    expect(out.value).toHaveLength(3);
  });
});
