// MonoStudio gating: with developer mode off the page renders the shared stub
// and fires ZERO backend reads (zero-network law); with it on, the real page
// mounts and its host/workspace reads run.

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import type { Route } from "../../components/types";
import { MonoStudio } from "../MonoStudio";
import { loadStudioHostStatus, listTrustedWorkspaces } from "../../sdk/studio-host";

vi.mock("../../sdk/studio-host", async (orig) => {
  const real = await orig<typeof import("../../sdk/studio-host")>();
  return {
    ...real,
    loadStudioHostStatus: vi.fn(async (args: Parameters<typeof real.loadStudioHostStatus>[0]) =>
      real.previewStudioHostStatus(args),
    ),
    listTrustedWorkspaces: vi.fn(async () => []),
    drainSidecarMessages: vi.fn(async () => []),
    assertWorkspaceTrusted: vi.fn(async () => ({ root: "", trusted: false, trustedRoots: [] })),
  };
});

function renderStudio(enabled: boolean, goto: (r: Route) => void = () => {}) {
  const control = { enabled, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <MonoStudio goto={goto} />
    </DeveloperModeProvider>,
  );
}

describe("MonoStudio developer-mode gating", () => {
  it("renders the stub and fires no backend reads while developer mode is off", () => {
    vi.clearAllMocks();
    renderStudio(false);
    expect(screen.getByText("Developer mode required")).toBeInTheDocument();
    expect(
      screen.getByText("Mono Studio is a developer tool. Turn on developer mode to use it."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
    // Zero-network law.
    expect(loadStudioHostStatus).not.toHaveBeenCalled();
    expect(listTrustedWorkspaces).not.toHaveBeenCalled();
  });

  it("the stub's buttons navigate to the toggle hosts", async () => {
    vi.clearAllMocks();
    const goto = vi.fn();
    const { user } = renderStudio(false, goto);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(goto).toHaveBeenCalledWith("settings");
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(goto).toHaveBeenCalledWith("about");
  });

  it("mounts the real page and runs its reads while developer mode is on", () => {
    vi.clearAllMocks();
    renderStudio(true);
    expect(screen.queryByText("Developer mode required")).not.toBeInTheDocument();
    expect(screen.getByText("DevKit Status")).toBeInTheDocument();
    expect(loadStudioHostStatus).toHaveBeenCalled();
    expect(listTrustedWorkspaces).toHaveBeenCalled();
  });
});
