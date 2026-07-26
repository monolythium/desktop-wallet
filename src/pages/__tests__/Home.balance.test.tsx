// Home's balance presentation, driven by the display ladder.
//
// The protection under test: the wallet never shows a figure it cannot stand
// behind. Specifically hunted here — a fabricated "0.00" while the value is
// still unknown (which reads as "your funds are gone"), and the conflation of
// "loading" with "chain not live".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
  settle: true,
}));

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveTokenStatus: vi.fn(() =>
    balanceMock.settle
      ? Promise.resolve({
          endpoint: "x",
          nativeBalance: { ok: true, value: "12.34" },
          nativeBalanceLythoshi: balanceMock.lythoshi,
          tokenBalances: { ok: false, error: "n/a" },
          addressLabel: { ok: false, error: "n/a" },
          assetPolicy: { ok: false, error: "n/a" },
        })
      : new Promise(() => {}),
  ),
  loadLiveAddressActivity: vi.fn(async () => ({ ok: true, value: [] })),
  loadLiveDelegationStatus: vi.fn(async () => null),
}));

vi.mock("../../sdk/delegation", async (orig) => ({
  ...(await orig<typeof import("../../sdk/delegation")>()),
  fetchPendingRewards: vi.fn(async () => null),
}));

vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(async () => new Map()) }));

// The last-known balance store. `promise`, when set, lets a test control WHEN
// the seed resolves so the seed-vs-live race is observable.
const seedMock = vi.hoisted(() => ({
  value: null as string | null,
  promise: null as Promise<string | null> | null,
}));
const saveMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../sdk/last-known-balance", () => ({
  loadLastKnownBalance: vi.fn(() => seedMock.promise ?? Promise.resolve(seedMock.value)),
  saveLastKnownBalance: saveMock,
}));

import { renderWithProviders } from "../../test/renderWithProviders";
import { Home } from "../Home";
import { BalanceFigure } from "../../components/BalanceFigure";
import { STALE_BALANCE_LABEL, BALANCE_LOADING_LABEL } from "../../sdk/balance-display";

function heroAmount(): Element | null {
  return document.querySelector(".w-hero__amount");
}

beforeEach(() => {
  localStorage.clear();
  healthMock.health = { kind: "live", height: 1 };
  balanceMock.lythoshi = { ok: true, value: "12340000000000000000" };
  balanceMock.settle = true;
  seedMock.value = null;
  seedMock.promise = null;
  saveMock.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("Home hero — the never-fabricated-zero guarantee", () => {
  it("shows a skeleton, NOT 0.00, while the balance read is in flight", async () => {
    balanceMock.settle = false; // never resolves
    const { container } = renderWithProviders(<Home goto={() => {}} />);

    const skeleton = await screen.findAllByLabelText(BALANCE_LOADING_LABEL);
    expect(skeleton.length).toBeGreaterThan(0);
    expect(skeleton[0]!.getAttribute("aria-busy")).toBe("true");
    // The alarming string must appear nowhere on the page.
    expect(container.textContent).not.toContain("0.00");
  });

  it("renders a live zero as 0.00 — an honest zero is a value, not a loading state", async () => {
    balanceMock.lythoshi = { ok: true, value: "0" };
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("0.00LYTH"));
    // …and the HERO figure is not a skeleton. (The Delegated chip legitimately
    // still shows one — that read is unresolved in this fixture.)
    expect(heroAmount()?.querySelector("[aria-busy]")).toBeNull();
  });

  it("renders the live figure at fixed 2 dp", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("12.34LYTH"));
  });

  it("truncates rather than rounding up (never overstates)", async () => {
    balanceMock.lythoshi = { ok: true, value: "99999999999999999999" }; // 99.999…
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("99.99LYTH"));
    expect(heroAmount()?.textContent).not.toContain("100.00");
  });

  it("wraps the fraction in .frac for styling, keeping the integer plain", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("12.34LYTH"));
    expect(heroAmount()?.querySelector(".frac")?.textContent).toBe(".34");
  });
});

describe("Home hero — chain-not-live hides the figure", () => {
  it("shows the dash, not a skeleton and not a number", async () => {
    healthMock.health = { kind: "quarantined", reason: "test" } as unknown as ChainHealth;
    const { container } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("—LYTH"));
    expect(screen.queryByLabelText(BALANCE_LOADING_LABEL)).toBeNull();
    expect(container.textContent).not.toContain("12.34");
  });

  it("renders no stale label and no fiat line while hidden", async () => {
    healthMock.health = { kind: "offline" } as unknown as ChainHealth;
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("—LYTH"));
    expect(screen.queryByText(STALE_BALANCE_LABEL)).toBeNull();
    expect(document.querySelector(".w-hero__fiat")).toBeNull();
  });
});

