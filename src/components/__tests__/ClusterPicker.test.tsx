// ClusterPicker — rendering, sort, search, selection.
//
// The Phase 2 chain-gap reality means every cluster in this test has
// null APR / reputation / uptime / totalStakeLyth; assertions exercise
// the [mock] fallback path as well as the column rendering.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClusterPicker } from "../ClusterPicker";
import type { ClusterSummary } from "../../sdk/staking";

function makeCluster(over: Partial<ClusterSummary>): ClusterSummary {
  return {
    clusterId: 0,
    name: "C-001",
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
    ...over,
  };
}

const CLUSTERS: ClusterSummary[] = [
  makeCluster({
    clusterId: 0,
    name: "C-001 · Foundation",
    entity: "mono-labs",
    reputation: 4.8,
    apr: 0.082,
    uptime: 0.998,
    totalStakeLyth: 1_000_000,
  }),
  makeCluster({
    clusterId: 1,
    name: "C-002",
    reputation: 4.2,
    apr: 0.095,
    uptime: 0.985,
    totalStakeLyth: 500_000,
  }),
  makeCluster({
    clusterId: 2,
    name: "C-003 · Halcyon",
    reputation: null,
    apr: null,
    uptime: null,
    totalStakeLyth: null,
  }),
];

describe("ClusterPicker", () => {
  it("renders every cluster row", () => {
    render(<ClusterPicker clusters={CLUSTERS} />);
    expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/C-002/)).toBeInTheDocument();
    expect(screen.getByText(/C-003 · Halcyon/)).toBeInTheDocument();
  });

  it("flags Foundation clusters with the `foundation` pill", () => {
    render(<ClusterPicker clusters={CLUSTERS} />);
    expect(screen.getByLabelText(/foundation cluster/i)).toBeInTheDocument();
  });

  it("renders [mock] for chain-gapped stats", () => {
    render(<ClusterPicker clusters={[CLUSTERS[2]!]} />);
    // The picker shows four stat cells per row; all four should mock-tag.
    const tags = screen.getAllByText(/\[mock\]/);
    expect(tags.length).toBeGreaterThanOrEqual(4);
  });

  it("renders the loading affordance when isLoading is true", () => {
    render(<ClusterPicker clusters={[]} isLoading />);
    expect(screen.getByText(/loading clusters/i)).toBeInTheDocument();
  });

  it("renders the error affordance and retry button", () => {
    const onRefresh = vi.fn();
    render(<ClusterPicker clusters={[]} error="boom" onRefresh={onRefresh} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("filters by name on search", () => {
    render(<ClusterPicker clusters={CLUSTERS} />);
    const input = screen.getByLabelText(/search clusters/i);
    fireEvent.change(input, { target: { value: "halcyon" } });
    expect(screen.getByText(/C-003 · Halcyon/)).toBeInTheDocument();
    expect(screen.queryByText(/C-002\b/)).not.toBeInTheDocument();
  });

  it("filters by cluster id substring", () => {
    render(<ClusterPicker clusters={CLUSTERS} />);
    const input = screen.getByLabelText(/search clusters/i);
    fireEvent.change(input, { target: { value: "1" } });
    // Cluster id 1 → C-002, id 0 → C-001 ("1" appears in displayed text). Both should remain.
    expect(screen.getByText(/C-001 · Foundation/)).toBeInTheDocument();
    expect(screen.getByText(/C-002/)).toBeInTheDocument();
    expect(screen.queryByText(/C-003/)).not.toBeInTheDocument();
  });

  it("excludes ids passed via excludeIds", () => {
    render(<ClusterPicker clusters={CLUSTERS} excludeIds={[0]} />);
    expect(screen.queryByText(/Foundation/)).not.toBeInTheDocument();
    expect(screen.getByText(/C-002/)).toBeInTheDocument();
  });

  it("invokes onSelect with the clicked cluster", () => {
    const onSelect = vi.fn();
    render(<ClusterPicker clusters={CLUSTERS} onSelect={onSelect} />);
    fireEvent.click(screen.getByText(/C-002/));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.clusterId).toBe(1);
  });

  it("places null-stat rows last under best-first sort (reputation default)", () => {
    render(<ClusterPicker clusters={CLUSTERS} />);
    const rows = document.querySelectorAll(".w-cluster-row");
    // Foundation (rep 4.8) first, C-002 (rep 4.2) second, C-003 (null) last.
    expect(rows[0]?.getAttribute("data-cluster-id")).toBe("0");
    expect(rows[1]?.getAttribute("data-cluster-id")).toBe("1");
    expect(rows[2]?.getAttribute("data-cluster-id")).toBe("2");
  });
});
