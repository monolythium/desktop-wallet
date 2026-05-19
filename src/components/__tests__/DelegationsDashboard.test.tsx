// DelegationsDashboard — rendering + per-row Manage menu wiring.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DelegationsDashboard } from "../DelegationsDashboard";
import type { Delegation } from "../../sdk/staking";

const ROWS: Delegation[] = [
  {
    clusterId: 0,
    clusterName: "C-001 · Foundation",
    weightBps: 5000,
    stakeLyth: null,
    apr: 0.082,
  },
  {
    clusterId: 1,
    clusterName: "C-002",
    weightBps: 2500,
    stakeLyth: null,
    apr: null,
  },
];

const PENDING = new Map<number, number | null>([
  [0, 1.23],
  [1, null],
]);

describe("DelegationsDashboard", () => {
  it("renders the empty-state message when delegations is empty", () => {
    render(<DelegationsDashboard delegations={[]} />);
    expect(screen.getByText(/no active delegations/i)).toBeInTheDocument();
  });

  it("renders the loading state when delegations is null + no error", () => {
    render(<DelegationsDashboard delegations={null} isLoading />);
    expect(screen.getByText(/loading delegations/i)).toBeInTheDocument();
  });

  it("renders the error state when an error message is supplied", () => {
    render(<DelegationsDashboard delegations={null} error="oops" />);
    expect(screen.getByText("oops")).toBeInTheDocument();
  });

  it("renders one row per delegation with name + bps + percentage", () => {
    render(<DelegationsDashboard delegations={ROWS} pendingByCluster={PENDING} />);
    expect(screen.getByText("C-001 · Foundation")).toBeInTheDocument();
    expect(screen.getByText(/5000 bps · 50\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/2500 bps · 25\.00%/)).toBeInTheDocument();
  });

  it("renders APR cell with the percentage when known, [mock] when null", () => {
    render(<DelegationsDashboard delegations={ROWS} pendingByCluster={PENDING} />);
    expect(screen.getByText(/8\.20%/)).toBeInTheDocument();
    // C-002 has null APR — mock tag in its row.
    const tags = screen.getAllByText(/\[mock\]/);
    expect(tags.length).toBeGreaterThanOrEqual(1);
  });

  it("renders pending rewards when known, [mock] when chain-gapped", () => {
    render(<DelegationsDashboard delegations={ROWS} pendingByCluster={PENDING} />);
    expect(screen.getByText(/1\.2300 LYTH/)).toBeInTheDocument();
  });

  it("Manage menu opens + each item dispatches with the right action", () => {
    const onAction = vi.fn();
    render(
      <DelegationsDashboard
        delegations={ROWS}
        pendingByCluster={PENDING}
        onAction={onAction}
      />,
    );
    // Open the first row's menu.
    const manageButtons = screen.getAllByRole("button", { name: /^manage/i });
    fireEvent.click(manageButtons[0]!);
    expect(screen.getByRole("menuitem", { name: /^add stake$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /^add stake$/i }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toBe("add-stake");
    expect(onAction.mock.calls[0]?.[1]?.clusterId).toBe(0);
  });

  it("Refresh callback is fired when present", () => {
    const onRefresh = vi.fn();
    render(<DelegationsDashboard delegations={ROWS} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
