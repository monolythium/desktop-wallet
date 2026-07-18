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

/** Modules permitted to touch the RAW preference accessors / storage key. The
 *  sanctioned read path for every consumer is the `useDisplayCurrency()` hook,
 *  which is deliberately NOT on this list — a slot reading the hook is fine; a
 *  slot reaching past it into localStorage is not. */
const ACCESSOR_ALLOWED = ["sdk/display-prefs.ts", "components/PreferencesPanel.tsx"];

/** Modules permitted to read the ISO-4217 table. Phase 07 added the fiat layer:
 *  the formatter resolves per-currency precision as Intl → this table → 2, so it
 *  is a legitimate consumer of the `decimals` metadata Phase 06 carried for it. */
const TABLE_ALLOWED = [...ACCESSOR_ALLOWED, "sdk/fiat.ts"];

const ACCESSOR_RE =
  /readDisplayCurrency|saveDisplayCurrency|DISPLAY_CURRENCY_STORAGE_KEY|wallet\.displayCurrency/;

describe("P2 — the display-currency preference is read only through sanctioned paths", () => {
  it("sees a non-trivial source tree (the guard is actually scanning)", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
    expect(SHIPPED.map((f) => f.rel)).toContain("sdk/display-prefs.ts");
    expect(SHIPPED.map((f) => f.rel)).toContain("sdk/fiat.ts");
  });

  it("no shipped module outside the store and the panel reads the raw accessors", () => {
    const offenders = SHIPPED.filter(({ rel }) => !ACCESSOR_ALLOWED.includes(rel))
      .filter(({ source }) => ACCESSOR_RE.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("only the allowlisted modules touch the currency table", () => {
    const offenders = SHIPPED.filter(({ rel }) => !TABLE_ALLOWED.includes(rel))
      .filter(({ source }) => /ISO_4217_CURRENCIES/.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the guard still FAILS for an unlisted consumer (the detector works)", () => {
    // Proves the allowlist is doing the work — an unlisted module that reads
    // either surface is flagged. Without this, widening the allowlist could
    // silently turn the guard into a no-op.
    const intruder = { rel: "pages/SomeNewPage.tsx", source: "const c = readDisplayCurrency();" };
    const table = { rel: "pages/SomeNewPage.tsx", source: "ISO_4217_CURRENCIES.map(x => x)" };

    expect(ACCESSOR_ALLOWED).not.toContain(intruder.rel);
    expect(ACCESSOR_RE.test(intruder.source)).toBe(true);

    expect(TABLE_ALLOWED).not.toContain(table.rel);
    expect(/ISO_4217_CURRENCIES/.test(table.source)).toBe(true);
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
