// The Total / Delegated hero chip pair and the delegated view.
//
// Two things are load-bearing: the pair TOGGLES the figure (it is not
// navigation), and the delegated quantity renders only when the delegations
// read actually resolved — an unresolved read is a skeleton, a FAILED read is a
// dash, and neither is ever a confident 0.00.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
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

type Outcome = { ok: boolean; value?: unknown; error?: string };
const mocks = vi.hoisted(() => ({
  delegations: null as unknown,
  rewards: null as unknown,
}));

vi.mock("../../sdk/live", async (orig) => ({
  ...(await orig<typeof import("../../sdk/live")>()),
  loadLiveTokenStatus: vi.fn(async () => ({
    endpoint: "x",
    nativeBalance: { ok: true, value: "100" },
    // 100 LYTH exactly, so a 25% delegation is a clean 25.00.
    nativeBalanceLythoshi: { ok: true, value: "100000000000000000000" },
    tokenBalances: { ok: false, error: "n/a" },
    addressLabel: { ok: false, error: "n/a" },
    assetPolicy: { ok: false, error: "n/a" },
  })),
  loadLiveAddressActivity: vi.fn(async () => ({ ok: true, value: [] })),
  loadLiveDelegationStatus: vi.fn(async () => mocks.delegations),
}));

vi.mock("../../sdk/delegation", async (orig) => ({
  ...(await orig<typeof import("../../sdk/delegation")>()),
  fetchPendingRewards: vi.fn(async () => mocks.rewards),
}));

vi.mock("../../sdk/token-metadata", () => ({ loadTokenMetaMap: vi.fn(async () => new Map()) }));

import { renderWithProviders } from "../../test/renderWithProviders";
import { Home } from "../Home";
import { BALANCE_LOADING_LABEL } from "../../sdk/balance-display";

/** A resolved delegations read with `bps` weight across `rows` clusters. */
function delegated(bps: number, rows: number): { delegations: Outcome; activeClusters: Outcome } {
  return {
    delegations: {
      ok: true,
      value: { totalBps: bps, rows: Array.from({ length: rows }, (_, i) => ({ cluster: `c${i}` })) },
    },
    activeClusters: { ok: true, value: [] },
  };
}

function heroAmount(): Element | null {
  return document.querySelector(".w-hero__amount");
}
/** Scoped to the chip row — after toggling, the delegated stacked line is also
 *  a button whose name starts with "Delegated". */
function chipByLabel(name: "Total" | "Delegated"): HTMLElement {
  const row = document.querySelector('[data-testid="hero-chips"]') as HTMLElement;
  return within(row).getByRole("button", { name: new RegExp(`^${name}`) });
}

/** The rewards line's text is split across elements (the amount is its own
 *  span), so match on the container's combined text. */
function rewardsLine(): HTMLElement | null {
  const buttons = Array.from(document.querySelectorAll("button"));
  return (buttons.find((b) => (b.textContent ?? "").includes("pending rewards")) ?? null) as HTMLElement | null;
}

beforeEach(() => {
  localStorage.clear();
  healthMock.health = { kind: "live", height: 1 };
  mocks.delegations = delegated(2500, 2); // 25% across 2 clusters
  mocks.rewards = null;
});
afterEach(() => vi.clearAllMocks());

describe("Hero chips — toggling the figure", () => {
  it("defaults to Total, with aria-pressed reflecting it", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    expect(chipByLabel("Total")).toHaveAttribute("aria-pressed", "true");
    expect(chipByLabel("Delegated")).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking Delegated swaps the figure and the label — and does not navigate", async () => {
    const goto = vi.fn();
    const { user } = renderWithProviders(<Home goto={goto} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));

    await user.click(chipByLabel("Delegated"));

    // 100 LYTH × 2500 bps / 10000 = 25 LYTH.
    expect(heroAmount()?.textContent).toBe("25.00LYTH");
    expect(document.querySelector(".w-hero__label")?.textContent).toContain("Delegated");
    expect(chipByLabel("Delegated")).toHaveAttribute("aria-pressed", "true");
    // Toggling is NOT navigation.
    expect(goto).not.toHaveBeenCalled();
  });

  it("both chips show their own value simultaneously", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    const chips = document.querySelector('[data-testid="hero-chips"]');
    expect(chips?.textContent).toContain("100.00");
    expect(chips?.textContent).toContain("25.00");
  });

  it("the inactive chip is not dimmed with opacity (contrast law)", async () => {
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    const inactive = chipByLabel("Delegated");
    expect(inactive.style.opacity).toBe("");
    // The affordance is the muted border instead.
    expect(inactive.style.border).toContain("--fg-700");
  });
});

