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

describe("Networks — add custom chain form", () => {
  async function openAdd() {
    const r = renderNetworks(true);
    await r.user.click(screen.getByRole("button", { name: "+ Add custom chain" }));
    return r;
  }

  it("chain-id validators + the Decimal hint, verbatim", async () => {
    const { user } = await openAdd();
    const id = screen.getByPlaceholderText("0x539");
    await user.type(id, "abc");
    expect(screen.getByText("Chain id must be 0x-prefixed hex")).toBeInTheDocument();
    await user.clear(id);
    await user.type(id, "0x0");
    expect(screen.getByText("Chain id must be a positive integer")).toBeInTheDocument();
    await user.clear(id);
    await user.type(id, "0x10F2C");
    expect(screen.getByText("Chain id already exists in your list")).toBeInTheDocument();
    await user.clear(id);
    await user.type(id, "0x539");
    expect(screen.getByText("Decimal: 1337")).toBeInTheDocument();
  });

  it("name / rpc / explorer / currency validators verbatim", async () => {
    const { user } = await openAdd();
    // Name required only once touched.
    await user.click(screen.getByPlaceholderText("e.g. Monolythium"));
    await user.tab();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    // rpc invalid.
    await user.type(screen.getByPlaceholderText("https://rpc.example.com"), "notaurl");
    expect(screen.getByText("Must be a valid URL")).toBeInTheDocument();
    // explorer non-https.
    await user.type(screen.getByPlaceholderText("https://scan.example.com"), "http://insecure");
    expect(screen.getByText("Must be https://")).toBeInTheDocument();
    // currency partial.
    await user.type(screen.getByPlaceholderText("Symbol (e.g. LYTH)"), "LOC");
    expect(screen.getByText("Provide all three currency fields, or leave all blank")).toBeInTheDocument();
  });

  it("a plain-http RPC is a WARNING (not a blocker) and the advisory box is present", async () => {
    const { user } = await openAdd();
    await user.type(screen.getByPlaceholderText("0x539"), "0x539");
    await user.type(screen.getByPlaceholderText("e.g. Monolythium"), "Local");
    await user.type(screen.getByPlaceholderText("https://rpc.example.com"), "http://localhost:8545");
    expect(screen.getByText("Non-HTTPS RPC — only use for trusted local nodes.")).toBeInTheDocument();
    expect(screen.getByText(/This chain is not in our verified registry\./)).toBeInTheDocument();
    // The warning does NOT disable submit — every validator still passes.
    expect(screen.getByRole("button", { name: "Add chain" })).toBeEnabled();
  });

  it("submit is disabled until valid; a valid submit adds the chain and returns to the list", async () => {
    const { user } = await openAdd();
    expect(screen.getByRole("button", { name: "Add chain" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("0x539"), "0x539");
    await user.type(screen.getByPlaceholderText("e.g. Monolythium"), "Local devnet");
    await user.type(screen.getByPlaceholderText("https://rpc.example.com"), "https://node.example");
    const submit = screen.getByRole("button", { name: "Add chain" });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(screen.getByText("Local devnet")).toBeInTheDocument(); // now in the list
    expect(JSON.parse(localStorage.getItem(USER_CHAINS_KEY) ?? "{}")["0x539"]).toBeDefined();
  });
});

describe("Networks — edit custom chain form", () => {
  async function openEdit(user: ReturnType<typeof renderNetworks>["user"], name: string) {
    await user.click(screen.getByText(name));
    await user.click(screen.getByRole("button", { name: "Edit" }));
  }

  it("locks the chain id (not an input) with the decimal hint", async () => {
    addUserChain({ chainId: "0x539", name: "Local devnet", rpc: "http://localhost:8545" });
    const { user } = renderNetworks(true);
    await openEdit(user, "Local devnet");
    expect(screen.getByText("Chain ID (locked)")).toBeInTheDocument();
    expect(screen.getByText("Decimal: 1337")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("0x539")).not.toBeInTheDocument(); // rendered as text
  });

  it("shares the validators (name required, rpc must be valid)", async () => {
    addUserChain({ chainId: "0x539", name: "Local devnet", rpc: "http://localhost:8545" });
    const { user } = renderNetworks(true);
    await openEdit(user, "Local devnet");
    await user.clear(screen.getByDisplayValue("Local devnet"));
    expect(screen.getByText("Name is required")).toBeInTheDocument();
    await user.clear(screen.getByDisplayValue("http://localhost:8545"));
    await user.type(screen.getByPlaceholderText("https://rpc.example.com"), "notaurl");
    expect(screen.getByText("Must be a valid URL")).toBeInTheDocument();
  });

  it("patch semantics: clearing the explorer + all currency fields deletes them", async () => {
    addUserChain({
      chainId: "0x539",
      name: "Local devnet",
      rpc: "http://localhost:8545",
      blockExplorer: "https://scan.example",
      nativeCurrency: { name: "LocalCoin", symbol: "LOC", decimals: 9 },
    });
    const { user } = renderNetworks(true);
    await openEdit(user, "Local devnet");
    await user.clear(screen.getByPlaceholderText("https://scan.example.com"));
    await user.clear(screen.getByPlaceholderText("Currency name (e.g. Monolythium LYTH)"));
    await user.clear(screen.getByPlaceholderText("Symbol (e.g. LYTH)"));
    await user.clear(screen.getByPlaceholderText("Decimals (e.g. 18)"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    const stored = JSON.parse(localStorage.getItem(USER_CHAINS_KEY)!)["0x539"];
    expect(stored.blockExplorer).toBeUndefined();
    expect(stored.nativeCurrency).toBeUndefined();
  });

  it("editing the ACTIVE chain's rpc re-follows the endpoint (setEndpoint(newRpc))", async () => {
    addUserChain({ chainId: "0x539", name: "Local devnet", rpc: "http://localhost:8545" });
    localStorage.setItem(ACTIVE_CHAIN_KEY, "0x539"); // custom is active
    const { user } = renderNetworks(true);
    await openEdit(user, "Local devnet");
    await user.clear(screen.getByDisplayValue("http://localhost:8545"));
    await user.type(screen.getByPlaceholderText("https://rpc.example.com"), "http://localhost:9999");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(setEndpointSpy).toHaveBeenCalledWith("http://localhost:9999");
  });

  it("the builtin chain never exposes Edit (guard)", async () => {
    const { user } = renderNetworks(true);
    await user.click(screen.getByText("Monolythium Testnet"));
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});
