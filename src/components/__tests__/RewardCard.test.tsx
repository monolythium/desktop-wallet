// RewardCard — rendering across chain-gapped + live states.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RewardCard } from "../RewardCard";
import type { PendingRewards } from "../../sdk/staking";

const CHAIN_GAP: PendingRewards = {
  totalLyth: null,
  perCluster: [
    { clusterId: 0, clusterName: "C-001 · Foundation", amountLyth: null },
    { clusterId: 1, clusterName: "C-002", amountLyth: null },
  ],
  lastClaimedHeight: null,
  chainGap: "lyth_pendingRewards not yet emitted by chain",
};

const LIVE: PendingRewards = {
  totalLyth: 3.1416,
  perCluster: [
    { clusterId: 0, clusterName: "C-001 · Foundation", amountLyth: 2.0 },
    { clusterId: 1, clusterName: "C-002", amountLyth: 1.1416 },
  ],
  lastClaimedHeight: 1234n,
  chainGap: null,
};

describe("RewardCard", () => {
  it("renders [mock] tag + zero-amount em-dash when chain-gapped", () => {
    render(<RewardCard rewards={CHAIN_GAP} />);
    const tags = screen.getAllByText(/\[mock\]/);
    expect(tags.length).toBeGreaterThanOrEqual(1);
    // em-dash placeholder for the headline.
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders the headline amount + per-cluster breakdown when live", () => {
    render(<RewardCard rewards={LIVE} />);
    expect(screen.getByText("3.1416")).toBeInTheDocument();
    expect(screen.getByText(/2\.0000 LYTH/)).toBeInTheDocument();
    expect(screen.getByText(/1\.1416 LYTH/)).toBeInTheDocument();
    expect(screen.getByText(/Last claim at block 1234/)).toBeInTheDocument();
  });

  it("disables 'Claim all' when total is zero or chain-gapped", () => {
    const { rerender } = render(
      <RewardCard rewards={CHAIN_GAP} onClaim={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /claim all/i })).toBeDisabled();
    rerender(
      <RewardCard
        rewards={{ ...LIVE, totalLyth: 0 }}
        onClaim={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /claim all/i })).toBeDisabled();
  });

  it("enables 'Claim all' and fires the callback when total > 0", () => {
    const onClaim = vi.fn();
    render(<RewardCard rewards={LIVE} onClaim={onClaim} />);
    const btn = screen.getByRole("button", { name: /claim all/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onClaim).toHaveBeenCalledTimes(1);
  });

  it("collapses to a single-row hero in compact mode", () => {
    render(<RewardCard rewards={LIVE} compact />);
    expect(screen.getByText("3.1416")).toBeInTheDocument();
    // Per-cluster list is suppressed.
    expect(screen.queryByText("C-001 · Foundation")).not.toBeInTheDocument();
  });
});
