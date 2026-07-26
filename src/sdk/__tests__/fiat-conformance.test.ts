// Source-level guards for the fiat layer (F4).
//
// The property no rendered DOM can prove: the rate producer stays null on every
// PRODUCTION path. A fabricated rate — a constant, an env var, a "temporary"
// value while a feed is wired — would silently turn every honest "{symbol}—"
// into an assertion the wallet cannot back. Tests may pass real rates into the
// FORMATTER (that is its contract surface); nothing outside tests may make the
// producer return non-null.
//
// Scanned via Vite's raw glob (no Node builtins, no new dependency).

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

const FIAT_MODULE = "sdk/fiat.ts";

/** Modules that render a fiat figure. Every one must obtain its rate from the
 *  producer — this list is what makes the "no other rate source" scan concrete. */
const CONSUMERS = [
  "components/SendComposeModal.tsx",
  "pages/Home.tsx",
  "pages/Wallets.tsx",
];

function sourceOf(rel: string): string {
  const found = SHIPPED.find((f) => f.rel === rel);
  if (found === undefined) throw new Error(`expected shipped module missing: ${rel}`);
  return found.source;
}

describe("the scan sees a real tree (non-vacuity)", () => {
  it("finds the fiat module and every declared consumer", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
    const rels = SHIPPED.map((f) => f.rel);
    expect(rels).toContain(FIAT_MODULE);
    for (const c of CONSUMERS) expect(rels).toContain(c);
  });

  it("the consumer list is not empty (a guard over nothing proves nothing)", () => {
    expect(CONSUMERS.length).toBeGreaterThan(0);
  });
});

describe("F4 — the rate producer stays null on every production path", () => {
  it("has exactly ONE definition, in the fiat module", () => {
    const defs = SHIPPED.filter(({ source }) => /export function getLythFiatRate\b/.test(source)).map(
      (f) => f.rel,
    );
    expect(defs).toEqual([FIAT_MODULE]);
  });

  it("its body returns null and contains no numeric rate literal", () => {
    const src = sourceOf(FIAT_MODULE);
    const body = /export function getLythFiatRate\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body).toBeDefined();
    expect(body).toContain("return null");
    // No other return, and no bare number anywhere in the body.
    expect((body!.match(/\breturn\b/g) ?? []).length).toBe(1);
    expect(body).not.toMatch(/\breturn\s+[-0-9]/);
  });

  it("the fiat module performs no network access of any kind", () => {
    const src = sourceOf(FIAT_MODULE);
    for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "axios", "setInterval"]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("no shipped module outside the fiat layer defines a competing rate source", () => {
    const offenders = SHIPPED.filter(({ rel }) => rel !== FIAT_MODULE)
      .filter(({ source }) => /function\s+\w*(FiatRate|LythRate|PriceRate)\w*\s*\(/.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("every consumer gets its rate from the producer, never a literal", () => {
    for (const rel of CONSUMERS) {
      const src = sourceOf(rel);
      // It renders fiat…
      expect(src).toMatch(/formatFiat(FromLythoshi)?\s*\(/);
      // …and the rate it passes comes from the producer.
      expect(src).toContain("getLythFiatRate");
      // No call site hands the formatter a numeric rate directly.
      expect(src).not.toMatch(/formatFiat(FromLythoshi)?\([^)]*,\s*[-0-9]/);
    }
  });

  it("no shipped module calls the formatters without importing the producer", () => {
    const offenders = SHIPPED.filter(({ rel }) => rel !== FIAT_MODULE)
      .filter(({ source }) => /formatFiat(FromLythoshi)?\s*\(/.test(source))
      .filter(({ source }) => !source.includes("getLythFiatRate"))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the detector actually fires (proof the scans above are not no-ops)", () => {
    // A synthetic module that hardcodes a rate must be caught by the same
    // predicate the sweep uses. Without this, tightening the regex into
    // something unmatchable would look like a pass.
    const intruder = `const r = 1.23; formatFiatFromLythoshi(x, "USD", 1.23);`;
    expect(/formatFiat(FromLythoshi)?\s*\(/.test(intruder)).toBe(true);
    expect(intruder.includes("getLythFiatRate")).toBe(false);
    expect(/formatFiat(FromLythoshi)?\([^)]*,\s*[-0-9]/.test(intruder)).toBe(true);
  });
});

describe("F6 — nothing fiat-shaped enters a stored record", () => {
  it("no store, notification or IPC module renders a fiat figure", () => {
    const persistence = SHIPPED.filter(({ rel }) =>
      /(store|notif|activity|ipc|cache)/i.test(rel),
    );
    expect(persistence.length).toBeGreaterThan(3); // the scan sees real modules
    const offenders = persistence
      .filter(({ source }) => /formatFiat(FromLythoshi)?\s*\(|getLythFiatRate/.test(source))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});
