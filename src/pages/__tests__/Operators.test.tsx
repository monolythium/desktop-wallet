// Operators page — picker + detail panel.

import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Operators } from "../Operators";

vi.mock("../../sdk/staking", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/staking")>(
    "../../sdk/staking",
  );
  return {
    ...actual,
    getClusters: vi.fn().mockResolvedValue({
      ok: true,
      value: [
        {
          clusterId: 0,
          name: "C-001 · Foundation",
          size: 10,
          threshold: 7,
          active: true,
          aggregateHealth: "ok",
          regionDiversity: ["eu-west"],
          entity: "mono-labs",
          apr: 0.082,
          uptime: 0.998,
          reputation: 4.8,
          totalStakeLyth: 1_000_000,
          operatorCount: 10,
          capabilities: [],
          chainGap: null,
        },
      ],
    }),
    getClusterDetail: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        summary: {
          clusterId: 0,
          name: "C-001 · Foundation",
          size: 10,
          threshold: 7,
          active: true,
          aggregateHealth: "ok",
          regionDiversity: ["eu-west"],
          entity: "mono-labs",
          apr: 0.082,
          uptime: 0.998,
          reputation: 4.8,
          totalStakeLyth: 1_000_000,
          operatorCount: 10,
          capabilities: [],
          chainGap: "phase-2 chain gap",
        },
        status: {
          clusterId: 0,
          threshold: 7,
          size: 10,
          live: 9,
          lagging: 1,
          offline: 0,
          maintenance: 0,
          members: [],
          epoch: 100n,
          round: 200n,
          quorum: "ok",
          reputationScore: null,
          livenessScore: null,
          lastUpdateHeight: 1n,
        },
        entity: {
          cluster: 0,
          entity: "mono-labs",
          entityRaw: 0,
          source: "node-registry",
          block: 1n,
        },
        operators: [
          {
            operatorId: "0xop-id-1",
            moniker: "Alice",
            chainAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            bonded: true,
            bondedAmount: "20000000000000000000000",
            state: "active",
            capabilities: [
              { surface: "rpc", status: "active", note: null },
              { surface: "prover", status: "degraded", note: null },
            ],
            signingMissRate: null,
          },
        ],
        slashingHistory: [],
        chainGap: "operator-level capabilities are network-scope today",
      },
    }),
  };
});

describe("Operators page", () => {
  it("renders the idle pane on first load", async () => {
    render(<Operators />);
    await waitFor(() => {
      expect(screen.getByText(/Active cluster set/)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Pick a cluster from the list/i),
    ).toBeInTheDocument();
  });

  it("shows the detail panel after selecting a cluster", async () => {
    render(<Operators />);
    await waitFor(() => {
      expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/C-001 · Foundation/));
    // Detail panel surfaces — Foundation pill, live/lagging counters.
    await waitFor(() => {
      // The cluster name is rendered in BOTH the picker row and the
      // detail card heading. We don't try to disambiguate by element —
      // just assert that "Live" + "9" appear from the status row,
      // proving the detail panel rendered.
      expect(screen.getByText("Live")).toBeInTheDocument();
    });
    expect(screen.getByText("9")).toBeInTheDocument();
    // Operator row with Alice moniker.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Capability chips rendered.
    expect(screen.getByText("rpc")).toBeInTheDocument();
    expect(screen.getByText("prover")).toBeInTheDocument();
    // Chain-gap note surfaces below.
    expect(
      screen.getByText(/operator-level capabilities are network-scope today/i),
    ).toBeInTheDocument();
  });
});
