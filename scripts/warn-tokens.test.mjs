import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Law 4 — the warn tint must exist in EVERY theme.
//
// A frozen `rgba(244, 201, 122, …)` literal looks correct on the theme it was
// authored against and is silently wrong on the other eleven — silently,
// because nothing errors and the box still renders. The only thing that catches
// that is a test which reads the stylesheets.
//
// This lives in scripts/ rather than src/**/__tests__ because Vitest stubs CSS
// imports to empty strings by default, so a Vite `?raw` glob over *.css yields
// "" and every assertion below would pass for the wrong reason. Reading from
// disk is the only way this test can be honest. (`csp-drift.test.mjs` reads
// committed config the same way, for the same reason.)
//
// The wallet ships 12 themes: the base block in tokens.css IS the default
// theme, plus 11 `data-theme` blocks in themes.css.

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

const tokens = read("src/styles/tokens.css");
const themes = read("src/styles/themes.css");
const wallet = read("src/styles/wallet.css");

/** Every `--warn-glow: R, G, B;` definition. */
const glowDefs = (s) => s.match(/--warn-glow:\s*[\d\s,]+;/g) ?? [];
/** Every `--warn: #hex;` definition. */
const warnDefs = (s) => s.match(/--warn:\s*#[0-9a-fA-F]{3,8};/g) ?? [];
/** DISTINCT theme names. The selector appears in many rules per theme, not
 *  only the root variable block, so the raw match count is not a theme count. */
const themeNames = (s) => [
  ...new Set([...s.matchAll(/\[data-theme=["']([^"']+)["']\]/g)].map((m) => m[1])),
];

describe("the stylesheets were actually read", () => {
  it("all three are non-trivial", () => {
    // Without this the whole file could pass on empty strings — which is
    // exactly what happened when it was written as a Vite raw glob.
    expect(tokens.length).toBeGreaterThan(500);
    expect(themes.length).toBeGreaterThan(500);
    expect(wallet.length).toBeGreaterThan(500);
  });

  it("and contain the landmarks this file reasons about", () => {
    expect(tokens).toContain("--warn:");
    expect(themes).toContain("[data-theme=");
    expect(wallet).toContain(".w-banner");
  });
});

describe("--warn-glow exists once per theme", () => {
  it("the base block defines it (the base block IS the default theme)", () => {
    expect(tokens).toMatch(/--warn-glow:\s*244,\s*201,\s*122;/);
    expect(glowDefs(tokens)).toHaveLength(1);
  });

  it("all 11 data-theme blocks define it", () => {
    expect(themeNames(themes)).toHaveLength(11);
    expect(glowDefs(themes)).toHaveLength(11);
  });

  it("12 definitions in total, one per theme", () => {
    expect(glowDefs(tokens).length + glowDefs(themes).length).toBe(12);
  });

  it("every block that sets --warn also sets --warn-glow", () => {
    // The pairing is the real invariant: a theme that picks its own warn colour
    // and inherits someone else's tint is the exact failure this guards.
    expect(warnDefs(tokens)).toHaveLength(glowDefs(tokens).length);
    expect(warnDefs(themes)).toHaveLength(glowDefs(themes).length);
  });

  it("every triplet is three plausible channel values", () => {
    for (const def of [...glowDefs(tokens), ...glowDefs(themes)]) {
      const parts = def.replace(/--warn-glow:\s*/, "").replace(";", "").split(",");
      expect(parts).toHaveLength(3);
      for (const p of parts) {
        const n = Number(p.trim());
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe(".w-warn-prominent — the one loud warning box", () => {
  const rule = wallet.slice(wallet.indexOf(".w-warn-prominent"));
  const body = rule.slice(0, rule.indexOf("}"));

  it("exists", () => {
    expect(wallet).toContain(".w-warn-prominent");
    expect(body.length).toBeGreaterThan(50);
  });

  it("is tinted through the token, never a frozen literal", () => {
    expect(body).toContain("rgba(var(--warn-glow), 0.10)");
    expect(body).toContain("rgba(var(--warn-glow), 0.25)");
    expect(body).toContain("var(--warn)");
    // No `rgba(244, …)`-style literal anywhere in the rule.
    expect(body).not.toMatch(/rgba\(\s*\d+\s*,/);
  });

  it("carries the settled anatomy", () => {
    expect(body).toContain("var(--f-mono)");
    expect(body).toContain("font-size: 12px");
    expect(body).toContain("font-weight: 600");
    expect(body).toContain("box-shadow");
  });
});

describe("no frozen warn-amber literals survive in consumer stylesheets", () => {
  it("wallet.css tints every warn surface through the token", () => {
    // Whitespace-tolerant, matching the two amber values this tree used.
    expect(wallet).not.toMatch(/rgba\(\s*244,\s*201,\s*122/);
    expect(wallet).not.toMatch(/rgba\(\s*242,\s*180,\s*65/);
  });

  it("the detector fires on a synthetic offender", () => {
    // Proves the two patterns above would actually catch a reintroduction, in
    // both the spaced and unspaced forms this codebase writes.
    const bad = ".x { background: rgba(244, 201, 122, 0.08); }";
    const badTight = ".x { border-color: rgba(242,180,65,0.4); }";
    expect(bad).toMatch(/rgba\(\s*244,\s*201,\s*122/);
    expect(badTight).toMatch(/rgba\(\s*242,\s*180,\s*65/);
  });
});
