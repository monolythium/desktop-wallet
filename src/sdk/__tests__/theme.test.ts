// Theme + layout engine pins. The vitest environment is jsdom, so
// document.documentElement and localStorage are the real browser-like
// implementations — assert the actual attribute + storage side effects.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUT,
  DEFAULT_THEME,
  LAYOUTS,
  LAYOUT_STORAGE_KEY,
  THEMES,
  THEME_STORAGE_KEY,
  SIDEBAR_STORAGE_KEY,
  applyLayout,
  applySidebarCollapsed,
  applyTheme,
  isLayoutId,
  isThemeId,
  readLayout,
  readSidebarCollapsed,
  readTheme,
} from "../theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-layout");
  document.documentElement.removeAttribute("data-sidebar");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-layout");
  document.documentElement.removeAttribute("data-sidebar");
});

describe("theme", () => {
  it("validates known theme ids", () => {
    expect(isThemeId("neon")).toBe(true);
    expect(isThemeId("monolythium")).toBe(true);
    expect(isThemeId("not-a-theme")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });

  it("defaults to monolythium when nothing valid is stored", () => {
    expect(readTheme()).toBe(DEFAULT_THEME);
    localStorage.setItem(THEME_STORAGE_KEY, "bogus");
    expect(readTheme()).toBe(DEFAULT_THEME);
  });

  it("applies a non-default theme via data-theme and persists it", () => {
    applyTheme("neon");
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("neon");
    expect(readTheme()).toBe("neon");
  });

  it("renders the default theme by removing the attribute (native :root)", () => {
    applyTheme("neon");
    applyTheme(DEFAULT_THEME);
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(DEFAULT_THEME);
  });

  it("falls back to the default for an unknown id", () => {
    applyTheme("bogus");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(DEFAULT_THEME);
  });

  it("ships exactly the 12 Monarch palettes, all well-formed", () => {
    expect(THEMES).toHaveLength(12);
    expect(THEMES.some((t) => t.id === DEFAULT_THEME)).toBe(true);
    const ids = new Set(THEMES.map((t) => t.id));
    expect(ids.size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.desc).toBeTruthy();
      expect(/^#[0-9a-f]{6}$/i.test(t.swatch)).toBe(true);
    }
  });
});

describe("layout", () => {
  it("validates layout ids", () => {
    expect(isLayoutId("sidebar")).toBe(true);
    expect(isLayoutId("topbar")).toBe(true);
    expect(isLayoutId("grid")).toBe(false);
    expect(isLayoutId(null)).toBe(false);
  });

  it("exposes both layouts with sidebar as the default", () => {
    expect([...LAYOUTS]).toEqual(["sidebar", "topbar"]);
    expect(DEFAULT_LAYOUT).toBe("sidebar");
  });

  it("defaults to sidebar when nothing valid is stored", () => {
    expect(readLayout()).toBe(DEFAULT_LAYOUT);
    localStorage.setItem(LAYOUT_STORAGE_KEY, "grid");
    expect(readLayout()).toBe(DEFAULT_LAYOUT);
  });

  it("applies topbar via data-layout and persists it", () => {
    applyLayout("topbar");
    expect(document.documentElement.getAttribute("data-layout")).toBe("topbar");
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe("topbar");
    expect(readLayout()).toBe("topbar");
  });

  it("renders the default layout by removing the attribute", () => {
    applyLayout("topbar");
    applyLayout("sidebar");
    expect(document.documentElement.getAttribute("data-layout")).toBeNull();
    expect(localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe("sidebar");
  });
});

describe("sidebar collapse", () => {
  it("defaults to OPEN (collapsed=false) when nothing is stored", () => {
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("collapses via data-sidebar and persists it", () => {
    applySidebarCollapsed(true);
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("collapsed");
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("1");
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("expands by removing the attribute and round-trips the state", () => {
    applySidebarCollapsed(true);
    applySidebarCollapsed(false);
    expect(document.documentElement.getAttribute("data-sidebar")).toBeNull();
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("0");
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("treats a stored '0' / garbage as OPEN (only '1' is collapsed)", () => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "0");
    expect(readSidebarCollapsed()).toBe(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "yes");
    expect(readSidebarCollapsed()).toBe(false);
  });
});
