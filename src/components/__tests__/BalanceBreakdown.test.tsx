// BalanceBreakdown — rendering across the four chain-gap permutations
// the Wallets page might hit.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BalanceBreakdown } from "../BalanceBreakdown";
import type { ChainSnapshot } from "../../sdk/client";
import type { Delegation, PendingRewards } from "../../sdk/staking";

function snapshot(balanceLyth: number, error: ChainSnapshot["error"] = null): ChainSnapshot {
  return {
    endpoint: "http://test.invalid",
    chainId: 69420n,
    balanceLyth,
    balanceWei: "0x0",
    blockHeight: 1n,
    error,
  };
}

const DELS: Delegation[] = [
  { clusterId: 0, clusterName: "C-001", weightBps: 2500, stakeLyth: null, apr: 0.082 },
  { clusterId: 1, clusterName: "C-002", weightBps: 1500, stakeLyth: null, apr: null },
];

const REWARDS_LIVE: PendingRewards = {
  totalLyth: 1.5,
  perCluster: [],
  lastClaimedHeight: 1234n,
  chainGap: null,
};

const REWARDS_GAP: PendingRewards = {
  totalLyth: null,
  perCluster: [],
  lastClaimedHeight: null,
  chainGap: "lyth_pendingRewards not yet emitted",
};

describe("BalanceBreakdown", () => {
  it("renders the real LYTH balance from the chain snapshot", () => {
    render(
      <BalanceBreakdown
        chainSnapshot={snapshot(12.3456)}
        delegations={[]}
        rewards={REWARDS_GAP}
      />,
    );
    expect(screen.getByText(/12\.3456 LYTH/)).toBeInTheDocument();
  });

  it("surfaces staked bps + cluster count when delegations exist", () => {
    render(
      <BalanceBreakdown
        chainSnapshot={snapshot(0)}
        delegations={DELS}
        rewards={REWARDS_GAP}
      />,
    );
    expect(screen.getByText(/4000 bps · 2 clusters/)).toBeInTheDocument();
  });

  it("renders 0 LYTH staked when delegations is empty (not [mock])", () => {
    render(
      <BalanceBreakdown
        chainSnapshot={snapshot(5)}
        delegations={[]}
        rewards={REWARDS_GAP}
      />,
    );
    // Both Staked and Unbonding cells render "0 LYTH" when there are
    // no delegations (§23.2 — Unbonding is always 0 for delegators).
    const zeros = screen.getAllByText("0 LYTH");
    expect(zeros.length).toBe(2);
  });

  it("renders the §23.2 zero-unbonding row regardless of state", () => {
    render(
      <BalanceBreakdown
        chainSnapshot={snapshot(5)}
        delegations={DELS}
        rewards={REWARDS_LIVE}
      />,
    );
    expect(
      screen.getByText(/delegators have no unbonding period/i),
    ).toBeInTheDocument();
  });

  it("renders pending rewards with [mock] when chain-gapped", () => {
    render(
      <BalanceBreakdown
        chainSnapshot={snapshot(5)}
        delegations={[]}
        rewards={REWARDS_GAP}
      />,
    );
    const tags = screen.getAllByText(/\[mock\]/);
    expect(tags.length).toBeGreaterThanOrEqual(1);
  });

  it("renders real pending rewards when live", () => {
    render(
      <BalanceBreakdown
        chainSnapshot={snapshot(5)}
        delegations={[]}
        rewards={REWARDS_LIVE}
      />,
    );
    expect(screen.getByText(/1\.5000 LYTH/)).toBeInTheDocument();
  });
});
