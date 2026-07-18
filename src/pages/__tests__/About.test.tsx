// About render tests. The page fires several live reads on mount (wallet
// version, update check, operator probe, runtime provenance); each is mocked to
// a resolved no-op here so the tests exercise the page's composition and the
// developer-mode gating, not the network.

import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
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
