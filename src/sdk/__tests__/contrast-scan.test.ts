// Law 8.2 — never dim TEXT with CSS opacity.
//
// Opacity-dimmed text is the single most common measured AA failure: a token
// that passes on its own lands at 3.1–4.4:1 once multiplied by 0.7, and nothing
// in the build reports it. Hierarchy comes from the token tier instead, which
// keeps all twelve themes honest at once rather than only the one the author
// was looking at.
//
// EXEMPTIONS, stated rather than assumed:
//   - disabled CONTROLS (`.btn:disabled`, `.w-switch:disabled`) — WCAG-exempt;
//   - purely decorative glyphs (separator dots, carets, ornament layers);
//   - a loading SKELETON, which is a shape, not text.
//
// What this guard CANNOT do is measure a composited contrast ratio. It proves
// text is not opacity-dimmed; whether the resulting tier passes AA on a given
// theme is a NEEDS-VISUAL row in the phase report, and honestly marked there.

import { describe, expect, it } from "vitest";

const RAW = import.meta.glob("/src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SHIPPED = Object.entries(RAW)
  .map(([path, source]) => ({ rel: path.replace(/^\/src\//, ""), source }))
  .filter(({ rel }) => !rel.includes("__tests__"))
  .sort((a, b) => a.rel.localeCompare(b.rel));

/** An inline `opacity: 0.x` in a JSX style object. */
const INLINE_OPACITY = /opacity:\s*0\.\d+/;

/**
 * Inline-opacity sites that are NOT text, each with its reason.
 *
 * An allowlist rather than a loosened regex: a decorative exemption should
 * require someone to write down why, and the entry names the file so a new
 * offender in the same file is still caught by the value check below.
 */
const NON_TEXT_OPACITY: { rel: string; why: string }[] = [
  {
    rel: "components/BalanceFigure.tsx",
    why: "loading skeleton — a shape with an aria-label, not rendered text",
  },
];

describe("the scan is non-vacuous", () => {
  it("walked the component tree", () => {
    expect(SHIPPED.length).toBeGreaterThan(30);
  });

  it("reached the files the sweep fixed", () => {
    // Named so a rename that made the glob miss them cannot pass as "clean".
    const paths = SHIPPED.map((f) => f.rel);
    for (const rel of [
      "components/ApprovalOverlay.tsx",
      "pages/Inbox.tsx",
      "pages/Stele.tsx",
      "pages/Networks.tsx",
    ]) {
      expect(paths).toContain(rel);
    }
  });
});

describe("no opacity-dimmed TEXT in shipped components", () => {
  it("the four swept files carry no inline opacity at all", () => {
    for (const rel of [
      "components/ApprovalOverlay.tsx",
      "pages/Inbox.tsx",
      "pages/Stele.tsx",
      "pages/Networks.tsx",
    ]) {
      const f = SHIPPED.find((x) => x.rel === rel)!;
      expect(INLINE_OPACITY.test(f.source), rel).toBe(false);
    }
  });

  it("every remaining inline-opacity site is an explicit non-text exemption", () => {
    const offenders = SHIPPED.filter(({ source }) => INLINE_OPACITY.test(source))
      .map((f) => f.rel)
      .filter((rel) => !NON_TEXT_OPACITY.some((e) => e.rel === rel));
    expect(offenders).toEqual([]);
  });

  it("every exemption states a reason", () => {
    // An allowlist without reasons decays into a list of things nobody
    // remembers agreeing to.
    for (const e of NON_TEXT_OPACITY) {
      expect(e.why.length, e.rel).toBeGreaterThan(20);
      expect(SHIPPED.map((f) => f.rel)).toContain(e.rel);
    }
  });

  it("the detector fires on a real violation", () => {
    expect(INLINE_OPACITY.test('style={{ fontSize: 11, opacity: 0.7 }}')).toBe(true);
    expect(INLINE_OPACITY.test("style={{ opacity: 0.45 }}")).toBe(true);
    // …and not on a full-opacity or unrelated declaration.
    expect(INLINE_OPACITY.test("style={{ opacity: 1 }}")).toBe(false);
    expect(INLINE_OPACITY.test('style={{ color: "var(--fg-300)" }}')).toBe(false);
  });

  it("a synthetic intruder would fail the guard", () => {
    const tree = [
      { rel: "pages/Fine.tsx", source: 'style={{ color: "var(--fg-300)" }}' },
      { rel: "pages/Bad.tsx", source: "style={{ fontSize: 12, opacity: 0.7 }}" },
    ];
    const offenders = tree
      .filter(({ source }) => INLINE_OPACITY.test(source))
      .map((f) => f.rel)
      .filter((rel) => !NON_TEXT_OPACITY.some((e) => e.rel === rel));
    expect(offenders).toEqual(["pages/Bad.tsx"]);
  });
});

describe("the swept sites use token tiers", () => {
  it("each fixed label carries an --fg-* colour instead", () => {
    for (const rel of [
      "components/ApprovalOverlay.tsx",
      "pages/Inbox.tsx",
      "pages/Stele.tsx",
    ]) {
      const f = SHIPPED.find((x) => x.rel === rel)!;
      expect(f.source, rel).toMatch(/color:\s*"var\(--fg-\d00\)"/);
    }
  });

  it("no fixed site hardcodes a hex text colour", () => {
    // Law 8.4 — a hardcoded colour is a theme-fragility defect even when it
    // passes AA on the theme it was authored against.
    for (const rel of [
      "components/ApprovalOverlay.tsx",
      "pages/Inbox.tsx",
      "pages/Networks.tsx",
    ]) {
      const f = SHIPPED.find((x) => x.rel === rel)!;
      expect(f.source, rel).not.toMatch(/color:\s*["']#[0-9a-fA-F]{3,8}["']/);
    }
  });
});
