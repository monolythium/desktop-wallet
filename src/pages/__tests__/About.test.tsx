// About render tests. The page fires several live reads on mount (wallet
// version, update check, operator probe, runtime provenance); each is mocked to
// a resolved no-op here so the tests exercise the page's composition and the
// developer-mode gating, not the network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { ChainInfo } from "@monolythium/core-sdk";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import { readChainIdentity } from "../../sdk/about";
import { fetchLiveTestnetRegistry } from "../../sdk/live-registry";
import { About } from "../About";

const updateMock = vi.hoisted(() => ({
  value: { kind: "none" } as { kind: "none" } | { kind: "error" } | { kind: "available"; version: string; notes: null; pubDate: null },
}));
vi.mock("../../sdk/updater", () => ({
  checkForUpdate: vi.fn(async () => updateMock.value),
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

function renderAbout(enabled: boolean, goto: (r: string) => void = () => {}) {
  const control = { enabled, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <About goto={goto as never} />
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

describe("About — version / update / build rows", () => {
  beforeEach(() => {
    // The update verdict is now cached (Phase 13 §D). Without this, the first
    // test's fresh cache closes the 12-hour gate for every test after it and
    // they would all render the FIRST test's answer.
    localStorage.clear();
  });

  afterEach(() => {
    updateMock.value = { kind: "none" };
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders a real 'up to date' answer", async () => {
    updateMock.value = { kind: "none" };
    renderAbout(false);
    expect(await screen.findByText("up to date")).toBeInTheDocument();
  });

  it("renders an available update", async () => {
    updateMock.value = { kind: "available", version: "9.9.9", notes: null, pubDate: null };
    renderAbout(false);
    expect(await screen.findByText("update available → v9.9.9")).toBeInTheDocument();
  });

  it("renders a failed check honestly — never 'up to date'", async () => {
    updateMock.value = { kind: "error" };
    renderAbout(false);
    // Copy updated in Phase 13 §D.6 ("couldn't check for updates" → this). The
    // property under test is unchanged and is the second assertion.
    expect(await screen.findByText("couldn't check — will retry later")).toBeInTheDocument();
    expect(screen.queryByText("up to date")).not.toBeInTheDocument();
  });

  it("shows the build mode (development under test, not a packaged build)", () => {
    renderAbout(false);
    expect(screen.getByText("development")).toBeInTheDocument();
  });
});

describe("About — operators card wiring", () => {
  afterEach(() => {
    liveMock.value = null;
    vi.clearAllMocks();
  });

  it("no longer claims genesis health 'is not computed yet', and links to Operators", async () => {
    const goto = vi.fn();
    const { user } = renderAbout(false, goto);
    expect(screen.queryByText(/is not computed yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Genesis-verified per-operator health lives on the Operators screen/)).toBeInTheDocument();
    await user.click(screen.getByText("Open Operators"));
    expect(goto).toHaveBeenCalledWith("operators");
  });
});
