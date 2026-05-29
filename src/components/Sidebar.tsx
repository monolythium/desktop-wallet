// Sidebar — port of designs wallet-app.jsx WSidebar.
// Stage 2 ships the full consumer NAV; pages are stubs (TodoSection)
// until their RPC seams land. Node-ops screens live in Monarch Desktop.

import type { ReactElement } from "react";
import { IDENTITY } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import type { Route } from "./types";

interface NavItem {
  id: Route;
  label: string;
  icon: () => ReactElement;
  publicOnly?: boolean;
  developerOnly?: boolean;
  steleOnly?: boolean;
  experimentalOnly?: boolean;
  badge?: string;
}

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
const ICON_STAKE = () => (
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

interface Props {
  denom: Denom;
  setDenom: (d: Denom) => void;
  route: Route;
  setRoute: (r: Route) => void;
  developerModeEnabled: boolean;
  steleEnabled: boolean;
  experimentalEnabled: boolean;
}

const NAV: NavItem[] = [
  { id: "home", label: "Home", icon: ICON_HOME },
  { id: "activity", label: "Activity", icon: ICON_ACTIVITY },
  { id: "wallets", label: "Wallets", icon: ICON_WALLETS },
  { id: "tokens", label: "Tokens", icon: ICON_TOKENS, publicOnly: true },
  { id: "stake", label: "Stake", icon: ICON_STAKE, publicOnly: true },
  { id: "bridges", label: "Bridges", icon: ICON_BRIDGES, publicOnly: true },
  { id: "agents", label: "Agents", icon: ICON_AGENTS, publicOnly: true, experimentalOnly: true, badge: "preview" },
  { id: "contacts", label: "Contacts", icon: ICON_CONTACTS },
  { id: "riscv", label: "RISC-V", icon: ICON_RISCV, publicOnly: true },
  { id: "studio", label: "Studio", icon: ICON_STUDIO, publicOnly: true, developerOnly: true, badge: "dev" },
  { id: "trade", label: "Trade", icon: ICON_TRADE, publicOnly: true },
  { id: "ai-trade", label: "AI Trading", icon: ICON_AI, publicOnly: true, badge: "beta" },
  { id: "stele", label: "Stele", icon: ICON_STELE, steleOnly: true, badge: "early" },
  { id: "inbox", label: "Inbox", icon: ICON_INBOX, steleOnly: true },
  { id: "provider", label: "Provider", icon: ICON_PROVIDER, steleOnly: true },
  { id: "news", label: "News", icon: ICON_NEWS },
];

const NAV_FOOTER: NavItem[] = [
  { id: "settings", label: "Settings", icon: ICON_SETTINGS },
];

export function Sidebar({ denom, setDenom, route, setRoute, developerModeEnabled, steleEnabled, experimentalEnabled }: Props) {
  const visible = NAV.filter(
    (n) =>
      (!n.publicOnly || denom === "public") &&
      (!n.developerOnly || developerModeEnabled) &&
      (!n.steleOnly || steleEnabled) &&
      (!n.experimentalOnly || experimentalEnabled),
  );

  return (
    <aside className="w-side">
      <div className="w-brand">
        <div className="w-brand__mark" />
        <div>
          <b>Monolythium</b>
          <small>Wallet</small>
        </div>
      </div>

      <div className="w-denom-toggle">
        {(["public", "private"] as const).map((d) => (
          <button
            key={d}
            data-denom={d}
            className={denom === d ? "is-on" : ""}
            onClick={() => setDenom(d)}
          >
            {d}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {visible.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              type="button"
              className={`w-nav__item ${route === n.id ? "is-active" : ""}`}
              onClick={() => setRoute(n.id)}
            >
              <span className="w-nav__item__icon"><Icon /></span>
              <span style={{ flex: 1, textAlign: "left" }}>{n.label}</span>
              {n.badge ? <span className="w-nav__item__badge">{n.badge}</span> : null}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 12 }}>
        {NAV_FOOTER.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              type="button"
              className={`w-nav__item ${route === n.id ? "is-active" : ""}`}
              onClick={() => setRoute(n.id)}
            >
              <span className="w-nav__item__icon"><Icon /></span>
              <span style={{ flex: 1, textAlign: "left" }}>{n.label}</span>
            </button>
          );
        })}
      </div>

      <div className="w-side__footer">
        <b>{IDENTITY.handle}</b>
        <div className="addr">{IDENTITY.address}</div>
      </div>
    </aside>
  );
}
