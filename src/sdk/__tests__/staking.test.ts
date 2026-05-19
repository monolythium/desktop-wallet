// SDK staking seam — happy + error paths for each reader. The
// chain-gapped fields (apr, uptime, reputation, totalStakeLyth,
// pending rewards) are asserted as `null` per the §14 docs gap.

import { describe, expect, it, beforeEach } from "vitest";
// `keccak256("0x6f702d30")` is `keccak256(utf8("op-0"))` — pin
// the hex so we don't trip ethers' BytesLike strictness on raw
// Uint8Array inputs.
import { keccak256 } from "ethers";
import {
  MonolythiumProvider,
  RpcClient,
} from "@monolythium/core-sdk";
import {
  getClusterDetail,
  getClusters,
  getDelegationCap,
  getDelegations,
  getRewards,
} from "../staking";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

interface StakingFixture {
  /** `lyth_clusterDirectory` rows. */
  clusters: Array<{
    clusterId: number;
    size: number;
    threshold: number;
    aggregateHealth: string;
    regionDiversity: string[] | null;
    active: boolean;
  }>;
  /** `lyth_getClusterEntity` per cluster. */
  entities: Record<number, string>;
  /** `lyth_getDelegations` rows for the bound wallet. */
  delegations: Array<{ cluster: number; weightBps: number }>;
  /** `lyth_getDelegationCap` payload. */
  delegationCap: number | null;
  /** `lyth_clusterStatus` payload keyed by cluster id. */
  status?: Record<
    number,
    {
      clusterId: number;
      threshold: number;
      size: number;
      live: number;
      lagging: number;
      offline: number;
      maintenance: number;
      members: Array<{ operatorId: string; blsPubkey: string; state: string }>;
      epoch: number | null;
      round: number | null;
      quorum: string;
      reputationScore: number | null;
      livenessScore: number | null;
      lastUpdateHeight: string;
    }
  >;
  /** `lyth_operatorInfo` payload keyed by operator id. */
  operatorInfo?: Record<
    string,
    {
      operatorId: string;
      moniker: string | null;
      alias: string | null;
      chainAddress: string;
      bonded: boolean;
      commissionBps: number | null;
      delegationCount: number | null;
      bondedAmount: string;
      activeClusterIds: number[];
      operatorKeyFingerprint: string | null;
    }
  >;
}

function makeFetch(fx: StakingFixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const method = body.method as string;
    const params = (body.params ?? []) as unknown[];
    let result: unknown;
    switch (method) {
      case "eth_chainId":
        result = "0x10f2c";
        break;
      case "lyth_clusterDirectory":
      case "lyth_clusters":
        result = {
          page: 0,
          limit: fx.clusters.length,
          totalClusters: fx.clusters.length,
          clusters: fx.clusters,
        };
        break;
      case "lyth_getClusterEntity": {
        const cid = params[0] as number;
        result = {
          cluster: cid,
          entity: fx.entities[cid] ?? "independent",
          entityRaw: 0,
          source: "node-registry",
          block: 1n.toString(),
        };
        break;
      }
      case "lyth_getDelegations":
        result = {
          wallet: params[0],
          rows: fx.delegations,
          totalBps: fx.delegations.reduce((a, r) => a + r.weightBps, 0),
          block: "0x1",
        };
        break;
      case "lyth_getDelegationCap":
        result = {
          capBps: fx.delegationCap ?? 4_294_967_295,
          lastChangedAtHeight: "0x0",
          block: "0x1",
        };
        break;
      case "lyth_clusterStatus": {
        const cid = params[0] as number;
        result = fx.status?.[cid];
        if (!result) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32004, message: `cluster ${cid} not found` },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        break;
      }
      case "lyth_operatorInfo": {
        const oid = params[0] as string;
        result = fx.operatorInfo?.[oid];
        if (!result) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32004, message: `operator ${oid} unknown` },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        break;
      }
      case "lyth_operatorCapabilities":
        result = {
          schemaVersion: 1,
          surfaces: {
            rpc: { status: "active", tracking: "v0.0.1" },
            prover: { status: "degraded", tracking: null },
          },
        };
        break;
      default:
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `unhandled: ${method}` },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id, result }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function installProvider(fx: StakingFixture): void {
  const provider = new MonolythiumProvider(
    new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
  );
  setProviderForTest(provider);
}

