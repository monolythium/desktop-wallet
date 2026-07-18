// About render tests. The page fires several live reads on mount (wallet
// version, update check, operator probe, runtime provenance); each is mocked to
// a resolved no-op here so the tests exercise the page's composition and the
// developer-mode gating, not the network.

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ChainInfo } from "@monolythium/core-sdk";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { readChainIdentity } from "../../sdk/about";
import { fetchLiveTestnetRegistry } from "../../sdk/live-registry";
import { About } from "../About";

vi.mock("../../sdk/updater", () => ({
  checkForUpdate: vi.fn(async () => ({ available: false })),
}));

vi.mock("../../sdk/peers", async (orig) => ({
  ...(await orig<typeof import("../../sdk/peers")>()),
  listPeers: vi.fn(() => []),
  probePeer: vi.fn(async () => ({ url: "x", reachable: false, latencyMs: 1, chainIdOk: false })),
}));

vi.mock("../../sdk/about", async (orig) => ({
  ...(await orig<typeof import("../../sdk/about")>()),
  readWalletVersion: vi.fn(async () => "1.2.3"),
  loadRuntimeBlock: vi.fn(async () => null),
}));

const liveMock = vi.hoisted(() => ({ value: null as ChainInfo | null }));
vi.mock("../../sdk/live-registry", () => ({
  fetchLiveTestnetRegistry: vi.fn(async () => liveMock.value),
}));

/** A live ChainInfo carrying just the fields the drift compare reads. */
function liveInfo(genesis_hash: string, binary_sha = "da04f8f5"): ChainInfo {
  return { genesis_hash, binary_sha } as unknown as ChainInfo;
}

function renderAbout(enabled: boolean) {
  const control = { enabled, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <About goto={() => {}} />
    </DeveloperModeProvider>,
  );
}

describe("About — developer mode card", () => {
  afterEach(() => {
    liveMock.value = null;
    vi.clearAllMocks();
  });

  it("mounts the shared developer-mode switch, reflecting the context state", () => {
    renderAbout(false);
    const sw = screen.getByRole("switch", { name: "Developer mode" });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("shows the switch as on when the context is on", () => {
    renderAbout(true);
    expect(screen.getByRole("switch", { name: "Developer mode" })).toHaveAttribute("aria-checked", "true");
  });

  it("hides the Chain card while developer mode is off", () => {
    renderAbout(false);
    expect(screen.queryByText("Chain ID")).not.toBeInTheDocument();
  });

  it("shows the Chain card while developer mode is on", () => {
    renderAbout(true);
    expect(screen.getByText("Chain ID")).toBeInTheDocument();
  });
});

describe("About — Chain card genesis + drift banner", () => {
  afterEach(() => {
    liveMock.value = null;
    vi.clearAllMocks();
  });

  it("does not fetch the live registry while developer mode is off", async () => {
    renderAbout(false);
    // Give any (wrongly-fired) effect a chance to run.
    await waitFor(() => expect(screen.getByRole("switch")).toBeInTheDocument());
    expect(fetchLiveTestnetRegistry).not.toHaveBeenCalled();
  });

  it("renders the full untruncated genesis pin while on", () => {
    renderAbout(true);
    const full = readChainIdentity().genesisHash;
    expect(screen.getByText(full)).toBeInTheDocument();
  });

  it("shows no drift banner when the live genesis matches the bundled pin", async () => {
    liveMock.value = liveInfo(readChainIdentity().genesisHash);
    renderAbout(true);
    await waitFor(() => expect(fetchLiveTestnetRegistry).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText(/takes precedence/)).not.toBeInTheDocument();
    });
  });

  it("shows the drift banner (with live binary sha) on a genesis mismatch", async () => {
    liveMock.value = liveInfo("0xdeadbeefcafef00d1234567890abcdef", "beefcafe");
    renderAbout(true);
    const banner = await screen.findByText(/takes precedence until the wallet updates/);
    expect(banner).toHaveTextContent("Live registry reports");
    expect(banner).toHaveTextContent("Live binary sha: beefcafe.");
  });

  it("shows no drift banner when the live fetch returns nothing", async () => {
    liveMock.value = null;
    renderAbout(true);
    await waitFor(() => expect(fetchLiveTestnetRegistry).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByText(/takes precedence/)).not.toBeInTheDocument();
    });
  });
});
