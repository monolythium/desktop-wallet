// Sidebar navigation — the single source of truth for the categorized rail.
//
// Items, categories, routes, and icons live here; `Sidebar` renders from this
// config and the pure `visibleNav` filter (below) drops flag-gated items and any
// category left empty. Phase 2/3 items append to `NAV_CATEGORIES` without a
// rewrite. Nothing here mounts state — it is data + a pure filter, unit-testable.

import type { ReactElement } from "react";
import type { Route } from "./types";

/** A non-route sidebar action — fires a handler instead of navigating. */
export type NavAction = "lock";

/** The feature flags that gate individual items. */
export interface NavFlags {
  developerModeEnabled: boolean;
  steleEnabled: boolean;
  experimentalEnabled: boolean;
}

export interface NavItem {
  /** Stable unique id (also the React key). */
  id: string;
  label: string;
  icon: () => ReactElement;
  /** Route items navigate; exactly one of `route`/`action` is set per item. */
  route?: Route;
  action?: NavAction;
  /** Danger styling (red) — Lock / Reset. */
  danger?: boolean;
  developerOnly?: boolean;
  steleOnly?: boolean;
  experimentalOnly?: boolean;
  badge?: string;
}

export interface NavCategory {
  id: string;
  /** Uppercase caption above the group; omitted → no header (primary / bottom). */
  header?: string;
  /** Pinned to the bottom of the rail (Lock / Reset). */
  footer?: boolean;
  items: NavItem[];
}

// ── Icons (inline SVG, currentColor) ─────────────────────────────────────────
const ICON_HOME = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 12 9-9 9 9v9a2 2 0 0 1-2 2h-4v-7H10v7H6a2 2 0 0 1-2-2v-9Z" />
  </svg>
);
const ICON_ACTIVITY = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
const ICON_WALLETS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
    <path d="M16 12h6v4h-6a2 2 0 0 1 0-4Z" />
  </svg>
);
const ICON_TOKENS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="14" rx="3" />
    <path d="M2 10h20" />
  </svg>
);
const ICON_DELEGATE = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8.2 11.2l7.6-3.8M8.2 12.8l7.6 3.8" />
  </svg>
);
const ICON_BRIDGES = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 18c2-4 5-6 9-6s7 2 9 6" />
    <path d="M5 18V8" />
    <path d="M19 18V8" />
    <path d="M9 14l3-2 3 2" />
  </svg>
);
const ICON_AGENTS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="9" width="14" height="11" rx="2" />
    <path d="M12 9V5" />
    <circle cx="12" cy="4" r="1.5" />
    <path d="M9 14h.01M15 14h.01" />
    <path d="M2 14v2M22 14v2" />
  </svg>
);
const ICON_CONTACTS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const ICON_OPERATORS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M7 7h.01M7 17h.01" />
  </svg>
);
// A pulse trace — the chain's heartbeat. Deliberately not the globe used for
// Networks: these sit two rows apart and must not read as the same thing.
const ICON_PULSE = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12h4l3-8 4 16 3-8h6" />
  </svg>
);
const ICON_NETWORKS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
  </svg>
);
const ICON_RISCV = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 9h6M9 15h6M9 12h6" />
    <path d="M2 9h2M2 15h2M20 9h2M20 15h2M9 2v2M15 2v2M9 20v2M15 20v2" />
  </svg>
);
const ICON_STUDIO = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16" />
    <path d="M7 4v6M17 4v6" />
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 14h4M8 17h8" />
  </svg>
);
const ICON_TRADE = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M14 7h7v7" />
  </svg>
);
const ICON_AI = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="10" r="1" />
    <circle cx="15" cy="10" r="1" />
    <path d="M8 15h8" />
  </svg>
);
const ICON_NEWS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 8h10M7 12h10M7 16h6" />
  </svg>
);
const ICON_STELE = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 21h8" />
    <path d="M9 21V8a3 3 0 0 1 6 0v13" />
    <path d="M9 5h6" />
    <path d="M10 11h4M10 14h4M10 17h4" />
  </svg>
);
const ICON_INBOX = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z" />
  </svg>
);
const ICON_PROVIDER = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21V8l9-5 9 5v13" />
    <path d="M9 21v-7h6v7" />
    <path d="M3 21h18" />
  </svg>
);
const ICON_SETTINGS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);
const ICON_BELL = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
const ICON_LOCK = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const ICON_KEY = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="3.5" />
    <path d="M10 13 20 3M17 6l2 2M14.5 8.5l2 2" />
  </svg>
);
const ICON_PALETTE = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 9 9 0 0 0-9-8Z" />
    <circle cx="7.5" cy="10.5" r="1" />
    <circle cx="12" cy="7.5" r="1" />
    <circle cx="16.5" cy="10.5" r="1" />
  </svg>
);
const ICON_TRASH = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const ICON_INFO = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);
const ICON_LINK = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
const ICON_BULB = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" />
    <path d="M10 21h4" />
    <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
  </svg>
);
const ICON_HELP = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3.5" />
    <path d="M12 17h.01" />
  </svg>
);

