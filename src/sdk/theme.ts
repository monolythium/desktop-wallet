// Wallet theme + layout engine.
//
// Themes restyle the shared design tokens (`--ink-*`, `--fg-*`, `--gold`, …)
// by toggling a `data-theme` attribute on <html>; the `html[data-theme="…"]`
// overrides in `styles/themes.css` cascade through every `--w-*` alias the
// wallet reads from (those aliases reference `var(--gold)` / `var(--fg-100)`,
// so re-pointing the base tokens recolours the whole UI).
//
// The default, "monolythium", IS the wallet's native :root palette, so it is
// applied by REMOVING the attribute — the out-of-the-box look never drifts
// from the hand-tuned base tokens, and themes.css only ever layers
// alternatives on top.
//
// Layout flips a separate `data-layout` attribute ("sidebar" | "topbar") that
// drives the `html[data-layout="topbar"]` grid rules in `styles/wallet.css`.
//
// Persistence is plain localStorage (synchronous) so both attributes can be
// applied in `main.tsx` BEFORE first paint with no palette/layout flash.

export interface ThemeOption {
  id: string;
  label: string;
  /** Representative colour shown in the picker swatch. */
  swatch: string;
  desc: string;
}

// Must match the Monarch palette list (designs `WALLET_THEMES`) so the
// Monolythium wallets stay visually identical.
export const THEMES: readonly ThemeOption[] = [
  { id: "monolythium", label: "Monolythium", swatch: "#6366F1", desc: "Indigo on cool black" },
  { id: "default", label: "Amber", swatch: "#e8a942", desc: "Warm amber on slate" },
  { id: "monolabs", label: "Monolabs", swatch: "#3bd0c4", desc: "Teal on deep green" },
  { id: "monoplay", label: "Monoplay", swatch: "#d22d3d", desc: "Crimson on wine" },
  { id: "mono", label: "Mono", swatch: "#EFC25B", desc: "Pure black, thin stroke" },
  { id: "glass", label: "Glass", swatch: "#7fb2ff", desc: "Frosted liquid glass" },
  { id: "aurora", label: "Aurora", swatch: "#d36bff", desc: "Nebula gradient" },
  { id: "crimson", label: "Crimson", swatch: "#ff5a5a", desc: "Burgundy canvas" },
  { id: "neon", label: "Neon", swatch: "#00ffc8", desc: "Black canvas, cyan glow" },
  { id: "midnight", label: "Midnight", swatch: "#9d7cff", desc: "Deep violet" },
  { id: "retro", label: "Retro", swatch: "#ffb347", desc: "Sepia CRT amber" },
  { id: "light", label: "Light", swatch: "#c8871f", desc: "Bright canvas" },
] as const;

export const THEME_STORAGE_KEY = "wallet.theme";
export const DEFAULT_THEME = "monolythium";

export function isThemeId(value: string | null): boolean {
  return !!value && THEMES.some((t) => t.id === value);
}

export function readTheme(): string {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(saved)) return saved as string;
  } catch {
    // localStorage can be blocked in hardened environments; use the default.
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: string): void {
  const valid = isThemeId(id) ? id : DEFAULT_THEME;
  if (valid === DEFAULT_THEME) {
    // Native :root palette — never drift from the base tokens.
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", valid);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, valid);
  } catch {
    // The visual state still applies even if persistence is blocked.
  }
}

// ── Layout ──────────────────────────────────────────────────────────────────

export type LayoutId = "sidebar" | "topbar";

export const LAYOUTS: readonly LayoutId[] = ["sidebar", "topbar"] as const;

export const LAYOUT_STORAGE_KEY = "wallet.layout";
export const DEFAULT_LAYOUT: LayoutId = "sidebar";

export function isLayoutId(value: string | null): value is LayoutId {
  return value === "sidebar" || value === "topbar";
}

export function readLayout(): LayoutId {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (isLayoutId(saved)) return saved;
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_LAYOUT;
}

export function applyLayout(id: string): void {
  const valid = isLayoutId(id) ? id : DEFAULT_LAYOUT;
  if (valid === DEFAULT_LAYOUT) {
    // Sidebar is the native grid — no attribute keeps the default rules.
    document.documentElement.removeAttribute("data-layout");
  } else {
    document.documentElement.setAttribute("data-layout", valid);
  }
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, valid);
  } catch {
    // Visual state still applies even if persistence is blocked.
  }
}
