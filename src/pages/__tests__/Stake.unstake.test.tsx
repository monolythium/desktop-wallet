// Stake page — unstake flow.
//
// The unstake flow opens an OperationsDrawer when the user picks
// "Unstake" from a delegation row's Manage menu. The drawer shows
// the correct §23.2 messaging (no unbonding period — funds
// immediate) and on approve calls `encodeUndelegate` +
// `submitDelegationCall`.
//
// This test mocks the SDK readers + the submitter so the test is
// hermetic; the actual encoder and submitter behaviour is covered
// elsewhere (delegation.test.ts + staking.test.ts).

import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Stake } from "../Stake";
import { OperationsProvider } from "../../operations/context";

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
          regionDiversity: null,
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
    getDelegations: vi.fn().mockResolvedValue({
      ok: true,
      value: [
        {
          clusterId: 0,
          clusterName: "C-001 · Foundation",
          weightBps: 5000,
          stakeLyth: null,
          apr: 0.082,
        },
      ],
    }),
    getRewards: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        totalLyth: null,
        perCluster: [],
        lastClaimedHeight: null,
        chainGap: "phase-2",
      },
    }),
    getDelegationCap: vi
      .fn()
      .mockResolvedValue({ ok: true, value: null }),
  };
});

vi.mock("../../sdk/submit-delegation", () => ({
  submitDelegationCall: vi.fn().mockResolvedValue({
    txHash: "0x" + "u".repeat(64),
    from: "0x0",
    innerSighashHex: "0x",
    envelopeWireBytes: 256,
  }),
}));

function renderStake() {
  return render(
    <OperationsProvider>
      <Stake />
    </OperationsProvider>,
  );
}

describe("Stake — unstake flow", () => {
  it("opens the unstake drawer with the §23.2 no-cooldown messaging", async () => {
    renderStake();
    // Wait for the row to render.
    await waitFor(() => {
      expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
    });
    // Open the row's Manage menu.
    fireEvent.click(screen.getAllByRole("button", { name: /^manage/i })[0]!);
    // Click Unstake.
    fireEvent.click(screen.getByRole("menuitem", { name: /^unstake$/i }));
    // The drawer's title surfaces.
    await waitFor(() => {
      expect(screen.getByText(/Unstake from C-001 · Foundation/)).toBeInTheDocument();
    });
    // The "no unbonding period" guidance is surfaced.
    expect(screen.getByText(/funds available immediately/i)).toBeInTheDocument();
    // The subtitle echoes the full weight.
    expect(screen.getByText(/Remove all 5000 bps/i)).toBeInTheDocument();
  });
});
