// Sidebar — the wallet's collapsible, categorized navigation rail. The items
// live in `nav-config`; this renders them (category captions shown only when a
// group has visible items) + owns the collapse toggle. Node-ops screens live in
// Monarch Desktop.

import { useState } from "react";
import { useActiveWallet } from "../sdk/active-wallet";
import { useAutoLock } from "../sdk/auto-lock";
import { applySidebarCollapsed, readSidebarCollapsed } from "../sdk/theme";
import {
  NAV_CATEGORIES,
  visibleNav,
  type NavCategory,
  type NavItem,
} from "./nav-config";
import type { Route } from "./types";

interface Props {
  route: Route;
  setRoute: (r: Route) => void;
  developerModeEnabled: boolean;
  steleEnabled: boolean;
  experimentalEnabled: boolean;
}

export function Sidebar({ route, setRoute, developerModeEnabled, steleEnabled, experimentalEnabled }: Props) {
  const wallet = useActiveWallet();
  const { lock } = useAutoLock();
  // Rail collapse — a display preference persisted via the theme/display store
  // and applied to <html> so the grid column reflows. Default OPEN.
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    applySidebarCollapsed(next);
  };

  const categories = visibleNav(NAV_CATEGORIES, {
    developerModeEnabled,
    steleEnabled,
    experimentalEnabled,
  });
  const mainGroups = categories.filter((c) => !c.footer);
  const footerGroups = categories.filter((c) => c.footer);

  const runItem = (n: NavItem) => {
    if (n.action === "lock") {
      lock();
      return;
    }
    if (n.route) setRoute(n.route);
  };

  return (
    <aside className="w-side">
      <div className="w-side__top">
        <div className="w-brand">
          <div className="w-brand__mark" />
          <div className="w-brand__text">
            <b>Monolythium</b>
            <small>Wallet</small>
          </div>
        </div>
        <button
          type="button"
          className="w-side__toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      </div>

      <div className="w-nav w-nav--main">
        {mainGroups.map((cat) => (
          <NavGroup key={cat.id} cat={cat} route={route} onItem={runItem} />
        ))}
      </div>

      <div className="w-nav w-nav--footer">
        {footerGroups.map((cat) => (
          <NavGroup key={cat.id} cat={cat} route={route} onItem={runItem} />
        ))}
      </div>

      <div className="w-side__footer">
        <b>{wallet.status === "ready" || wallet.status === "locked" ? wallet.name : "No active wallet"}</b>
        <div className="addr">
          {wallet.status === "ready"
            ? wallet.address
            : wallet.status === "locked"
              ? "unlock to derive address"
              : wallet.status === "error"
                ? wallet.error
                : "add a wallet"}
        </div>
      </div>
    </aside>
  );
}

function NavGroup({
  cat,
  route,
  onItem,
}: {
  cat: NavCategory;
  route: Route;
  onItem: (n: NavItem) => void;
}) {
  return (
    <div className="w-nav__group">
      {cat.header ? <div className="w-nav__cat">{cat.header}</div> : null}
      {cat.items.map((n) => {
        const Icon = n.icon;
        const active = n.route !== undefined && route === n.route;
        return (
          <button
            key={n.id}
            type="button"
            className={`w-nav__item${active ? " is-active" : ""}${n.danger ? " w-nav__item--danger" : ""}`}
            onClick={() => onItem(n)}
            title={n.label}
          >
            <span className="w-nav__item__icon"><Icon /></span>
            <span className="w-nav__item__label">{n.label}</span>
            {n.badge ? <span className="w-nav__item__badge">{n.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
