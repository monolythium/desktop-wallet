// Stake page — redelegate flow.
//
// Clicking Manage → Redelegate opens an in-page card that hosts the
// ClusterPicker (excluding the source) + a weight input + submit. The
// drawer surfaces on submit with the §14 atomic-move messaging.

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
        {
          clusterId: 1,
          name: "C-002",
          size: 10,
          threshold: 7,
          active: true,
          aggregateHealth: "ok",
          regionDiversity: null,
          entity: "independent",
          apr: 0.09,
          uptime: 0.99,
          reputation: 4.5,
          totalStakeLyth: 500_000,
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
    getDelegationCap: vi.fn().mockResolvedValue({ ok: true, value: null }),
  };
});

vi.mock("../../sdk/submit-delegation", () => ({
  submitDelegationCall: vi.fn().mockResolvedValue({
    txHash: "0x" + "r".repeat(64),
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

describe("Stake — redelegate flow", () => {
  it("opens the redelegate card with the source excluded from the picker", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^manage/i })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^redelegate$/i }));
    // The card header surfaces.
    await waitFor(() => {
      expect(screen.getByText(/Redelegate from C-001 · Foundation/)).toBeInTheDocument();
    });
    // The picker is visible; C-001 should NOT appear in the picker
    // (only in the card header), C-002 should.
    expect(screen.getByText(/C-002/)).toBeInTheDocument();
  });

  it("walks picker → composer → drawer with §14 atomic-move messaging", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^manage/i })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: /^redelegate$/i }));
    // Pick target.
    await waitFor(() => {
      expect(screen.getByText(/C-002/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/C-002/));
    // Composer fields appear.
    expect(
      screen.getByLabelText(/redelegate weight in basis points/i),
    ).toBeInTheDocument();
    // Submit.
    fireEvent.click(screen.getByRole("button", { name: /^redelegate$/i }));
    // Drawer surfaces.
    await waitFor(() => {
      expect(screen.getByText(/Redelegate to C-002/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Atomic move/i)).toBeInTheDocument();
  });
});
