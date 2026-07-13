// Invariants for the Help content: every support link is a real, already-shipped
// Resources link (no fabricated URL), and the chain-health guidance is pulled
// from the live presentation source (non-empty, covering the actionable states).

import { describe, expect, it } from "vitest";
import { HELP_LINKS, HELP_SECTIONS } from "../help-content";
import { EXTERNAL_LINKS } from "../chain-content";
import { chainHealthHelpEntries } from "../chain-health-presentation";

describe("help-content", () => {
  it("only links to canonical Resources URLs — no invented support channel", () => {
    const allowed = new Set(EXTERNAL_LINKS.map((l) => l.url));
    expect(HELP_LINKS.length).toBeGreaterThan(0);
    for (const link of HELP_LINKS) {
      expect(allowed.has(link.url)).toBe(true);
      expect(link.url).not.toMatch(/discord|telegram|t\.me|mailto:|support/i);
    }
  });

  it("has at least the documentation and source repository", () => {
    const labels = HELP_LINKS.map((l) => l.label);
    expect(labels).toContain("Documentation");
    expect(labels).toContain("GitHub");
  });

  it("provides non-empty FAQ answers", () => {
    expect(HELP_SECTIONS.length).toBeGreaterThan(0);
    for (const section of HELP_SECTIONS) {
      for (const item of section.items) {
        expect(item.q.length).toBeGreaterThan(0);
        expect(item.a.length).toBeGreaterThan(0);
        expect(item.a.every((p) => p.trim().length > 0)).toBe(true);
      }
    }
  });
});

describe("chainHealthHelpEntries", () => {
  it("covers the actionable states with the shipped hint copy", () => {
    const entries = chainHealthHelpEntries();
    const kinds = entries.map((e) => e.kind);
    for (const k of ["regenesis", "untrusted", "quarantined", "offline"]) {
      expect(kinds).toContain(k);
    }
    // Every entry carries a real, non-empty "what to do" hint.
    expect(entries.every((e) => e.hint.trim().length > 0)).toBe(true);
    // The re-genesis entry keeps its actionable "update the app" guidance.
    const regen = entries.find((e) => e.kind === "regenesis");
    expect(regen?.hint).toMatch(/update the wallet app/i);
  });
});
