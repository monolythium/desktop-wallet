// Source-level conformance guards for the display-preferences work.
//
// Two properties can't be proven from rendered DOM alone:
//   P2 — the display-currency preference is STORED-ONLY: no module outside the
//        store, the panel, and their tests may read it. There is no LYTH price
//        source, so any consumer would necessarily render something invented.
//   P3 — ZERO DRIFT is literal: exactly one PreferencesPanel definition and one
//        theme-grid implementation exist in shipped source.
// Both are enforced by scanning the source tree via Vite's raw glob (no Node
// builtins, no new dependency).

import { describe, expect, it } from "vitest";

const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Shipped (non-test) source, keyed by `src/`-relative path. */
const SHIPPED: { rel: string; source: string }[] = Object.entries(RAW)
  .map(([path, source]) => ({ rel: path.replace(/^\/src\//, ""), source }))
  .filter(({ rel }) => !rel.includes("__tests__") && !rel.startsWith("test/"))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const ALLOWED = ["sdk/display-prefs.ts", "components/PreferencesPanel.tsx"];

describe("P2 — the display-currency preference is stored-only", () => {
  it("sees a non-trivial source tree (the guard is actually scanning)", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
    expect(SHIPPED.map((f) => f.rel)).toContain("sdk/display-prefs.ts");
  });

  it("no shipped module outside the store and the panel reads it", () => {
    const offenders = SHIPPED.filter(({ rel }) => !ALLOWED.includes(rel))
      .filter(({ source }) =>
        /readDisplayCurrency|saveDisplayCurrency|DISPLAY_CURRENCY_STORAGE_KEY|wallet\.displayCurrency/.test(source),
      )
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only the store and the panel touch the currency table (no early consumer)", () => {
    const offenders = SHIPPED.filter(({ rel }) => !ALLOWED.includes(rel))
      .filter(({ source }) => /ISO_4217_CURRENCIES/.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});

describe("P3 — zero drift is literal (one implementation each)", () => {
  it("exactly one PreferencesPanel definition exists", () => {
    const defs = SHIPPED.filter(({ source }) => /export function PreferencesPanel\b/.test(source)).map((f) => f.rel);
    expect(defs).toEqual(["components/PreferencesPanel.tsx"]);
  });

  it("exactly one theme-grid implementation exists", () => {
    const grids = SHIPPED.filter(({ source }) => /className="w-theme-grid"/.test(source)).map((f) => f.rel);
    expect(grids).toEqual(["components/ThemeGrid.tsx"]);
  });

  it("both surfaces import the shared panel rather than rebuilding pickers", () => {
    const importers = SHIPPED.filter(({ source }) => /from "\.\.?\/(components\/)?PreferencesPanel"/.test(source))
      .map((f) => f.rel)
      .sort();
    expect(importers).toEqual(["components/Onboarding.tsx", "pages/Settings.tsx"]);
  });
});
