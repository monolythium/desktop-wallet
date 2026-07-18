// The gated-feature presentation law and the sidebar placement laws, as
// regression guards.
//
// These encode decisions that are easy to erode one entry at a time: gated
// features are OMITTED rather than shown disabled-with-a-promise, destructive
// entries stay at the bottom, and no rendered string ever promises something
// unbuilt.

import { describe, expect, it } from "vitest";
import { NAV_CATEGORIES, visibleNav, type NavFlags } from "../nav-config";

const ALL_OFF: NavFlags = {
  steleEnabled: false,
  experimentalEnabled: false,
  developerModeEnabled: false,
};
const ALL_ON: NavFlags = {
  steleEnabled: true,
  experimentalEnabled: true,
  developerModeEnabled: true,
};

/** Every shipped source file, so the copy gate scans the real tree. */
const RAW = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SHIPPED = Object.entries(RAW)
  .map(([path, source]) => ({ rel: path.replace(/^\/src\//, ""), source }))
  .filter(({ rel }) => !rel.includes("__tests__") && !rel.startsWith("test/"));

const itemsOf = (cats: typeof NAV_CATEGORIES) => cats.flatMap((c) => c.items);

describe("H6 — no 'coming soon', anywhere", () => {
  it("the scan sees a real tree (not vacuous)", () => {
    expect(SHIPPED.length).toBeGreaterThan(50);
    expect(SHIPPED.map((f) => f.rel)).toContain("components/nav-config.tsx");
  });

  it("no shipped source file promises an unbuilt feature", () => {
    const offenders = SHIPPED.filter(({ source }) => /coming soon/i.test(source)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  // NOTE: the related law — no internal phase/roadmap vocabulary in RENDERED
  // strings — is deliberately NOT enforced by a source grep here. Source-level
  // regexes cannot distinguish a UI string from a code comment (comments
  // legitimately cite spec sections, and quote-spanning matches make a naive
  // regex report false offenders), so such a guard would look rigorous while
  // being unsound. It is asserted at DOM level instead, on the surfaces that
  // render copy — see the FeaturesHintBar and SetupHealthChip suites.

  it("the detector actually fires (proof the sweep is not a no-op)", () => {
    expect(/coming soon/i.test("Swaps — coming soon!")).toBe(true);
    expect(/coming soon/i.test("Coming Soon")).toBe(true);
  });
});

describe("gated entries use a permitted presentation tier", () => {
  // Two tiers are in play, deliberately:
  //   • PRODUCT surfaces (stele / experimental) have no stub, so they are
  //     OMITTED entirely when their flag is off.
  //   • DEVELOPER surfaces stay discoverable with a "dev" badge, because their
  //     destination renders an explanatory stub — a vanished menu item teaches
  //     nothing, whereas the stub carries the explanation and the escape route.
  // Both are tiers the gated-feature law allows; neither is a "coming soon".
  it("product surfaces disappear when their flag is off", () => {
    const off = itemsOf(visibleNav(NAV_CATEGORIES, ALL_OFF)).map((i) => i.id);
    for (const gated of ["agents", "ai-trade", "stele"]) {
      expect(off).not.toContain(gated);
    }
  });

  it("they reappear when the flag is on", () => {
    const on = itemsOf(visibleNav(NAV_CATEGORIES, ALL_ON)).map((i) => i.id);
    for (const gated of ["agents", "ai-trade", "stele", "studio", "riscv"]) {
      expect(on).toContain(gated);
    }
  });

  it("developer surfaces stay discoverable, carrying their dev badge", () => {
    const off = visibleNav(NAV_CATEGORIES, ALL_OFF);
    for (const id of ["studio", "riscv"]) {
      const item = itemsOf(off).find((i) => i.id === id);
      expect(item).toBeDefined();
      expect(item!.badge).toBe("dev");
    }
  });

  it("a category left with no visible items renders no header", () => {
    const visible = visibleNav(NAV_CATEGORIES, ALL_OFF);
    expect(visible.every((c) => c.items.length > 0)).toBe(true);
  });

  it("ungated entries are unaffected by the flags", () => {
    const off = itemsOf(visibleNav(NAV_CATEGORIES, ALL_OFF)).map((i) => i.id);
    for (const always of ["home", "activity", "wallets", "contacts", "settings"]) {
      expect(off).toContain(always);
    }
  });
});

describe("placement laws", () => {
  it("Notifications is default-on with its own ungated category", () => {
    const cat = visibleNav(NAV_CATEGORIES, ALL_OFF).find((c) => c.id === "notifications");
    expect(cat).toBeDefined();
    expect(cat!.items.map((i) => i.id)).toContain("notifications");
  });

  it("the recovery entry uses the honest label (no emergency-key claim)", () => {
    const security = NAV_CATEGORIES.find((c) => c.id === "security")!;
    expect(security.items.map((i) => i.label)).toEqual(["Recovery phrase"]);
  });

  it("destructive entries sit in the LAST category and are flagged danger", () => {
    const last = NAV_CATEGORIES[NAV_CATEGORIES.length - 1]!;
    expect(last.items.map((i) => i.id).sort()).toEqual(["lock", "reset"]);
    expect(last.items.every((i) => i.danger === true)).toBe(true);
  });

  it("the badge vocabulary is closed", () => {
    const badges = itemsOf(NAV_CATEGORIES)
      .map((i) => i.badge)
      .filter((b): b is string => b !== undefined);
    expect(badges.length).toBeGreaterThan(0); // non-vacuous
    for (const b of badges) {
      expect(["preview", "dev", "early"]).toContain(b);
    }
  });

  it("every badge belongs to a gated entry (no badge without a gate)", () => {
    for (const item of itemsOf(NAV_CATEGORIES)) {
      if (item.badge === undefined) continue;
      expect(
        item.steleOnly === true || item.experimentalOnly === true || item.developerOnly === true,
      ).toBe(true);
    }
  });

  it("RISC-V stays developer-gated (left as-is this phase; see the report)", () => {
    const riscv = itemsOf(NAV_CATEGORIES).find((i) => i.id === "riscv")!;
    expect(riscv.developerOnly).toBe(true);
  });

  it("every item id is unique", () => {
    const ids = itemsOf(NAV_CATEGORIES).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
