// Topbar — port of designs wallet-app.jsx WTopbar. Trimmed for Stage 2:
// title, sync indicator (driven by the live SDK snapshot), profile pill.

import { IDENTITY } from "../data/fixtures";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { Identity } from "./Identity";
import type { Route } from "./types";

interface Props {
  route: Route;
  /** Phase 5 — quick "Lock now" action in the Topbar. Wires to the
   *  Rust `vault_lock` command via useVaults().lock(). */
  onLockNow?: () => void | Promise<void>;
}

const TITLES: Record<Route, string> = {
  home: "Home",
  activity: "Activity",
  wallets: "Wallets",
  tokens: "Tokens",
  stake: "Stake",
  operators: "Operators",
  names: "Names",
  contacts: "Contacts",
  trade: "Trade",
  "ai-trade": "AI Trading",
  news: "News",
  proposals: "Proposals",
  settings: "Settings",
};

export function Topbar({ route, onLockNow }: Props) {
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
      <div
        className="w-top__sync"
        title={chain.snapshot?.endpoint ?? "(no endpoint)"}
      >
        <span className={`dot ${dotClass}`} />
        <span>{syncLabel}</span>
      </div>
      {onLockNow ? (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => void onLockNow()}
          title="Lock the wallet — wipes the in-memory MEK"
          aria-label="Lock wallet"
          style={{ marginRight: 8 }}
        >
          🔒 Lock
        </button>
      ) : null}
      <div className="w-top__user">
        <div className="w-top__user__avatar" />
        <div>
          <div className="w-top__user__name">{IDENTITY.handle}</div>
          <Identity addr={IDENTITY.address} className="w-top__user__addr" />
        </div>
      </div>
    </header>
  );
}
