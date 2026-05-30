// Topbar — port of designs wallet-app.jsx WTopbar. Trimmed for Stage 2:
// title, sync indicator (driven by the live SDK snapshot), profile pill.
//
// When the experimental flag is on it also renders a notifications bell with
// an unread-count badge that routes to the Notifications center. The count is
// read from the notifications store and refreshed via the store's write
// subscription (no polling) so it updates the moment a record is added or
// marked read.

import { useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { getUnread, subscribeNotifications } from "../sdk/notifications-store";
import { shortHex } from "./format";
import type { Route } from "./types";

interface Props {
  route: Route;
  setRoute: (r: Route) => void;
  experimentalEnabled: boolean;
}

const TITLES: Record<Route, string> = {
  home: "Home",
  activity: "Activity",
  wallets: "Wallets",
  tokens: "Tokens",
  stake: "Stake",
  bridges: "Bridges",
  agents: "Agents",
  contacts: "Contacts",
  riscv: "RISC-V",
  studio: "Mono Studio",
  trade: "Trade",
  "ai-trade": "AI Trading",
  news: "News",
  stele: "Stele",
  inbox: "Inbox",
  provider: "Provider",
  notifications: "Notifications",
  settings: "Settings",
};

export function Topbar({ route, setRoute, experimentalEnabled }: Props) {
  const chain = useChainSnapshot(IDENTITY.address);
  const dotClass =
    chain.status === "loading" ? "is-stale"
    : chain.status === "error" ? "is-down"
    : "";
  const syncLabel =
    chain.status === "loading" ? "Connecting…"
    : chain.status === "error" ? `Offline · ${chain.snapshot?.error?.kind ?? "unknown"}`
    : `Synced · chain ${chain.snapshot?.chainId} · #${chain.snapshot?.blockHeight ?? "?"}`;

  return (
    <header className="w-top">
      <div className="w-top__title">{TITLES[route]}</div>
      <div className="w-top__spacer" />
      {experimentalEnabled ? (
        <NotificationsBell active={route === "notifications"} onOpen={() => setRoute("notifications")} />
      ) : null}
      <div
        className="w-top__sync"
        title={chain.snapshot?.endpoint ?? "(no endpoint)"}
      >
        <span className={`dot ${dotClass}`} />
        <span>{syncLabel}</span>
      </div>
      <div className="w-top__user">
        <div className="w-top__user__avatar" />
        <div>
          <div className="w-top__user__name">{IDENTITY.handle}</div>
          <div className="w-top__user__addr">{shortHex(IDENTITY.address)}</div>
        </div>
      </div>
    </header>
  );
}

function NotificationsBell({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      void getUnread().then((n) => {
        if (!cancelled) setUnread(n);
      });
    };
    sync();
    const unsubscribe = subscribeNotifications(sync);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <button
      type="button"
      className={`w-top__bell ${active ? "is-active" : ""}`}
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unread > 0 ? (
        <span className="w-top__bell__badge">{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </button>
  );
}
