// Welcome (choose-path) embedding of the shared preferences panel.
//
// The load-bearing property is that preferences NEVER gate onboarding: Create
// and Import behave identically whether the panel was touched or not, and while
// a row is open. The panel is also pre-vault safe (no vault/keychain/RPC).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { Onboarding } from "../Onboarding";

const CAPTION = "You can change these anytime in Settings.";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Onboarding choose-path — the preferences panel", () => {
  it("renders the shared panel collapsed, with the caption, between intro and buttons", () => {
    renderWithProviders(<Onboarding onDone={vi.fn()} />);
    expect(screen.getByText("Welcome to Monolythium")).toBeInTheDocument();
    const panel = screen.getByTestId("preferences-panel");
    expect(panel).toBeInTheDocument();
    for (const title of ["Theme", "Language", "Display currency"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${title}`) })).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    // Order: the panel sits before the action buttons in the card.
    const create = screen.getByRole("button", { name: "Create new wallet" });
    expect(panel.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("P4: Create still advances while a preferences row is open (never blocks)", async () => {
    const { user } = renderWithProviders(<Onboarding onDone={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Display currency/ }));
    await user.click(screen.getByRole("button", { name: "Create new wallet" }));
    // Left choose-path — the create branch is showing (no preferences gate).
    expect(screen.queryByText("Welcome to Monolythium")).toBeNull();
  });

  it("P4: Import still advances, and a selection survives leaving Welcome", async () => {
    const { user } = renderWithProviders(<Onboarding onDone={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Display currency/ }));
    await user.click(screen.getByText("EUR — Euro"));
    await user.click(screen.getByRole("button", { name: "Import existing wallet" }));
    expect(screen.queryByText("Welcome to Monolythium")).toBeNull();
    expect(localStorage.getItem("wallet.displayCurrency")).toBe("EUR");
  });

  it("P4: rendering pre-vault touches no vault, keychain or RPC", async () => {
    // Any such access in the needs_onboarding boot state would throw or hit the
    // network; the panel is display-only, so a bare render + selection is inert.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { user } = renderWithProviders(<Onboarding onDone={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Theme/ }));
    await user.click(screen.getByText("Neon"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
    fetchSpy.mockRestore();
  });
});
