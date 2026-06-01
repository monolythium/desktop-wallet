import { describe, expect, it } from "vitest";
import type { LiveClusterRow, LiveStakeStatus } from "../live";
import { bpsToPercentLabel, deriveStakeSummary } from "../staking-summary";

function clusterRow(id: number, active = true): LiveClusterRow {
  return {
    clusterId: id,
    size: 7,
    threshold: 5,
    aggregateHealth: "ok",
    regionDiversity: null,
    active,
  };
}

function status(partial: Partial<LiveStakeStatus>): LiveStakeStatus {
  return {
    endpoint: "http://node.test:8545",
    clusters: { ok: true, value: [] },
    activeClusters: { ok: true, value: [] },
    healthyClusters: { ok: true, value: [] },
    delegationCap: { ok: true, value: {} },
    delegations: { ok: true, value: { wallet: "mono1test", rows: [], totalBps: 0, block: null } },
    delegationHistory: { ok: true, value: [] },
    ...partial,
  };
}

describe("bpsToPercentLabel", () => {
  it("formats basis points as a percent (100 bps = 1%)", () => {
    expect(bpsToPercentLabel(1250)).toBe("12.50%");
    expect(bpsToPercentLabel(0)).toBe("0.00%");
    expect(bpsToPercentLabel(10_000)).toBe("100.00%");
  });
});

describe("deriveStakeSummary", () => {
  it("returns an empty, non-fabricated summary for a null status (pre-load)", () => {
    const s = deriveStakeSummary(null);
    expect(s.delegationCount).toBe(0);
    expect(s.totalWeightBps).toBe(0);
    expect(s.totalWeightLabel).toBe("—");
    expect(s.activeClusterCount).toBe(0);
    expect(s.delegationsFailed).toBe(false);
  });

  it("renders an em-dash for staked weight when not delegating", () => {
    const s = deriveStakeSummary(
      status({
        delegations: { ok: true, value: { wallet: "mono1test", rows: [], totalBps: 0, block: null } },
        activeClusters: { ok: true, value: [clusterRow(1), clusterRow(2)] },
      }),
    );
    expect(s.delegationCount).toBe(0);
    expect(s.totalWeightLabel).toBe("—");
    expect(s.activeClusterCount).toBe(2);
  });

  it("sums delegated weight and counts delegations + active clusters", () => {
    const s = deriveStakeSummary(
      status({
        delegations: {
          ok: true,
          value: {
            wallet: "mono1test",
            rows: [
              { cluster: 1, weightBps: 1000 },
              { cluster: 2, weightBps: 250 },
            ],
            totalBps: 1250,
            block: null,
          },
        },
        activeClusters: { ok: true, value: [clusterRow(1), clusterRow(2), clusterRow(3)] },
      }),
    );
    expect(s.delegationCount).toBe(2);
    expect(s.totalWeightBps).toBe(1250);
    expect(s.totalWeightLabel).toBe("12.50%");
    expect(s.activeClusterCount).toBe(3);
  });

  it("surfaces the delegations error verbatim when the read failed", () => {
    const s = deriveStakeSummary(
      status({ delegations: { ok: false, error: "rpc down" } }),
    );
    expect(s.delegationsFailed).toBe(true);
    expect(s.delegationsError).toBe("rpc down");
    expect(s.delegationCount).toBe(0);
    expect(s.totalWeightLabel).toBe("—");
  });
});
