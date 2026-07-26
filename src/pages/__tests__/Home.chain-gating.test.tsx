// Home pauses the balance + confirmed-activity display when the chain isn't live
// (status specification §N/§O — quarantined HIDES the balance). Drives the shared
// health context state-by-state, with a real native balance available, and
// asserts the figure shows when live and is replaced by "—" when quarantined.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ChainHealth } from "../../sdk/chain-health";

const healthMock = vi.hoisted(() => ({ health: { kind: "live", height: 1 } as ChainHealth }));
vi.mock("../../sdk/ChainHealthProvider", () => ({
  useChainHealthView: () => ({ health: healthMock.health, chainId: 69420, endpoint: "x" }),
}));

vi.mock("../../sdk/active-wallet", () => ({
  useActiveWallet: () => ({ status: "ready", address: "0xabc", name: "W" }),
}));

vi.mock("../../sdk/useChainSnapshot", () => ({
  useChainSnapshot: () => ({ status: "loading", snapshot: null }),
}));

// A real native balance (1 LYTH) so the gating is what hides it, not an absent read.
vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveTokenStatus: vi.fn(async () => ({
    endpoint: "x",
    nativeBalance: { ok: true, value: "12.34" },
    nativeBalanceLythoshi: { ok: true, value: "12340000000000000000" }, // 12.34 LYTH
    tokenBalances: { ok: false, error: "n/a" },
    addressLabel: { ok: false, error: "n/a" },
    assetPolicy: { ok: false, error: "n/a" },
  })),
  loadLiveAddressActivity: vi.fn(async () => ({ ok: true, value: [] })),
  loadLiveDelegationStatus: vi.fn(async () => null),
}));

vi.mock("../../sdk/delegation", async (orig) => ({
  ...(await orig<typeof import("../../sdk/delegation")>()),
  fetchPendingRewards: vi.fn(async () => null),
}));

vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(async () => new Map()) }));

import { renderWithProviders } from "../../test/renderWithProviders";
import { Home } from "../Home";

beforeEach(() => {
  healthMock.health = { kind: "live", height: 1 };
});
afterEach(() => vi.clearAllMocks());

describe("Home balance gating on chain health", () => {
  it("shows the balance when the chain is live", async () => {
    healthMock.health = { kind: "live", height: 1 };
    renderWithProviders(<Home goto={() => {}} />);
    expect((await screen.findAllByText(/12.34/)).length).toBeGreaterThan(0);
  });

  it("hides the balance ('—') when the chain is quarantined (§O)", async () => {
    healthMock.health = { kind: "quarantined" };
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findByText("Total balance"); // wait for the async loaders to settle
    expect(screen.queryByText(/12.34/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("hides the balance when untrusted (a wrong-chain read is misleading)", async () => {
    healthMock.health = { kind: "untrusted" };
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findByText("Total balance");
    expect(screen.queryByText(/12.34/)).toBeNull();
  });
});
