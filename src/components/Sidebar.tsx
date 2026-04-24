// Sidebar — port of designs wallet-app.jsx WSidebar.
// Stage 2 ships the consumer-only routes; node-ops screens (operator,
// keys, audit, alerts, ask, chat) belong to Monarch Desktop, not here.

import type { ReactElement } from "react";
import { IDENTITY } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import type { Route } from "./types";

interface NavItem {
  id: Route;
  label: string;
  icon: () => ReactElement;
  publicOnly?: boolean;
}

interface Props {
  denom: Denom;
  setDenom: (d: Denom) => void;
  route: Route;
  setRoute: (r: Route) => void;
}

const ICON_HOME = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 12 9-9 9 9v9a2 2 0 0 1-2 2h-4v-7H10v7H6a2 2 0 0 1-2-2v-9Z" />
  </svg>
);
const ICON_TOKENS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="14" rx="3" />
    <path d="M2 10h20" />
  </svg>
);
const ICON_ACTIVITY = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
const ICON_SETTINGS = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

const NAV: NavItem[] = [
  { id: "home",     label: "Home",     icon: ICON_HOME },
  { id: "tokens",   label: "Tokens",   icon: ICON_TOKENS, publicOnly: true },
  { id: "activity", label: "Activity", icon: ICON_ACTIVITY },
  { id: "settings", label: "Settings", icon: ICON_SETTINGS },
];

export function Sidebar({ denom, setDenom, route, setRoute }: Props) {
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

      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
        {NAV.filter((n) => !n.publicOnly || denom === "public").map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              type="button"
              className={`w-nav__item ${route === n.id ? "is-active" : ""}`}
              onClick={() => setRoute(n.id)}
            >
              <span className="w-nav__item__icon"><Icon /></span>
              <span>{n.label}</span>
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
