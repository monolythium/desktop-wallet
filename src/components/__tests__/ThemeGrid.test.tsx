// ThemeGrid — the shared, presentational theme picker. It owns no state and
// never persists; the caller wires applyTheme.

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { THEMES } from "../../sdk/theme";
import { ThemeGrid } from "../ThemeGrid";

describe("ThemeGrid", () => {
  it("renders every shipped theme with its label + description", () => {
    renderWithProviders(<ThemeGrid selectedId="monolythium" onSelect={vi.fn()} />);
    for (const t of THEMES) {
      expect(screen.getByText(t.label)).toBeInTheDocument();
      expect(screen.getAllByTitle(t.desc).length).toBeGreaterThan(0);
    }
  });

  it("marks only the selected theme as pressed", () => {
    renderWithProviders(<ThemeGrid selectedId="neon" onSelect={vi.fn()} />);
    const pressed = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.textContent).toContain("Neon");
  });

  it("reports the picked id and persists nothing itself", async () => {
    const onSelect = vi.fn();
    localStorage.clear();
    const { user } = renderWithProviders(<ThemeGrid selectedId="monolythium" onSelect={onSelect} />);
    await user.click(screen.getByText("Aurora"));
    expect(onSelect).toHaveBeenCalledWith("aurora");
    // Presentational only — no storage write, no DOM attribute of its own.
    expect(localStorage.getItem("wallet.theme")).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
