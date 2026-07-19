// Law 4 — the tint conversion is a RESTYLE. It changes no copy, no gating,
// and no signed bytes.
//
// That guarantee is the only reason a styling sweep is safe to run across
// warning surfaces at all: the warnings being restyled are the ones that block
// a send or gate a backup, and a "just a colour" commit that quietly changed a
// predicate would be the worst possible way to learn that.
//
// It also pins Law 4.3 — tint follows TEXT semantics. A warn-coloured surface
// takes --warn-glow; an accent-coloured one takes --gold-glow. Mixing them is
// how a warning ends up looking like a call to action.

import { describe, expect, it } from "vitest";

const SRC = import.meta.glob("/src/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const shipped = Object.entries(SRC)
  .map(([path, source]) => ({ rel: path.replace(/^\/src\//, ""), source }))
  .filter(({ rel }) => !rel.includes("__tests__"));

function source(rel: string): string {
  const hit = shipped.find((f) => f.rel === rel);
  if (!hit) throw new Error(`could not read src/${rel}`);
  return hit.source;
}

describe("the scan is real", () => {
  it("walked the component tree and found the converted files", () => {
    expect(shipped.length).toBeGreaterThan(30);
    for (const rel of [
      "components/SendComposeModal.tsx",
      "components/MnemonicGrid.tsx",
      "components/VerifyPhrase.tsx",
      "components/UpdateBanner.tsx",
    ]) {
      expect(shipped.map((f) => f.rel)).toContain(rel);
    }
  });
});

describe("no frozen amber literal survives in a component", () => {
  it("none of the four converted files carries one", () => {
    for (const rel of [
      "components/SendComposeModal.tsx",
      "components/MnemonicGrid.tsx",
      "components/VerifyPhrase.tsx",
      "components/UpdateBanner.tsx",
    ]) {
      expect(source(rel), `${rel}`).not.toMatch(/rgba\(\s*244\s*,\s*201\s*,\s*122/);
      expect(source(rel), `${rel}`).not.toMatch(/rgba\(\s*242\s*,\s*180\s*,\s*65/);
    }
  });

  it("no shipped .tsx anywhere carries one", () => {
    const offenders = shipped
      .filter(
        ({ source: s }) =>
          /rgba\(\s*244\s*,\s*201\s*,\s*122/.test(s) || /rgba\(\s*242\s*,\s*180\s*,\s*65/.test(s),
      )
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the detector fires on a synthetic offender", () => {
    // Both the spaced and the unspaced form this codebase actually wrote.
    expect(/rgba\(\s*244\s*,\s*201\s*,\s*122/.test("rgba(244, 201, 122, 0.08)")).toBe(true);
    expect(/rgba\(\s*242\s*,\s*180\s*,\s*65/.test("rgba(242,180,65,0.4)")).toBe(true);
    // …and not on an unrelated colour.
    expect(/rgba\(\s*244\s*,\s*201\s*,\s*122/.test("rgba(126, 227, 193, 0.08)")).toBe(false);
  });
});

describe("Law 4.3 — the tint follows the text semantics", () => {
  it("warn-semantic surfaces take the warn triplet", () => {
    // The first-time-recipient caution and the never-share-these-words note.
    expect(source("components/SendComposeModal.tsx")).toContain("rgba(var(--warn-glow), 0.08)");
    expect(source("components/MnemonicGrid.tsx")).toContain("rgba(var(--warn-glow), 0.08)");
  });

  it("accent-semantic surfaces take the gold triplet", () => {
    // VerifyPhrase's word chips and slots are var(--gold) TEXT — they mark
    // where to act, they do not warn. The update banner is the same family.
    // The spec's fix table said "warn" for these; Law 4.3 governs, and tinting
    // a gold-text control with the warn colour is exactly the mix it forbids.
    const verify = source("components/VerifyPhrase.tsx");
    expect(verify).toContain("rgba(var(--gold-glow), 0.08)");
    expect(verify).toContain("rgba(var(--gold-glow), 0.10)");
    expect(verify).not.toContain("var(--warn-glow)");
    expect(source("components/UpdateBanner.tsx")).toContain("rgba(var(--gold-glow), 0.18)");
  });
});

describe("the restyle changed no copy", () => {
  it("the phrase-safety wording is byte-identical", () => {
    const grid = source("components/MnemonicGrid.tsx");
    expect(grid).toContain("Never share these 24 words.");
    expect(grid).toContain("Anyone who has them");
    expect(grid).toContain(
      "Don't screenshot them or save them in cloud notes, photos, or a password",
    );
  });

  it("the update banner's copy is byte-identical", () => {
    expect(source("components/UpdateBanner.tsx")).toContain(
      "A wallet update is available",
    );
    expect(source("components/UpdateBanner.tsx")).toContain(
      "Couldn't reach the update service — try again later.",
    );
  });
});
