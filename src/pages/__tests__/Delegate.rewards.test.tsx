// The rewards figures the wallet is willing to state.
//
// Two numbers were wrong in different ways:
//
//  - The PER-CLUSTER figure was drawn from `rows[].unsettledAmountLythoshi`,
//    which carries no settled component. Every settling operation (claim,
//    delegate, undelegate, redelegate, enable auto-compound — they all run
//    settle_in_order) sweeps the per-cluster deltas into a wallet-level pot that
//    has no cluster attribution, so the per-cluster figures collapse toward zero
//    while the wallet total stays right. They never summed to the total and
//    could not be made to: the chain does not expose a per-cluster total.
//
//  - The WALLET-LEVEL figure was split into "Settled" and "Unsettled", which is
//    a real storage boundary with no user consequence. claim() settles first and
//    pays the combined total in one transaction, so no user can act on either
//    half alone.
//
// Behavioural, not source-scanning: source-scan guards have failed on this page.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { Delegate } from "../Delegate";

const READY = {
  status: "ready",
  slot: "s1",
  name: "W",
  addressHex: "0x00dead",
  address: "mono1delegatetest",
};
const CLUSTER = 2;

/** 7 LYTH in lythoshi, hex — a figure distinctive enough to search the DOM for. */
const SEVEN_LYTH_HEX = "0x6124fee993bc0000";

function statusWithRow(weightBps: number): LiveDelegationStatus {
  const okEmpty = { ok: true, value: [] };
  return {
    endpoint: "test",
    clusters: okEmpty,
    activeClusters: okEmpty,
    healthyClusters: okEmpty,
    delegationCap: { ok: true, value: { capBps: 5000 } },
    delegations: {
      ok: true,
      value: {
        wallet: READY.address,
        rows: [{ cluster: CLUSTER, weightBps }],
        totalBps: weightBps,
        block: 0,
      },
    },
    delegationHistory: { ok: true, value: [] },
  } as unknown as LiveDelegationStatus;
}

beforeEach(() => {
  vi.clearAllMocks();
  walletMock.value = READY;
  live.loadLiveDelegationStatus.mockResolvedValue(statusWithRow(3000));
  live.loadNativeBalanceLythoshi.mockResolvedValue("1000000000000000000000");
  live.empty.mockResolvedValue(new Map());
  del.fetchRedemptionQueue.mockRejectedValue(new Error("n/a"));
  del.fetchClusterDirectory.mockResolvedValue({
    page: 0,
    limit: 25,
    totalClusters: 1,
    clusters: [
      {
        clusterId: CLUSTER,
        size: 10,
        threshold: 7,
        aggregateHealth: "ok",
        regionDiversity: null,
        active: true,
      },
    ],
  });
  del.fetchPendingRewards.mockResolvedValue({
    wallet: READY.address,
    totalAmountLythoshi: SEVEN_LYTH_HEX,
    settledPendingLythoshi: "0x0",
    unsettledAmountLythoshi: SEVEN_LYTH_HEX,
    autoCompound: false,
    rows: [{ cluster: CLUSTER, weightBps: 3000, unsettledAmountLythoshi: SEVEN_LYTH_HEX }],
    block: 0,
  });
});

describe("Delegate — the per-cluster reward figure the chain cannot complete", () => {
  it("states the cluster weight but no per-cluster reward amount", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /more details/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /more details/i }));

    // The weight is a complete fact and stays.
    await waitFor(() => {
      expect(screen.getByText(/weight 30\.00%/i)).toBeInTheDocument();
    });

    // "7 LYTH" attributed to this cluster is the incomplete figure. It must be
    // gone from the detail — not relabelled, not rounded, gone. (The wallet-
    // LEVEL split is a separate concern, covered below.)
    expect(screen.queryByText(/7 LYTH unsettled/i)).toBeNull();
    expect(screen.queryByText(/LYTH unsettled/i)).toBeNull();
  });

  it("shows one wallet-level pending figure and no accounting split", async () => {
    renderWithProviders(<Delegate />);

    // The one number: totalAmountLythoshi, which claim() actually pays out.
    await waitFor(() => {
      expect(screen.getByText("7 LYTH")).toBeInTheDocument();
    });

    // Neither jargon term survives anywhere on the page. /settled/i catches
    // "Unsettled" too, so this is one assertion for both words.
    expect(screen.queryByText(/settled/i)).toBeNull();
  });

  it("explains pending rewards in words a first-time user can act on", async () => {
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByText(/earned from delegating/i)).toBeInTheDocument();
    });
  });

  it("says why there is no per-cluster figure, so the absence reads as deliberate", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Delegate />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /more details/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /more details/i }));

    // A silent gap reads as a loading failure; this one is a chain limit.
    await waitFor(() => {
      expect(screen.getByText(/claimed for the whole wallet/i)).toBeInTheDocument();
    });
  });
});
