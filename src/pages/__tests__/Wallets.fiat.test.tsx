// The Wallets est-value slots (Phase 07 slots 6–7).
//
// The precedence rule is the whole point here: a `ready` row has an amount, so
// it shows "{symbol}—" (known amount, no rate). Every other row state has NO
// amount, so it keeps the plain "—". Conflating the two would claim the wallet
// knows a balance it has not read.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { saveDisplayCurrency } from "../../sdk/display-prefs";
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

const TITLE = "No LYTH price feed is registered on-chain.";
const ADDRESS_HEX = "0x000000000000000000000000000000000000beef";

function entries(...list: { slot: string; addressHex: string | null }[]): Record<string, VaultEntry> {
  const out: Record<string, VaultEntry> = {};
  list.forEach(({ slot, addressHex }, i) => {
    out[slot] = {
      slot,
      name: `Wallet ${slot}`,
      addressHex,
      createdAt: i + 1,
      kind: "seed" as VaultEntry["kind"],
    };
  });
  return out;
}

/** The per-row est-value line (the `row-help` under each balance). */
function rowEstValues(): string[] {
  return Array.from(document.querySelectorAll(`[title="${TITLE}"]`))
    .filter((el) => el.classList.contains("row-help"))
    .map((el) => el.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  catalog.entries = entries({ slot: "slot-1", addressHex: ADDRESS_HEX });
  live.deriveLiveWalletIdentity.mockResolvedValue({ address: "mono1test", slot: "slot-1" });
  live.loadLiveWalletBalance.mockResolvedValue({
    balanceLyth: "5",
    balanceLythoshi: "5000000000000000000",
  });
});

describe("Wallets — the totals 'Est. value' cell (slot 6)", () => {
  it("renders the empty form with the explanatory tooltip", async () => {
    renderWithProviders(<Wallets />);
    const cell = await screen.findByTestId("fiat-totals");
    expect(cell.textContent).toBe("$—");
    expect(cell.getAttribute("title")).toBe(TITLE);
  });

  it("contains no digit — it never asserts a converted value", async () => {
    renderWithProviders(<Wallets />);
    const cell = await screen.findByTestId("fiat-totals");
    expect(cell.textContent).not.toMatch(/[0-9]/);
    expect(cell.textContent).not.toContain("≈");
  });

  it("follows the selected currency in-session", async () => {
    renderWithProviders(<Wallets />);
    const cell = await screen.findByTestId("fiat-totals");
    expect(cell.textContent).toBe("$—");

    act(() => {
      saveDisplayCurrency("GBP");
    });
    expect(screen.getByTestId("fiat-totals").textContent).toBe("£—");
  });

  it("still renders the empty form when NO balance has loaded (a 0 sum)", async () => {
    // The sum is a real 0 here, not a guess — the counter cell discloses that
    // nothing loaded, exactly as the LYTH total relies on.
    live.loadLiveWalletBalance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Wallets />);
    const cell = await screen.findByTestId("fiat-totals");
    expect(cell.textContent).toBe("$—");
  });
});

describe("Wallets — the per-row est-value line (slot 7)", () => {
  it("a ready row shows the empty form with the tooltip", async () => {
    renderWithProviders(<Wallets />);
    await waitFor(() => expect(rowEstValues()).toContain("$—"));
  });

  it("a loading row keeps the PLAIN dash (the amount is unknown)", async () => {
    live.loadLiveWalletBalance.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<Wallets />);
    await screen.findByText("loading…");
    expect(rowEstValues()).toContain("—");
    expect(rowEstValues()).not.toContain("$—");
  });

  it("an errored row keeps the PLAIN dash", async () => {
    live.loadLiveWalletBalance.mockRejectedValue(new Error("operator down"));
    renderWithProviders(<Wallets />);
    await screen.findByText("unavailable");
    expect(rowEstValues()).toContain("—");
    expect(rowEstValues()).not.toContain("$—");
  });

  it("a row with no derived address keeps the PLAIN dash", async () => {
    catalog.entries = entries({ slot: "slot-2", addressHex: null });
    renderWithProviders(<Wallets />);
    await screen.findByText("unlock to derive");
    expect(rowEstValues()).toContain("—");
    expect(rowEstValues()).not.toContain("$—");
  });

  it("mixed rows: only the ready one is priced", async () => {
    catalog.entries = entries(
      { slot: "slot-1", addressHex: ADDRESS_HEX },
      { slot: "slot-2", addressHex: null },
    );
    renderWithProviders(<Wallets />);
    await waitFor(() => expect(rowEstValues()).toContain("$—"));
    // The unlock-to-derive row still shows the plain dash beside it.
    expect(rowEstValues()).toContain("—");
  });
});
