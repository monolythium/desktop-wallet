// Stake page — Phase 2 delegate-flow integration.
//
// Mocks the staking SDK readers so the test owns cluster data, and
// then walks the page through:
//
//   1. Loading state
//   2. "Pick cluster" CTA opens the picker
//   3. Selecting a cluster swaps the picker for the composer
//   4. Editing the weight (bps) toggles validation
//   5. Clicking Delegate opens an OperationsDrawer descriptor
//
// The on-chain step is exercised by `delegation.test.ts` (selector +
// calldata layout) and `staking.test.ts` (reader-side wire shape);
// this test covers the page's UI orchestration.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Stake } from "../Stake";
import { OperationsProvider } from "../../operations/context";

// Mock the SDK readers — the Stake page should never reach the
// network in a unit test. Sample data is built *inside* the factory
// because `vi.mock` is hoisted above module-level `const`s.
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
          apr: null,
          uptime: null,
          reputation: null,
          totalStakeLyth: null,
          operatorCount: 10,
          capabilities: [],
          chainGap: "phase-2 chain gap",
        },
      ],
    }),
  };
});

vi.mock("../../sdk/submit-delegation", () => ({
  submitDelegationCall: vi
    .fn()
    .mockResolvedValue({ txHash: "0x" + "1".repeat(64), from: "0x0", innerSighashHex: "0x", envelopeWireBytes: 256 }),
}));

function renderStake() {
  return render(
    <OperationsProvider>
      <Stake />
    </OperationsProvider>,
  );
}

describe("Stake — delegate flow", () => {
  it("renders the empty-state row-help on first paint", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pick cluster/i })).not.toBeDisabled();
    });
    expect(
      screen.getByText(/open the picker to see live clusters/i),
    ).toBeInTheDocument();
  });

  it("opens the picker on Pick cluster", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pick cluster/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /pick cluster/i }));
    expect(screen.getByLabelText(/search clusters/i)).toBeInTheDocument();
    expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
  });

  it("swaps the picker for the composer on cluster select", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pick cluster/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /pick cluster/i }));
    fireEvent.click(screen.getByText(/C-001 · Foundation/));
    expect(
      screen.getByLabelText(/delegation weight in basis points/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^delegate$/i }),
    ).toBeInTheDocument();
  });

  it("rejects out-of-range weight (>10000) with an inline error", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pick cluster/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /pick cluster/i }));
    fireEvent.click(screen.getByText(/C-001 · Foundation/));
    const input = screen.getByLabelText(/delegation weight in basis points/i);
    fireEvent.change(input, { target: { value: "12000" } });
    expect(screen.getByText(/≤ 10000/)).toBeInTheDocument();
    // Delegate button is disabled while the validator is unhappy.
    expect(screen.getByRole("button", { name: /^delegate$/i })).toBeDisabled();
  });

  it("opens the OperationsDrawer with a delegate descriptor on submit", async () => {
    renderStake();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pick cluster/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /pick cluster/i }));
    fireEvent.click(screen.getByText(/C-001 · Foundation/));
    const input = screen.getByLabelText(/delegation weight in basis points/i);
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /^delegate$/i }));
    // Drawer title surfaces — the OperationsDrawer renders the descriptor.
    await waitFor(() => {
      expect(
        screen.getByText(/Delegate to C-001 · Foundation/),
      ).toBeInTheDocument();
    });
    // The subtitle reproduces the bps + percentage.
    expect(
      screen.getByText(/Allocate 500 bps \(5\.00%\)/i),
    ).toBeInTheDocument();
  });
});
