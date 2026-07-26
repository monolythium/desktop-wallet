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

  it("gates stele/experimental items by their flags", () => {
    const cats: NavCategory[] = [
      {
        id: "p",
        items: [
          { id: "always", label: "A", icon: ic, route: "home" },
          { id: "stele", label: "S", icon: ic, route: "stele", steleOnly: true },
          { id: "exp", label: "E", icon: ic, route: "agents", experimentalOnly: true },
        ],
      },
    ];
    expect(visibleNav(cats, ALL_OFF)[0]!.items.map((i) => i.id)).toEqual(["always"]);
    expect(visibleNav(cats, ALL_ON)[0]!.items.map((i) => i.id)).toEqual(["always", "stele", "exp"]);
  });

  it("keeps developerOnly items discoverable regardless of the flag (the destination stubs)", () => {
    const cats: NavCategory[] = [
      {
        id: "p",
        items: [
          { id: "always", label: "A", icon: ic, route: "home" },
          { id: "dev", label: "D", icon: ic, route: "studio", developerOnly: true, badge: "dev" },
        ],
      },
    ];
    // Visible with developer mode OFF and ON alike.
    expect(visibleNav(cats, ALL_OFF)[0]!.items.map((i) => i.id)).toEqual(["always", "dev"]);
    expect(visibleNav(cats, ALL_ON)[0]!.items.map((i) => i.id)).toEqual(["always", "dev"]);
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
    expect(byId.get("operators")).toBe("operators");
    expect(byId.get("riscv")).toBe("riscv");
    expect(byId.get("notifications")).toBe("notifications");
    expect(byId.get("recovery")).toBe("recovery"); // BIP-39 reveal
    expect(byId.get("display")).toBe("display"); // appearance sub-page
    expect(byId.get("settings")).toBe("settings");
    expect(byId.get("lock")).toBe("action:lock");
    expect(byId.get("reset")).toBe("reset");
  });

  it("marks the developer surfaces (Studio, RISC-V) developerOnly with a dev badge", () => {
    for (const id of ["studio", "riscv"]) {
      const item = flat.find((i) => i.id === id);
      expect(item?.developerOnly).toBe(true);
      expect(item?.badge).toBe("dev");
    }
  });

  it("shows Operators under Manage, ungated (an all-users surface)", () => {
    const manage = NAV_CATEGORIES.find((c) => c.id === "manage");
    const operators = manage?.items.find((i) => i.id === "operators");
    expect(operators?.route).toBe("operators");
    expect(operators?.developerOnly).toBeFalsy();
    // Visible with every flag off.
    const ids = visibleNav(NAV_CATEGORIES, ALL_OFF).flatMap((c) => c.items.map((i) => i.id));
    expect(ids).toContain("operators");
  });

  it("labels the recovery item honestly (not 'Emergency recovery')", () => {
    const recovery = flat.find((i) => i.id === "recovery");
    expect(recovery?.label).toBe("Recovery phrase");
  });

  it("wires the Info category (About / Resources / Why Monolythium)", () => {
    const info = NAV_CATEGORIES.find((c) => c.id === "info");
    expect(info?.header).toBe("Info");
    const byId = new Map((info?.items ?? []).map((i) => [i.id, i.route]));
    expect(byId.get("about")).toBe("about");
    expect(byId.get("resources")).toBe("resources");
    expect(byId.get("why")).toBe("why-monolythium");
  });

  it("renders the Info category with no flags (its items are ungated)", () => {
    const ids = visibleNav(NAV_CATEGORIES, ALL_OFF).map((c) => c.id);
    expect(ids).toContain("info");
  });

  it("shows Notifications by default (graduated — not experimental-gated)", () => {
    expect(flat.find((i) => i.id === "notifications")?.experimentalOnly).toBeFalsy();
    // It appears with every gate off (a fresh install).
    const ids = visibleNav(NAV_CATEGORIES, ALL_OFF).flatMap((c) =>
      c.items.map((i) => i.id),
    );
    expect(ids).toContain("notifications");
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
