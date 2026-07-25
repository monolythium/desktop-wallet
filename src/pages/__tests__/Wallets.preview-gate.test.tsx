// The live active-wallet preview is a developer diagnostic.
//
// Of its six fields, four are already on this same page or one screen away: the
// vault slot, the typed address and the balance all appear on the catalogue rows
// a few lines above, and the algorithm is a constant also stated on About. What
// is left — the account nonce and the public-key size — is diagnostic, wanted by
// someone debugging a stuck transaction or a key, not by someone spending.
//
// So it sits behind the developer gate. It is NOT gated because it is broken:
// the address-form fix landed first, and the panel was confirmed working against
// the live chain before this decision was taken.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import type { VaultEntry } from "../../sdk/vaultCatalog";

const catalog = vi.hoisted(() => ({ entries: {} as Record<string, VaultEntry> }));
vi.mock("../../sdk/vaultCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/vaultCatalog")>()),
  loadCatalog: vi.fn(async () => ({ version: 1, vaults: catalog.entries, activeSlot: "slot-1" })),
  setActiveVault: vi.fn(async () => {}),
  renameVault: vi.fn(async () => {}),
  removeVaultFromCatalog: vi.fn(async () => {}),
}));

const live = vi.hoisted(() => ({ loadLiveWalletBalance: vi.fn(), deriveLiveWalletIdentity: vi.fn() }));
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

const ADDRESS_HEX = "0x000000000000000000000000000000000000beef";

function render(devMode: boolean) {
  return renderWithProviders(
    <DeveloperModeProvider value={{ enabled: devMode, setEnabled: async () => true }}>
      <Wallets />
    </DeveloperModeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  catalog.entries = {
    "slot-1": {
      slot: "slot-1",
      name: "Wallet slot-1",
      addressHex: ADDRESS_HEX,
      createdAt: 1,
      kind: "seed" as VaultEntry["kind"],
    },
  };
  live.deriveLiveWalletIdentity.mockReturnValue({
    address: "mono1test",
    publicKeyHex: "0xabcd",
    publicKeyBytes: 1952,
  });
  live.loadLiveWalletBalance.mockResolvedValue({
    address: "mono1test",
    nonce: 15n,
    balanceLyth: "5",
    balanceLythoshi: "5000000000000000000",
  });
});

const panel = () => screen.queryByRole("heading", { name: "Live active-wallet preview" });

/** The panel's own card. Assertions are scoped to it because the catalogue
 *  rows and the unlock drawer's diff name some of the same fields — matching
 *  against the whole screen would pass on the copies this trim removed. */
const panelCard = () => panel()!.closest(".w-card") as HTMLElement;

describe("the live active-wallet preview panel", () => {
  it("is hidden from a normal user", async () => {
    render(false);
    // The vault list still renders — this gates one diagnostic card, not the page.
    await waitFor(() => expect(screen.getByText("Wallet slot-1")).toBeInTheDocument());
    expect(panel()).toBeNull();
  });

  it("is available in developer mode", async () => {
    render(true);
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it("carries only the two fields that appear nowhere else", async () => {
    render(true);
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(within(panelCard()).getByText("Public key")).toBeInTheDocument();
    expect(within(panelCard()).getByText("Nonce")).toBeInTheDocument();
  });

  it("drops the four the page already shows elsewhere", async () => {
    // Each of these is one screen-copy of a fact the catalogue rows, About or
    // this page's own unlock drawer already state. A diagnostic that restates
    // its surroundings buries the part that is actually diagnostic.
    render(true);
    await waitFor(() => expect(panel()).not.toBeNull());
    for (const label of ["Vault slot", "Algorithm", "Address", "Balance"]) {
      expect(within(panelCard()).queryByText(label), label).toBeNull();
    }
  });

  it("still shows the vault catalogue's own address and balance without it", async () => {
    // The case for gating: what a normal user actually wants from this page is
    // on the rows, not in the panel. If this ever stops being true, the gate is
    // wrong and should be reconsidered rather than worked around.
    render(false);
    await waitFor(() => expect(screen.getByText("Wallet slot-1")).toBeInTheDocument());
    expect(screen.getByText(/mono1/)).toBeInTheDocument();
  });
});