const FX: StakingFixture = {
  clusters: [
    {
      clusterId: 0,
      size: 10,
      threshold: 7,
      aggregateHealth: "ok",
      regionDiversity: ["eu-west", "us-east"],
      active: true,
    },
    {
      clusterId: 1,
      size: 10,
      threshold: 7,
      aggregateHealth: "lagging",
      regionDiversity: null,
      active: true,
    },
  ],
  entities: { 0: "mono-labs", 1: "independent" },
  delegations: [{ cluster: 0, weightBps: 5000 }],
  delegationCap: 1000,
  status: {
    0: {
      clusterId: 0,
      threshold: 7,
      size: 10,
      live: 9,
      lagging: 1,
      offline: 0,
      maintenance: 0,
      members: [
        {
          operatorId: keccak256("0x6f702d30"),
          blsPubkey: "0x" + "a".repeat(96),
          state: "active",
        },
      ],
      epoch: 100,
      round: 200,
      quorum: "ok",
      reputationScore: null,
      livenessScore: null,
      lastUpdateHeight: "0x1",
    },
  },
  operatorInfo: {
    [keccak256("0x6f702d30")]: {
      operatorId: keccak256("0x6f702d30"),
      moniker: "Test Op",
      alias: null,
      chainAddress: "0x" + "1".repeat(40),
      bonded: true,
      commissionBps: 500,
      delegationCount: 12,
      bondedAmount: "20000000000000000000000",
      activeClusterIds: [0],
      operatorKeyFingerprint: null,
    },
  },
};

describe("staking SDK seam", () => {
  beforeEach(() => {
    resetProviderForTest();
  });

  it("getClusters synthesises picker rows with chain-gap sentinels for missing signals", async () => {
    installProvider(FX);
    const result = await getClusters();
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(2);
    const foundation = result.value![0]!;
    const indie = result.value![1]!;
    // Foundation badge picked up from the entity flag (§30.5).
    expect(foundation.name).toContain("Foundation");
    expect(foundation.entity).toBe("mono-labs");
    expect(indie.entity).toBe("independent");
    // Chain-gapped fields are null + chainGap is set so the UI can
    // render the [mock] tag.
    expect(foundation.apr).toBeNull();
    expect(foundation.reputation).toBeNull();
    expect(foundation.uptime).toBeNull();
    expect(foundation.totalStakeLyth).toBeNull();
    expect(foundation.chainGap).toMatch(/apr|reputation|uptime/i);
    // Known fields are populated.
    expect(foundation.operatorCount).toBe(10);
    expect(foundation.size).toBe(10);
    expect(foundation.threshold).toBe(7);
  });

  it("getDelegations returns rows with resolved cluster names", async () => {
    installProvider(FX);
    const result = await getDelegations(TEST_ADDRESS);
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);
    const row = result.value![0]!;
    expect(row.clusterId).toBe(0);
    expect(row.weightBps).toBe(5000);
    expect(row.clusterName).toContain("Foundation");
  });

  it("getDelegationCap translates u32::MAX to null (cap disabled)", async () => {
    installProvider({ ...FX, delegationCap: null });
    const result = await getDelegationCap();
    expect(result.ok).toBe(true);
    expect(result.value).toBeNull();
  });

  it("getDelegationCap returns the cap when bounded", async () => {
    installProvider({ ...FX, delegationCap: 1000 });
    const result = await getDelegationCap();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1000);
  });

  it("getRewards returns a chain-gap envelope with per-delegation rows", async () => {
    installProvider(FX);
    const result = await getRewards(TEST_ADDRESS);
    expect(result.ok).toBe(true);
    expect(result.value!.totalLyth).toBeNull();
    expect(result.value!.chainGap).toMatch(/pendingRewards/);
    expect(result.value!.perCluster).toHaveLength(1);
    expect(result.value!.perCluster[0]?.amountLyth).toBeNull();
  });

  it("getClusterDetail composes summary + status + operator rows", async () => {
    installProvider(FX);
    const result = await getClusterDetail(0);
    expect(result.ok).toBe(true);
    expect(result.value!.summary.clusterId).toBe(0);
    expect(result.value!.entity?.entity).toBe("mono-labs");
    expect(result.value!.status.live).toBe(9);
    expect(result.value!.operators).toHaveLength(1);
    expect(result.value!.operators[0]?.moniker).toBe("Test Op");
    expect(result.value!.operators[0]?.capabilities.length).toBe(2);
  });

  it("getClusterDetail surfaces an error envelope on network failure", async () => {
    const fail: typeof fetch = () => Promise.reject(new Error("net down"));
    setProviderForTest(
      new MonolythiumProvider(new RpcClient("http://test.invalid", { fetch: fail })),
    );
    const result = await getClusterDetail(0);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unavailable|net down/i);
  });
});
