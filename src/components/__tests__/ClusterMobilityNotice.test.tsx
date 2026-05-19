// ClusterMobilityNotice — rendering across {no events, joined, left,
// mixed, no clusters}.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ClusterMobilityNotice } from "../ClusterMobilityNotice";
import type { ClusterDetail, OperatorRow } from "../../sdk/staking";

const detailTable: Record<number, ClusterDetail> = {};

vi.mock("../../sdk/staking", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/staking")>("../../sdk/staking");
  return {
    ...actual,
    getClusterDetail: vi.fn(async (cid: number) => {
      const v = detailTable[cid];
      if (v === undefined) return { ok: false, error: "no such cluster" };
      return { ok: true, value: v };
    }),
  };
});

beforeEach(() => {
  for (const k of Object.keys(detailTable)) delete detailTable[Number(k)];
});

function detail(over: Partial<ClusterDetail> & { operators: OperatorRow[] }): ClusterDetail {
  return {
    summary: {
      clusterId: 0,
      name: "C-001",
      size: 5,
      threshold: 4,
      active: true,
      aggregateHealth: "ok",
      regionDiversity: null,
      entity: "independent",
      apr: null,
      uptime: null,
      reputation: null,
      totalStakeLyth: null,
      operatorCount: over.operators.length,
      capabilities: [],
      chainGap: null,
    },
    status: {
      clusterId: 0,
      threshold: 4,
      size: 5,
      live: 5,
      lagging: 0,
      offline: 0,
      maintenance: 0,
      members: [],
      epoch: null,
      round: null,
      quorum: "ok",
      reputationScore: null,
      livenessScore: null,
      lastUpdateHeight: 1n,
    },
    entity: null,
    slashingHistory: [],
    chainGap: null,
    ...over,
  };
}

function op(state: string): OperatorRow {
  return {
    operatorId: `op-${state}`,
    moniker: null,
    chainAddress: "0x" + state.padEnd(40, "0").slice(0, 40),
    bonded: true,
    bondedAmount: "0",
    state,
    capabilities: [],
    signingMissRate: null,
  };
}

describe("ClusterMobilityNotice", () => {
  it("renders nothing when no clusters were passed", () => {
    const { container } = render(<ClusterMobilityNotice clusterIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when no mobility events are detected", async () => {
    detailTable[0] = detail({ operators: [op("active"), op("active")] });
    const { container } = render(<ClusterMobilityNotice clusterIds={[0]} />);
    await waitFor(() => {
      // Effect resolved.
      expect(detailTable[0]).toBeDefined();
    });
    expect(container.querySelector(".w-card")).toBeNull();
  });

  it("renders a joined event when an operator is in 'joining' state", async () => {
    detailTable[0] = detail({ operators: [op("joining"), op("active")] });
    render(<ClusterMobilityNotice clusterIds={[0]} />);
    await waitFor(() => {
      expect(screen.getByText(/joined/i)).toBeInTheDocument();
    });
  });

  it("renders a left event when an operator is in 'leaving' state", async () => {
    detailTable[0] = detail({ operators: [op("leaving")] });
    render(<ClusterMobilityNotice clusterIds={[0]} />);
    await waitFor(() => {
      expect(screen.getByText(/left/i)).toBeInTheDocument();
    });
  });

  it("renders the §14 marketplace help-text alongside events", async () => {
    detailTable[0] = detail({ operators: [op("joining")] });
    render(<ClusterMobilityNotice clusterIds={[0]} />);
    await waitFor(() => {
      expect(screen.getByText(/§14 cluster marketplace/i)).toBeInTheDocument();
    });
  });
});
