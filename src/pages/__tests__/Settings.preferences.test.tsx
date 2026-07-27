// Settings → Display & Preferences: the hub card copy, the sub-page rendering
// the SHARED panel plus the desktop-only Layout row, and the sidebar shortcut
// that opens the sub-page directly.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { Settings } from "../Settings";

function renderSettings(initialSubPage?: "main" | "appearance") {
  return renderWithProviders(
    <Settings
      experimentalEnabled={false}
      setExperimentalEnabled={vi.fn()}
      initialSubPage={initialSubPage}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-layout");
});

describe("Settings hub — Display & Preferences card", () => {
  it("pins the card, row, help and button copy", async () => {
    // The hub's groups collapse to their headings, so the group opens before
    // its controls are reachable — collapsed content leaves the a11y tree.
    const { user } = renderSettings();
    expect(screen.getByRole("heading", { name: "Display & Preferences" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Customize" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Display & Preferences/ }));
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Theme, language, display currency, and layout.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize" })).toBeInTheDocument();
  });

  it("Customize opens the preferences sub-page", async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole("button", { name: /Display & Preferences/ }));
    await user.click(screen.getByRole("button", { name: "Customize" }));
    expect(screen.getByTestId("preferences-panel")).toBeInTheDocument();
  });
});

describe("Settings — the preferences sub-page", () => {
  it("the sidebar shortcut opens it directly, with the heading + sub line", () => {
    renderSettings("appearance");
    expect(screen.getByRole("heading", { name: "Display & Preferences" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "How the wallet looks and reads — theme, language, display currency, and layout. Applies across the wallet and persists on this device.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Settings" })).toBeInTheDocument();
  });

  it("renders the SHARED panel and the Layout row (P3)", () => {
    renderSettings("appearance");
    expect(screen.getByTestId("preferences-panel")).toBeInTheDocument();
    for (const title of ["Theme", "Language", "Display currency"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${title}`) })).toBeInTheDocument();
    }
    expect(screen.getByText("Layout")).toBeInTheDocument();
  });

  it("the Layout row still applies data-layout", async () => {
    const { user } = renderSettings("appearance");
    await user.click(screen.getByRole("button", { name: "topbar" }));
    expect(document.documentElement.getAttribute("data-layout")).toBe("topbar");
    await user.click(screen.getByRole("button", { name: "sidebar" }));
    // Sidebar is the native grid — applied by REMOVING the attribute.
    expect(document.documentElement.getAttribute("data-layout")).toBeNull();
  });
});
