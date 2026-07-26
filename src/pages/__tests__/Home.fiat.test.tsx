// The Home hero fiat sub-line (Phase 07 slot 1).
//
// Two absences are distinct and must not be conflated: a bare "—" in the hero
// means the AMOUNT is unavailable, so no fiat line renders at all; "{symbol}—"
// means the amount is known and no rate exists. The line is also an ADDITIVE
// SIBLING — the canonical amount node never gains a fiat byte.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
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

const balanceMock = vi.hoisted(() => ({
  lythoshi: { ok: true, value: "12340000000000000000" } as { ok: boolean; value?: string | null },
}));

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveTokenStatus: vi.fn(async () => ({
    endpoint: "x",
    nativeBalance: { ok: true, value: "12.34" },
    nativeBalanceLythoshi: balanceMock.lythoshi,
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
import { saveDisplayCurrency } from "../../sdk/display-prefs";

function fiatNode(): Element | null {
  return document.querySelector(".w-hero__fiat");
}

beforeEach(() => {
  localStorage.clear();
  healthMock.health = { kind: "live", height: 1 };
  balanceMock.lythoshi = { ok: true, value: "12340000000000000000" };
});
afterEach(() => vi.clearAllMocks());

describe("Home hero fiat sub-line", () => {
  it("renders the empty form under a live, funded hero (USD default)", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText(/12.34/);
    expect(fiatNode()?.textContent).toBe("$—");
  });

  it("contains no digit — it never asserts a value", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText(/12.34/);
    expect(fiatNode()?.textContent).not.toMatch(/[0-9]/);
    expect(fiatNode()?.textContent).not.toContain("≈");
  });

  it("follows the selected currency in-session, with no remount", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText(/12.34/);
    const before = fiatNode();
    expect(before?.textContent).toBe("$—");

    act(() => {
      saveDisplayCurrency("EUR");
    });

    expect(fiatNode()?.textContent).toBe("€—");
    // Same DOM node — the slot re-rendered, the hero did not remount.
    expect(fiatNode()).toBe(before);
  });

  it("seeds from a stored currency on the first frame", async () => {
    localStorage.setItem("wallet.displayCurrency", "JPY");
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText(/12.34/);
    expect(fiatNode()?.textContent).toBe("¥—");
  });

  it("is ABSENT ENTIRELY when the chain is not live (not a dashed line)", async () => {
    healthMock.health = { kind: "quarantined", reason: "test" } as unknown as ChainHealth;
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText("—");
    expect(fiatNode()).toBeNull();
  });

  it("is ABSENT ENTIRELY when the balance itself is unknown", async () => {
    balanceMock.lythoshi = { ok: false };
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText("—");
    expect(fiatNode()).toBeNull();
  });

  it("leaves the canonical amount node byte-untouched (sibling law)", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText(/12.34/);
    const amount = document.querySelector(".w-hero__amount");
    // The canonical figure + its unit, and nothing else.
    expect(amount?.textContent).toBe("12.34LYTH");
    expect(amount?.textContent).not.toContain("$");
    expect(amount?.textContent).not.toContain("≈");
    // The fiat line is a SEPARATE node, not nested inside the amount.
    expect(amount?.querySelector(".w-hero__fiat")).toBeNull();
  });

  it("exactly ONE fiat rendering exists for the balance figure", async () => {
    // The hero meta row that used to repeat the balance is gone (the chip pair
    // carries both quantities now), so the "one figure, one fiat rendering"
    // property is stronger than when this test was written: there is only one
    // balance figure on the hero, and only one fiat node beside it.
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByText(/12.34/);
    expect(document.querySelectorAll(".w-hero__fiat")).toHaveLength(1);
    expect(document.querySelector(".w-hero__meta")).toBeNull();

    // The chips carry figures but never a fiat string of their own.
    const chips = document.querySelector('[data-testid="hero-chips"]');
    expect(chips?.textContent).not.toContain("$");
    expect(chips?.textContent).not.toContain("≈");
  });
});
