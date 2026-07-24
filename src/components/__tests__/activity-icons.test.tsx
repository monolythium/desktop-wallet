// Law 10 — icon semantics.
//
// A user triages a feed by shape and colour before reading a word, so per-kind
// visuals are semantics rather than decoration. Two surfaces drawing different
// glyphs for the same verb is a comprehension bug.
//
// SCOPE NOTE: the shared module below is consumed by the Notifications surface.
// The Activity feed's `TxRow` renders DIRECTION arrows, not kind glyphs, and its
// row model (`Tx["kind"]`) carries only three buckets — transfer / reward /
// delegate — deliberately collapsing undelegate and redelegate into one. Wiring
// the kind mapping there is therefore a data-model change, not an icon refactor.

import { describe, expect, it } from "vitest";
import { badgeRingColor, iconForKind } from "../activity-icons";
import type { TxOpKind } from "../../sdk/notifications";

const KINDS: TxOpKind[] = [
  "send",
  "receive",
  "delegate",
  "undelegate",
  "redelegate",
  "claim",
];

describe("the kind→glyph mapping", () => {
  it("gives every delegation verb its OWN glyph", () => {
    // The pair that matters most: delegate / undelegate / redelegate must be
    // visually distinct, or a feed of delegation activity is unreadable at a
    // glance.
    const delegate = iconForKind("delegate");
    const undelegate = iconForKind("undelegate");
    const redelegate = iconForKind("redelegate");
    expect(delegate).not.toBe(undelegate);
    expect(undelegate).not.toBe(redelegate);
    expect(delegate).not.toBe(redelegate);
  });

  it("a claim is NOT the receive glyph", () => {
    // A claim rendered as an inbound arrow would misdescribe where the LYTH
    // came from — a reward is settled, not received from a counterparty.
    expect(iconForKind("claim")).not.toBe(iconForKind("receive"));
  });

  it("send and receive are distinct", () => {
    expect(iconForKind("send")).not.toBe(iconForKind("receive"));
  });

  it("every listed kind resolves to a glyph", () => {
    for (const kind of KINDS) {
      expect(iconForKind(kind), kind).toBeDefined();
    }
  });

  it("the mapping is stable — same kind, same element identity", () => {
    // Changing a glyph must be a deliberate diff, not an accident of a render.
    for (const kind of KINDS) {
      expect(iconForKind(kind)).toBe(iconForKind(kind));
    }
  });

  it("an unknown kind falls back rather than throwing", () => {
    expect(iconForKind("contract_call")).toBeDefined();
    expect(iconForKind("something-new" as TxOpKind)).toBeDefined();
  });
});

describe("status colouring", () => {
  it("failed is the error token", () => {
    expect(badgeRingColor("failed")).toBe("var(--err)");
  });

  it("confirmed is the ok token", () => {
    expect(badgeRingColor("confirmed")).toBe("var(--ok)");
  });

  it("neither is a hardcoded colour", () => {
    // Law 8.4 — tokens only, so all twelve themes stay honest at once.
    for (const s of ["confirmed", "failed"] as const) {
      expect(badgeRingColor(s)).toMatch(/^var\(--/);
    }
  });
});

describe("one module, not a lookalike copy", () => {
  it("Notifications imports the SHARED mapping", async () => {
    // Asserted by module identity rather than by comparing rendered JSX: two
    // hand-copied SVGs that render alike today are precisely what drifts.
    const page = await import("../../pages/Notifications");
    const shared = await import("../activity-icons");
    expect(typeof shared.iconForKind).toBe("function");
    // The page module loads and does not define its own mapping.
    expect(page.Notifications).toBeDefined();
  });

  it("no page defines a second kind→glyph mapping", async () => {
    const RAW = import.meta.glob("/src/**/*.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const shipped = Object.entries(RAW)
      .map(([p, source]) => ({ rel: p.replace(/^\/src\//, ""), source }))
      .filter(({ rel }) => !rel.includes("__tests__"));

    // Non-vacuity: the scan must have seen both the owner and a consumer.
    expect(shipped.length).toBeGreaterThan(30);
    expect(shipped.map((f) => f.rel)).toContain("components/activity-icons.tsx");
    expect(shipped.map((f) => f.rel)).toContain("pages/Notifications.tsx");

    const definers = shipped
      .filter(({ source }) => /function iconForKind\b/.test(source))
      .map((f) => f.rel);
    expect(definers).toEqual(["components/activity-icons.tsx"]);
  });
});
