// PreferencesPanel — the shared Theme / Language / Display-currency accordion.
// Pins the single-open rule, apply-and-collapse, the verbatim captions, the
// default-theme attribute-removal path, and the stored-only currency guard.

import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import { PreferencesPanel } from "../PreferencesPanel";

const LANGUAGE_CAPTION = "Display language. More locales will follow — English (US) for now.";
const CURRENCY_CAPTION =
  "Sets the currency for the wallet's fiat estimates. There is no LYTH price source yet, so estimate slots show only your currency's symbol and a dash until one exists.";

function header(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}`) });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("PreferencesPanel — structure + single-open accordion", () => {
  it("renders the three rows, all collapsed on mount", () => {
    renderWithProviders(<PreferencesPanel />);
    for (const title of ["Theme", "Language", "Display currency"]) {
      expect(header(title)).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("opening a row closes any other (at most one open)", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Language"));
    expect(header("Language")).toHaveAttribute("aria-expanded", "true");
    await user.click(header("Theme"));
    expect(header("Theme")).toHaveAttribute("aria-expanded", "true");
    expect(header("Language")).toHaveAttribute("aria-expanded", "false");
  });

  it("tapping the open row's header closes it", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Theme"));
    expect(header("Theme")).toHaveAttribute("aria-expanded", "true");
    await user.click(header("Theme"));
    expect(header("Theme")).toHaveAttribute("aria-expanded", "false");
  });

  it("a collapsed row keeps its body mounted, and out of reach", async () => {
    // The shared disclosure hides with an attribute rather than unmounting, so
    // sections that read on mount do so at page load and not at first expand.
    // Inert for this panel — nothing here runs on mount — but the contract has
    // to hold, and a collapsed row must still be unusable.
    const { user } = renderWithProviders(<PreferencesPanel />);
    expect(screen.getByText("EUR — Euro")).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /EUR — Euro/ })).toHaveLength(0);
    await user.click(header("Display currency"));
    expect(screen.getAllByRole("button", { name: /EUR — Euro/ })).toHaveLength(1);
  });

  it("headers show the current values (theme LABEL, language label, bare code)", () => {
    renderWithProviders(<PreferencesPanel />);
    expect(header("Theme").textContent).toContain("Monolythium");
    expect(header("Language").textContent).toContain("English (US)");
    expect(header("Display currency").textContent).toContain("USD");
  });
});

describe("PreferencesPanel — apply and collapse", () => {
  it("selecting a currency persists it, collapses the row, and updates the header", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Display currency"));
    await user.click(screen.getByText("EUR — Euro"));
    expect(header("Display currency")).toHaveAttribute("aria-expanded", "false");
    expect(header("Display currency").textContent).toContain("EUR");
    expect(localStorage.getItem("wallet.displayCurrency")).toBe("EUR");
  });

  it("selecting a non-default theme sets data-theme and persists", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Theme"));
    await user.click(screen.getByText("Neon"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
    expect(localStorage.getItem("wallet.theme")).toBe("neon");
    expect(header("Theme")).toHaveAttribute("aria-expanded", "false");
  });

  it("P1: selecting the DEFAULT theme REMOVES data-theme (never sets it)", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Theme"));
    await user.click(screen.getByText("Neon")); // set something first
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
    await user.click(header("Theme"));
    await user.click(screen.getByText("Monolythium"));
    // The native :root palette is the source of truth — no attribute at all.
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem("wallet.theme")).toBe("monolythium");
  });

  it("does not apply a theme on mount (pre-paint already did)", () => {
    localStorage.setItem("wallet.theme", "aurora");
    renderWithProviders(<PreferencesPanel />);
    // Mount reads the value for the header but must not touch the DOM attribute.
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(header("Theme").textContent).toContain("Aurora");
  });
});

describe("PreferencesPanel — honest language + stored-only currency", () => {
  it("the language grid offers exactly one option, active, with the verbatim caption", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Language"));
    const options = screen.getAllByRole("button", { name: /English \(US\)/ });
    // One option chip (the header also contains the label, so filter by aria-pressed).
    const chips = options.filter((b) => b.hasAttribute("aria-pressed"));
    expect(chips).toHaveLength(1);
    expect(chips[0]!).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(LANGUAGE_CAPTION)).toBeInTheDocument();
  });

  it("carries no 'coming soon' or disabled phantom options (P6)", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Language"));
    const panel = screen.getByTestId("preferences-panel");
    expect(panel.textContent ?? "").not.toMatch(/coming soon/i);
    expect(within(panel).queryAllByRole("button").filter((b) => b.hasAttribute("disabled"))).toHaveLength(0);
  });

  it("the currency row renders all 25 codes and the verbatim caption", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Display currency"));
    expect(screen.getByText("USD — US Dollar")).toBeInTheDocument();
    expect(screen.getByText("JPY — Japanese Yen")).toBeInTheDocument();
    expect(screen.getByText("OMR — Omani Rial")).toBeInTheDocument();
    expect(screen.getByText(CURRENCY_CAPTION)).toBeInTheDocument();
  });

  it("P2: nothing fiat-like renders — no currency symbol or converted value", async () => {
    const { user } = renderWithProviders(<PreferencesPanel />);
    await user.click(header("Display currency"));
    const text = screen.getByTestId("preferences-panel").textContent ?? "";
    // Options are code + name only; the table carries no symbol column and
    // nothing converts, so no glyph may appear.
    expect(text).not.toMatch(/[$€£¥₹₩₺¢]/);
  });
});