// ── The categorized rail ─────────────────────────────────────────────────────
// The collapsible categorized rail wiring each destination. The primary group
// keeps the existing pages (dropping ones with no other entry point would orphan
// them). The Info group carries the About/Resources/Why content pages; Phase 3
// appends Features/Operators/Networks (Manage) here.
export const NAV_CATEGORIES: NavCategory[] = [
  // Home sits alone so Notifications — the other screen a user checks on
  // arrival — can follow it directly while keeping its own category. Both
  // groups are headerless, and groups are spaced exactly like the items inside
  // them, so the split costs nothing visually: the rail reads Home, then
  // Notifications, then the rest.
  {
    id: "home",
    items: [{ id: "home", label: "Home", icon: ICON_HOME, route: "home" }],
  },
  {
    id: "notifications",
    // Notifications is a default-on wallet feature: the terminal-transition
    // records + toasts + Activity lifecycle are all live for every user.
    items: [
      { id: "notifications", label: "Notifications", icon: ICON_BELL, route: "notifications" },
    ],
  },
  {
    id: "primary",
    items: [
      { id: "activity", label: "Activity", icon: ICON_ACTIVITY, route: "activity" },
      { id: "wallets", label: "Wallets", icon: ICON_WALLETS, route: "wallets" },
      { id: "tokens", label: "Tokens", icon: ICON_TOKENS, route: "tokens" },
      { id: "delegate", label: "Delegate", icon: ICON_DELEGATE, route: "delegate" },
      // The bridge precompile is RETIRED and cannot be re-activated — do not
      // read its `gateable` flag as a reservation; that flag is tested before
      // the retired label, so it cannot report otherwise. What survives is the
      // third-party route disclosure catalogue this page reads, which no
      // provider has published into yet, so the registry is empty for everyone.
      // Kept discoverable with the dev badge and an explanatory stub rather
      // than hidden. See the gate note in pages/Bridges.tsx for the evidence.
      // UNGATE WHEN: the route read returns a non-empty catalogue.
      { id: "bridges", label: "Bridges", icon: ICON_BRIDGES, route: "bridges", developerOnly: true, badge: "dev" },
      { id: "trade", label: "Trade", icon: ICON_TRADE, route: "trade" },
      { id: "agents", label: "Agents", icon: ICON_AGENTS, route: "agents", experimentalOnly: true, badge: "preview" },
      { id: "ai-trade", label: "AI Trading", icon: ICON_AI, route: "ai-trade", experimentalOnly: true, badge: "preview" },
      { id: "studio", label: "Studio", icon: ICON_STUDIO, route: "studio", developerOnly: true, badge: "dev" },
      { id: "stele", label: "Stele", icon: ICON_STELE, route: "stele", steleOnly: true, badge: "early" },
      { id: "inbox", label: "Inbox", icon: ICON_INBOX, route: "inbox", steleOnly: true },
      { id: "provider", label: "Provider", icon: ICON_PROVIDER, route: "provider", steleOnly: true },
      { id: "news", label: "News", icon: ICON_NEWS, route: "news" },
    ],
  },
  {
    id: "manage",
    header: "Manage",
    items: [
      { id: "contacts", label: "Contacts", icon: ICON_CONTACTS, route: "contacts" },
      // Placed immediately before Operators because the two answer neighbouring
      // questions — "is the chain alright" and "which operator am I reading
      // from" — and a user with the first question looks where the second is
      // answered. Named "Network status" rather than "Network" so it cannot be
      // confused with "Networks" two rows below, which switches chains.
      { id: "network-status", label: "Network status", icon: ICON_PULSE, route: "network-status" },
      { id: "operators", label: "Operators", icon: ICON_OPERATORS, route: "operators" },
      { id: "networks", label: "Networks", icon: ICON_NETWORKS, route: "networks" },
      { id: "riscv", label: "RISC-V", icon: ICON_RISCV, route: "riscv", developerOnly: true, badge: "dev" },
    ],
  },
  {
    id: "security",
    header: "Security",
    // "Recovery phrase" is the honest label for the BIP-39 reveal — the desktop
    // has no SLH-DSA emergency-recovery key, so it is not called that.
    items: [
      { id: "recovery", label: "Recovery phrase", icon: ICON_KEY, route: "recovery" },
    ],
  },
  {
    id: "settings",
    header: "Settings",
    items: [
      { id: "display", label: "Display & Preferences", icon: ICON_PALETTE, route: "display" },
      { id: "settings", label: "Settings", icon: ICON_SETTINGS, route: "settings" },
    ],
  },
  {
    id: "info",
    header: "Info",
    items: [
      { id: "help", label: "Help", icon: ICON_HELP, route: "help" },
      { id: "about", label: "About", icon: ICON_INFO, route: "about" },
      { id: "resources", label: "Resources", icon: ICON_LINK, route: "resources" },
      { id: "why", label: "Why Monolythium", icon: ICON_BULB, route: "why-monolythium" },
    ],
  },
  {
    id: "actions",
    footer: true,
    items: [
      { id: "lock", label: "Lock wallet", icon: ICON_LOCK, action: "lock", danger: true },
      { id: "reset", label: "Reset wallet", icon: ICON_TRASH, route: "reset", danger: true },
    ],
  },
];

/** Filter each category's items by the active flags, then drop any category left
 *  empty (so a not-yet-populated category renders no header). Pure.
 *
 *  `developerOnly` items are kept DISCOVERABLE for everyone (they carry a "dev"
 *  badge and their destination renders a stub when developer mode is off) — a
 *  vanished menu item teaches nothing, whereas the stub carries the explanation
 *  and the escape route. Only the stele/experimental product surfaces, which
 *  have no stub, are dropped when their flag is off. */
export function visibleNav(categories: NavCategory[], flags: NavFlags): NavCategory[] {
  return categories
    .map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (n) =>
          (!n.steleOnly || flags.steleEnabled) &&
          (!n.experimentalOnly || flags.experimentalEnabled),
      ),
    }))
    .filter((cat) => cat.items.length > 0);
}
