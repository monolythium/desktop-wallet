// RISC-V console gating: developer-mode-only. Off → the shared stub; on → the
// deploy/call console. The page has no mount effects, so the stub is inherently
// network-silent.

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { DeveloperModeProvider } from "../../sdk/developer-mode";
import type { Route } from "../../components/types";
import { RiscvContracts } from "../RiscvContracts";

function renderRiscv(enabled: boolean, goto: (r: Route) => void = () => {}) {
  const control = { enabled, setEnabled: async () => true };
  return renderWithProviders(
    <DeveloperModeProvider value={control}>
      <RiscvContracts goto={goto} />
    </DeveloperModeProvider>,
  );
}

describe("RiscvContracts developer-mode gating", () => {
  it("renders the stub while developer mode is off", () => {
    renderRiscv(false);
    expect(screen.getByText("Developer mode required")).toBeInTheDocument();
    expect(
      screen.getByText("The RISC-V contract console is a developer tool. Turn on developer mode to use it."),
    ).toBeInTheDocument();
    // The console form is not mounted.
    expect(screen.queryByRole("button", { name: "Deploy" })).not.toBeInTheDocument();
  });

  it("mounts the console while developer mode is on", () => {
    renderRiscv(true);
    expect(screen.queryByText("Developer mode required")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deploy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
  });

  it("the stub navigates to a toggle host", async () => {
    const goto = vi.fn();
    const { user } = renderRiscv(false, goto);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(goto).toHaveBeenCalledWith("settings");
  });
});