describe("BalanceFigure — the stale presentation", () => {
  it("renders the remembered figure with no visual change to the value", () => {
    render(<BalanceFigure state={{ kind: "value", lythoshi: "3000000000000000000", stale: true }} />);
    // Stale is carried by the caller's class + label; the FIGURE is identical.
    expect(document.body.textContent).toBe("3.00");
  });

  it("a fresh and a stale value of the same amount render identically", () => {
    const { unmount } = render(
      <BalanceFigure state={{ kind: "value", lythoshi: "3000000000000000000", stale: false }} />,
    );
    const fresh = document.body.textContent;
    unmount();
    render(<BalanceFigure state={{ kind: "value", lythoshi: "3000000000000000000", stale: true }} />);
    expect(document.body.textContent).toBe(fresh);
  });

  it("an undecodable value degrades to the dash, never to a zero", () => {
    render(<BalanceFigure state={{ kind: "value", lythoshi: "not-a-number", stale: false }} />);
    expect(document.body.textContent).toBe("—");
    expect(document.body.textContent).not.toContain("0");
  });

  it("hidden renders the dash with no digits", () => {
    render(<BalanceFigure state={{ kind: "hidden" }} />);
    expect(document.body.textContent).toBe("—");
  });

  it("loading renders the labelled skeleton and no digits", () => {
    render(<BalanceFigure state={{ kind: "loading" }} />);
    expect(screen.getByLabelText(BALANCE_LOADING_LABEL)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[0-9]/);
  });
});

describe("Home hero — the seeded last-known balance", () => {
  it("shows the remembered figure, labelled, before the live read lands", async () => {
    seedMock.value = "3000000000000000000"; // 3 LYTH remembered
    balanceMock.settle = false; // live read never lands
    renderWithProviders(<Home goto={() => {}} />);

    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("3.00LYTH"));
    expect(screen.getByText(STALE_BALANCE_LABEL)).toBeInTheDocument();
    expect(heroAmount()?.className).toContain("is-stale");
  });

  it("a live read replaces the seed and clears the label", async () => {
    seedMock.value = "3000000000000000000";
    renderWithProviders(<Home goto={() => {}} />);

    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("12.34LYTH"));
    expect(screen.queryByText(STALE_BALANCE_LABEL)).toBeNull();
    expect(heroAmount()?.className).not.toContain("is-stale");
  });

  it("chain-not-live HIDES the remembered value (hidden beats seed)", async () => {
    seedMock.value = "3000000000000000000";
    healthMock.health = { kind: "quarantined", reason: "test" } as unknown as ChainHealth;
    const { container } = renderWithProviders(<Home goto={() => {}} />);

    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("—LYTH"));
    // The remembered number must appear nowhere.
    expect(container.textContent).not.toContain("3.00");
    expect(screen.queryByText(STALE_BALANCE_LABEL)).toBeNull();
  });

  it("the stale label never renders without a figure", async () => {
    seedMock.value = null; // nothing remembered
    balanceMock.settle = false;
    renderWithProviders(<Home goto={() => {}} />);

    await screen.findAllByLabelText(BALANCE_LOADING_LABEL);
    expect(screen.queryByText(STALE_BALANCE_LABEL)).toBeNull();
  });

  it("a seed arriving AFTER the live value is discarded (no re-labelling)", async () => {
    // The seed read resolves late; by then the live value has landed.
    let releaseSeed: (v: string | null) => void = () => {};
    seedMock.promise = new Promise<string | null>((r) => {
      releaseSeed = r;
    });
    renderWithProviders(<Home goto={() => {}} />);

    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("12.34LYTH"));
    await act(async () => {
      releaseSeed("3000000000000000000");
      await Promise.resolve();
    });

    // Still the live figure, still not marked stale.
    expect(heroAmount()?.textContent).toBe("12.34LYTH");
    expect(screen.queryByText(STALE_BALANCE_LABEL)).toBeNull();
  });

  it("writes the last-known record ONLY from a confirmed live read", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("12.34LYTH"));
    expect(saveMock).toHaveBeenCalledWith("0xabc", "12340000000000000000", expect.any(Number));
  });

  it("writes NOTHING when the balance read failed", async () => {
    balanceMock.lythoshi = { ok: false };
    renderWithProviders(<Home goto={() => {}} />);
    await screen.findAllByLabelText(BALANCE_LOADING_LABEL);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