describe("Hero chips — the delegated quantity is honest about its inputs", () => {
  it("a FAILED delegations read shows a dash, not a skeleton and not 0.00", async () => {
    mocks.delegations = { delegations: { ok: false, error: "operator down" }, activeClusters: { ok: true, value: [] } };
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));

    await user.click(chipByLabel("Delegated"));
    expect(heroAmount()?.textContent).toBe("—LYTH");
    expect(heroAmount()?.querySelector("[aria-busy]")).toBeNull();
    expect(heroAmount()?.textContent).not.toContain("0.00");
  });

  it("a failed delegations read renders NO stacked lines (no duplicated error copy)", async () => {
    mocks.delegations = { delegations: { ok: false, error: "operator down" }, activeClusters: { ok: true, value: [] } };
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    expect(screen.queryByText(/Delegated to/)).toBeNull();
    expect(screen.queryByText("Not delegated")).toBeNull();
  });

  it("an UNRESOLVED delegations read shows the skeleton", async () => {
    mocks.delegations = null;
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    const chips = document.querySelector('[data-testid="hero-chips"]');
    expect(chips?.querySelector(`[aria-label="${BALANCE_LOADING_LABEL}"]`)).not.toBeNull();
  });

  it("zero delegations renders 'Not delegated' with an honest 0.00 figure", async () => {
    mocks.delegations = delegated(0, 0);
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    expect(heroAmount()?.textContent).toBe("0.00LYTH");
    expect(screen.getByText("Not delegated")).toBeInTheDocument();
  });

  it("the summary line reports the cluster count and weight, and routes to Delegate", async () => {
    const goto = vi.fn();
    const { user } = renderWithProviders(<Home goto={goto} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    const line = screen.getByText(/Delegated to 2 clusters/);
    expect(line.textContent).toContain("25.00%");
    await user.click(line);
    expect(goto).toHaveBeenCalledWith("delegate");
  });

  it("singularises a single cluster", async () => {
    mocks.delegations = delegated(1000, 1);
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));
    expect(screen.getByText(/Delegated to 1 cluster ·/)).toBeInTheDocument();
  });

  it("chain-not-live hides BOTH chip values", async () => {
    healthMock.health = { kind: "offline" } as unknown as ChainHealth;
    renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("—LYTH"));
    const chips = document.querySelector('[data-testid="hero-chips"]');
    expect(chips?.textContent).not.toMatch(/[0-9]/);
  });
});

describe("Hero — the pending-rewards line", () => {
  it("renders a resolved reward, normalising the hex quantity", async () => {
    // 0x1BC16D674EC80000 = 2e18 lythoshi = 2 LYTH.
    mocks.rewards = { totalAmountLythoshi: "0x1BC16D674EC80000" };
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    expect(rewardsLine()?.textContent).toContain("2.00");
  });

  it("renders a live zero reward honestly", async () => {
    mocks.rewards = { totalAmountLythoshi: "0x0" };
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    expect(rewardsLine()?.textContent).toContain("0.00");
  });

  it("renders NO line at all on a failed read", async () => {
    mocks.rewards = null;
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    expect(rewardsLine()).toBeNull();
  });

  it("renders NO line for an undecodable quantity (never a fabricated 0.00)", async () => {
    mocks.rewards = { totalAmountLythoshi: "not-a-quantity" };
    const { user } = renderWithProviders(<Home goto={() => {}} />);
    await vi.waitFor(() => expect(heroAmount()?.textContent).toBe("100.00LYTH"));
    await user.click(chipByLabel("Delegated"));

    expect(rewardsLine()).toBeNull();
  });
});
