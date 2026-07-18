// Networks screen render tests: list (Official/Custom + gating notes), detail
// (builtin vs custom), activate, and delete (both bodies). build-mode + client
// are mocked; chains is real, driven via addUserChain / localStorage.

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { ACTIVE_CHAIN_KEY, USER_CHAINS_KEY, __resetChainsForTests, addUserChain } from "../../sdk/chains";
import { Networks } from "../Networks";

const hardenedMock = vi.hoisted(() => ({ value: false }));
vi.mock("../../sdk/build-mode", () => ({ isHardenedBuild: () => hardenedMock.value }));

const setEndpointSpy = vi.hoisted(() => vi.fn());
vi.mock("../../sdk/client", async (orig) => ({
  ...(await orig<typeof import("../../sdk/client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  setEndpoint: (u: string) => setEndpointSpy(u),
  isKnownEndpoint: () => true,
  resolveActiveEndpoint: () => "https://rpc.monolythium.com",
}));

function renderNetworks(devMode: boolean) {
  const control = { enabled: devMode, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <Networks />
    </DeveloperModeProvider>,
  );
}

const addLocal = () => addUserChain({ chainId: "0x539", name: "Local devnet", rpc: "http://localhost:8545" });

afterEach(() => {
  hardenedMock.value = false;
  setEndpointSpy.mockClear();
  localStorage.clear();
  __resetChainsForTests();
});

describe("Networks — list", () => {
  it("shows the Official section with the builtin chain and the custom empty hint", () => {
    renderNetworks(true);
    expect(screen.getByRole("heading", { name: "Official" })).toBeInTheDocument();
    expect(screen.getByText("Monolythium Testnet")).toBeInTheDocument();
    expect(screen.getByText("No custom chains added yet.")).toBeInTheDocument();
  });

  it("lists a stored custom chain under Custom", () => {
    addLocal();
    renderNetworks(true);
    expect(screen.getByText("Local devnet")).toBeInTheDocument();
    expect(screen.queryByText("No custom chains added yet.")).not.toBeInTheDocument();
  });

  it("renders the three add-gating notes verbatim by state", () => {
    const { unmount } = renderNetworks(true); // dev build + dev mode on
    expect(screen.getByText("Dev mode only — custom chains aren't available in production builds.")).toBeInTheDocument();
    unmount();

    renderNetworks(false); // dev build + dev mode off
    expect(screen.getByText("Turn on developer mode to add custom chains.")).toBeInTheDocument();
  });

  it("shows the hardened-build note when packaged", () => {
    hardenedMock.value = true;
    renderNetworks(true);
    expect(screen.getByText("Custom chains aren't available in this build.")).toBeInTheDocument();
  });
});

describe("Networks — detail", () => {
  it("builtin: shows the Active chip, no Delete, no unpinned advisory", async () => {
    const { user } = renderNetworks(true);
    await user.click(screen.getByText("Monolythium Testnet"));
    expect(screen.getByText("Network details")).toBeInTheDocument();
    expect(screen.getByText("Active chain")).toBeInTheDocument();
    expect(screen.queryByText("⚠ Delete")).not.toBeInTheDocument();
    expect(screen.queryByText(/genesis unpinned/)).not.toBeInTheDocument();
  });

  it("custom: shows the unpinned-trust advisory verbatim + Activate + Delete", async () => {
    addLocal();
    const { user } = renderNetworks(true);
    await user.click(screen.getByText("Local devnet"));
    expect(screen.getByText(/This chain has no genesis pin\./)).toHaveTextContent(
      "trust surfaces show 'genesis unpinned' instead of Verified",
    );
    expect(screen.getByRole("button", { name: "Activate this chain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "⚠ Delete" })).toBeInTheDocument();
  });
});

describe("Networks — activate", () => {
  it("activates a custom chain: dials its rpc and returns to the list highlighted", async () => {
    addLocal();
    const { user } = renderNetworks(true);
    await user.click(screen.getByText("Local devnet"));
    await user.click(screen.getByRole("button", { name: "Activate this chain" }));
    expect(setEndpointSpy).toHaveBeenCalledWith("http://localhost:8545");
    expect(localStorage.getItem(ACTIVE_CHAIN_KEY)).toBe("0x539");
    // back on the list
    expect(screen.getByRole("heading", { name: "Official" })).toBeInTheDocument();
  });
});

describe("Networks — delete (both bodies)", () => {
  it("non-active custom: the neutral body, then removal", async () => {
    addLocal();
    const { user } = renderNetworks(true);
    await user.click(screen.getByText("Local devnet"));
    await user.click(screen.getByRole("button", { name: "⚠ Delete" }));
    expect(screen.getByText("The chain will be removed from the wallet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.queryByText("Local devnet")).not.toBeInTheDocument(); // gone from the list
    expect(JSON.parse(localStorage.getItem(USER_CHAINS_KEY) ?? "{}")["0x539"]).toBeUndefined();
  });

  it("active custom: the switch-to-builtin body, then builtin re-activated", async () => {
    addLocal();
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539"); // custom is active
    const { user } = renderNetworks(true);
    await user.click(screen.getByText("Local devnet"));
    await user.click(screen.getByRole("button", { name: "⚠ Delete" }));
    expect(screen.getByText("This is the active chain. The wallet will switch to Monolythium Testnet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    // deleted + builtin persisted as the active chain
    expect(localStorage.getItem(ACTIVE_CHAIN_KEY)).toBe("0x10F2C");
  });
});
