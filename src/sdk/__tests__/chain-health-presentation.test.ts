// The §M presentation contract as a table: each of the 8 kinds → its label,
// severity tone, dot class, tap-through, banner visibility, and hint shape.

import { describe, expect, it } from "vitest";
import { chainHealthBannerVisible, chainHealthPresentation } from "../chain-health-presentation";
import type { ChainHealth } from "../chain-health";

interface Expected {
  label: string;
  tone: string;
  dotClass: string;
  tappable: boolean;
  banner: boolean;
  hasHint: boolean;
}

const cases: Array<[ChainHealth, Expected]> = [
  [{ kind: "loading" }, { label: "CONNECTING…", tone: "muted", dotClass: "is-muted", tappable: false, banner: false, hasHint: true }],
  [{ kind: "reconnecting", height: 16 }, { label: "LAST SEEN #16 · RECONNECTING…", tone: "warn", dotClass: "is-stale", tappable: false, banner: false, hasHint: true }],
  [{ kind: "live", height: 100 }, { label: "LIVE · #100", tone: "ok", dotClass: "", tappable: false, banner: false, hasHint: false }],
  [{ kind: "stalled", height: 100 }, { label: "STALLED · #100", tone: "warn", dotClass: "is-stale", tappable: true, banner: false, hasHint: true }],
  [{ kind: "untrusted" }, { label: "UNTRUSTED OPERATOR", tone: "err", dotClass: "is-down", tappable: true, banner: true, hasHint: true }],
  [{ kind: "regenesis" }, { label: "ALL OPERATORS UNTRUSTED", tone: "err", dotClass: "is-down", tappable: true, banner: true, hasHint: true }],
  [{ kind: "quarantined" }, { label: "OPERATOR QUARANTINED", tone: "err", dotClass: "is-down", tappable: true, banner: true, hasHint: true }],
  [{ kind: "offline", reason: "x" }, { label: "OFFLINE", tone: "err", dotClass: "is-down", tappable: true, banner: true, hasHint: true }],
];

describe("chainHealthPresentation (§M)", () => {
  for (const [health, e] of cases) {
    it(`${health.kind} → ${e.label} / ${e.tone}`, () => {
      const p = chainHealthPresentation(health);
      expect(p.label).toBe(e.label);
      expect(p.tone).toBe(e.tone);
      expect(p.dotClass).toBe(e.dotClass);
      expect(p.tappable).toBe(e.tappable);
      expect(p.hint !== null).toBe(e.hasHint);
      expect(chainHealthBannerVisible(health.kind)).toBe(e.banner);
    });
  }

  it("only loading uses the no-glow muted dot", () => {
    expect(chainHealthPresentation({ kind: "loading" }).dotClass).toBe("is-muted");
    for (const [health] of cases.filter(([h]) => h.kind !== "loading")) {
      expect(chainHealthPresentation(health).dotClass).not.toBe("is-muted");
    }
  });

  it("the ALL-UNTRUSTED (re-genesis) copy is actionable — names the cause and a remedy, never blames the user", () => {
    const hint = chainHealthPresentation({ kind: "regenesis" }).hint ?? "";
    expect(hint).toMatch(/re-genesis/i);
    expect(hint).toMatch(/update the wallet app/i);
    expect(hint).not.toMatch(/live|connected|synced/i); // never implies a healthy chain
  });
});
