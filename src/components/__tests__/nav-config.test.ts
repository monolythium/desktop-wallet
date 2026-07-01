import { describe, expect, it } from "vitest";
import {
  NAV_CATEGORIES,
  visibleNav,
  type NavCategory,
  type NavItem,
} from "../nav-config";

// A stand-in icon (the filter never renders it).
const ic = (() => null) as unknown as NavItem["icon"];
const ALL_OFF = { developerModeEnabled: false, steleEnabled: false, experimentalEnabled: false };
const ALL_ON = { developerModeEnabled: true, steleEnabled: true, experimentalEnabled: true };

describe("visibleNav", () => {
  it("drops a category once all its items are filtered out (no empty headers)", () => {
    const cats: NavCategory[] = [
      { id: "a", header: "A", items: [{ id: "x", label: "X", icon: ic, route: "home", experimentalOnly: true }] },
      { id: "b", items: [{ id: "y", label: "Y", icon: ic, route: "home" }] },
    ];
    expect(visibleNav(cats, ALL_OFF).map((c) => c.id)).toEqual(["b"]);
    expect(visibleNav(cats, { ...ALL_OFF, experimentalEnabled: true }).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("filters items by their flag gates", () => {
    const cats: NavCategory[] = [
      {
        id: "p",
        items: [
          { id: "always", label: "A", icon: ic, route: "home" },
          { id: "dev", label: "D", icon: ic, route: "studio", developerOnly: true },
          { id: "stele", label: "S", icon: ic, route: "stele", steleOnly: true },
          { id: "exp", label: "E", icon: ic, route: "agents", experimentalOnly: true },
        ],
      },
    ];
    expect(visibleNav(cats, ALL_OFF)[0]!.items.map((i) => i.id)).toEqual(["always"]);
    expect(visibleNav(cats, ALL_ON)[0]!.items.map((i) => i.id)).toEqual(["always", "dev", "stele", "exp"]);
  });

  it("is pure — never mutates the input categories", () => {
    const cats: NavCategory[] = [
      { id: "p", items: [{ id: "exp", label: "E", icon: ic, route: "agents", experimentalOnly: true }] },
    ];
    visibleNav(cats, ALL_OFF);
    expect(cats[0]!.items).toHaveLength(1);
  });
});

describe("NAV_CATEGORIES config", () => {
  const flat = NAV_CATEGORIES.flatMap((c) => c.items);

  it("gives each item exactly one of route or action", () => {
    for (const item of flat) {
      expect((item.route !== undefined) !== (item.action !== undefined)).toBe(true);
    }
  });

  it("wires the Phase-1 destinations to their real routes/actions", () => {
    const byId = new Map(flat.map((i) => [i.id, i.route ?? `action:${i.action}`]));
    expect(byId.get("contacts")).toBe("contacts");
    expect(byId.get("riscv")).toBe("riscv");
    expect(byId.get("notifications")).toBe("notifications");
    expect(byId.get("settings")).toBe("settings");
    expect(byId.get("lock")).toBe("action:lock");
  });

  it("keeps Notifications experimental-gated (the notification pipeline is experimental)", () => {
    expect(flat.find((i) => i.id === "notifications")?.experimentalOnly).toBe(true);
  });

  it("has no entry for the omitted features (no-mock)", () => {
    const ids = flat.map((i) => i.id);
    expect(ids).not.toContain("connected-sites");
    expect(ids).not.toContain("multisig");
  });

  it("has unique item ids", () => {
    const ids = flat.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
