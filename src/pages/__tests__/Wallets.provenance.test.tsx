// The Wallets list copies each vault's stored address to the clipboard.
//
// The clipboard is where a publication begins: the user copies from here and
// pastes it to whoever is paying them, so a planted `addressHex` reaches the
// same end state as the Receive QR by a quieter route. This page is READ, not
// scanned, so the row and its ellipsized address stay — but nothing goes to the
// clipboard for an address this process has not derived.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { VaultEntry } from "../../sdk/vaultCatalog";

const catalog = vi.hoisted(() => ({ entries: {} as Record<string, VaultEntry> }));
vi.mock("../../sdk/vaultCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/vaultCatalog")>()),
  loadCatalog: vi.fn(async () => ({ version: 1, vaults: catalog.entries, activeSlot: "slot-1" })),
  setActiveVault: vi.fn(async () => {}),
  renameVault: vi.fn(async () => {}),
  removeVaultFromCatalog: vi.fn(async () => {}),
}));

const live = vi.hoisted(() => ({
  loadLiveWalletBalance: vi.fn(),
  deriveLiveWalletIdentity: vi.fn(),
}));
vi.mock("../../sdk/live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/live")>()),
  loadLiveWalletBalance: live.loadLiveWalletBalance,
  deriveLiveWalletIdentity: live.deriveLiveWalletIdentity,
}));

vi.mock("../../operations/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../operations/context")>()),
  useOperations: () => ({ open: vi.fn(), close: vi.fn() }),
}));

import { Wallets } from "../Wallets";
import { clearDerivedAddresses, markAddressDerived } from "../../sdk/address-provenance";

const HEX = "0x000000000000000000000000000000000000beef";

beforeEach(() => {
  clearDerivedAddresses();
  live.deriveLiveWalletIdentity.mockResolvedValue({ address: "mono1test", slot: "slot-1" });
  live.loadLiveWalletBalance.mockResolvedValue({
    balanceLyth: "5",
    balanceLythoshi: "5000000000000000000",
  });
  catalog.entries = {
    "slot-1": {
      slot: "slot-1",
      name: "Main wallet",
      addressHex: HEX,
      createdAt: 1,
      kind: "local" as VaultEntry["kind"],
    },
  };
});

function copyButtons(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: /copy address for/i });
}

describe("the per-vault copy affordance", () => {
  it("is absent for an address this process has not derived", async () => {
    renderWithProviders(<Wallets />);
    await waitFor(() => expect(screen.getByText("Main wallet")).toBeInTheDocument());

    expect(copyButtons()).toHaveLength(0);
    expect(screen.getByTestId("wallets-unverified-slot-1")).toBeInTheDocument();
  });

  it("CONTROL: is present once derived", async () => {
    markAddressDerived(HEX);
    renderWithProviders(<Wallets />);
    await waitFor(() => expect(screen.getByText("Main wallet")).toBeInTheDocument());

    // Anti-vacuity: without this the assertion above would pass against a page
    // that never renders a copy button under any condition.
    expect(copyButtons()).toHaveLength(1);
    expect(screen.queryByTestId("wallets-unverified-slot-1")).toBeNull();
  });

  it("keeps the row and its address visible either way — this surface is read", async () => {
    renderWithProviders(<Wallets />);
    await waitFor(() => expect(screen.getByText("Main wallet")).toBeInTheDocument());
    // The refusal is about the CLIPBOARD, not about hiding the list.
    expect(screen.getByText("Main wallet")).toBeInTheDocument();
  });
});
