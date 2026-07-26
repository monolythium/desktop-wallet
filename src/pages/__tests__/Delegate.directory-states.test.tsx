// The three directory states, pinned at the DOM.
//
// The unit tests in sdk/__tests__/cluster-directory-reading.test.ts pin the
// classifier. These pin what the PAGE does with it, because the defect being
// guarded was never in the arithmetic — it was that a query error and a genuine
// absence rendered as the same sentence, under an invitation to pick from a
// list that was not there.
//
// Source-scan guards have failed on this page before; these are behavioural.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { LiveDelegationStatus } from "../../sdk/live";

const walletMock = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../../sdk/active-wallet", () => ({ useActiveWallet: () => walletMock.value }));

vi.mock("../../operations/context", () => ({
  OperationsProvider: ({ children }: { children: ReactNode }) => children,
  useOperations: () => ({ open: () => {}, close: () => {} }),
}));

const live = vi.hoisted(() => ({
  loadLiveDelegationStatus: vi.fn(),
  loadNativeBalanceLythoshi: vi.fn(),
  empty: vi.fn(),
}));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveDelegationStatus: live.loadLiveDelegationStatus,
  loadNativeBalanceLythoshi: live.loadNativeBalanceLythoshi,
  loadLiveClusterAprBpsMap: live.empty,
  loadLiveClusterDelegatorCount: live.empty,
  loadLiveClusterEntities: live.empty,
  loadLiveClusterNames: live.empty,
  loadLiveClusterStatus: live.empty,
}));

const del = vi.hoisted(() => ({
  fetchClusterDirectory: vi.fn(),
  fetchPendingRewards: vi.fn(),
  fetchRedemptionQueue: vi.fn(),
}));
vi.mock("../../sdk/delegation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/delegation")>()),
  fetchClusterDirectory: del.fetchClusterDirectory,
  fetchPendingRewards: del.fetchPendingRewards,
  fetchRedemptionQueue: del.fetchRedemptionQueue,
}));
vi.mock("../../sdk/autovote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/autovote")>()),
  fetchClusterDiversities: vi.fn(() => Promise.resolve(new Map())),
}));

import { DIRECTORY_INCONSISTENT_MESSAGE } from "../../sdk/cluster-directory";
import { Delegate } from "../Delegate";

const READY = {
  status: "ready",
  slot: "s1",
  name: "W",
  addressHex: "0x00dead",
  address: "mono1delegatetest",
};

/** A wallet with no delegations, so the "pick a cluster" invitation is the
 *  branch under test. */
function statusWithNoDelegations(): LiveDelegationStatus {
  const okEmpty = { ok: true, value: [] };
  return {
    endpoint: "test",
    clusters: okEmpty,
    activeClusters: okEmpty,
    healthyClusters: okEmpty,
    delegationCap: { ok: true, value: { capBps: 5000 } },
    delegations: {
      ok: true,
      value: { wallet: READY.address, rows: [], totalBps: 0, block: 0 },
    },
    delegationHistory: { ok: true, value: [] },
  } as unknown as LiveDelegationStatus;
}

const INVITATION = /pick a cluster from the directory below/i;

beforeEach(() => {
  vi.clearAllMocks();
  walletMock.value = READY;
  live.loadLiveDelegationStatus.mockResolvedValue(statusWithNoDelegations());
  live.loadNativeBalanceLythoshi.mockResolvedValue("1000000000000000000000");
  live.empty.mockResolvedValue(new Map());
  del.fetchPendingRewards.mockRejectedValue(new Error("n/a"));
  del.fetchRedemptionQueue.mockRejectedValue(new Error("n/a"));
});

describe("Delegate — a positive total with an empty page is a query error", () => {
  it("says the response contradicted itself, not that there are no clusters", async () => {
    // The exact live response: page 1 of a 0-indexed directory holding four.
    del.fetchClusterDirectory.mockResolvedValue({
      page: 1,
      limit: 20,
      totalClusters: 4,
      clusters: [],
    });
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByText(DIRECTORY_INCONSISTENT_MESSAGE)).toBeInTheDocument();
    });
    // The false fact must be gone...
    expect(screen.queryByText(/this chain has no clusters/i)).toBeNull();
    // ...and so must the invitation to pick from a list we do not have.
    expect(screen.queryByText(INVITATION)).toBeNull();
  });

  it("does not invite the user to pick a cluster when the read failed", async () => {
    del.fetchClusterDirectory.mockRejectedValue(new Error("operator refused"));
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByText(/operator refused/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(INVITATION)).toBeNull();
    expect(screen.queryByText(DIRECTORY_INCONSISTENT_MESSAGE)).toBeNull();
  });

  it("reports a genuinely empty chain as an absence, not an error", async () => {
    del.fetchClusterDirectory.mockResolvedValue({
      page: 0,
      limit: 25,
      totalClusters: 0,
      clusters: [],
    });
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByText(/this chain has no clusters/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(DIRECTORY_INCONSISTENT_MESSAGE)).toBeNull();
    // Nothing to pick from, so nothing is offered.
    expect(screen.queryByText(INVITATION)).toBeNull();
  });

  it("invites the user to pick only when the directory actually listed clusters", async () => {
    del.fetchClusterDirectory.mockResolvedValue({
      page: 0,
      limit: 25,
      totalClusters: 4,
      clusters: [
        { clusterId: 0, size: 10, threshold: 7, aggregateHealth: "ok", regionDiversity: null, active: true },
      ],
    });
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByText(INVITATION)).toBeInTheDocument();
    });
    expect(screen.queryByText(DIRECTORY_INCONSISTENT_MESSAGE)).toBeNull();
    expect(screen.queryByText(/this chain has no clusters/i)).toBeNull();
  });
});
