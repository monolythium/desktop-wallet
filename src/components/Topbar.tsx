// Topbar — port of designs wallet-app.jsx WTopbar. Trimmed for Stage 2:
// title, sync indicator (driven by the live SDK snapshot), profile pill.

import { IDENTITY } from "../data/fixtures";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { shortHex } from "./format";
import type { Route } from "./types";

interface Props {
  route: Route;
}

const TITLES: Record<Route, string> = {
  home: "Home",
  activity: "Activity",
  wallets: "Wallets",
  tokens: "Tokens",
  stake: "Stake",
  contacts: "Contacts",
  riscv: "RISC-V",
  studio: "Mono Studio",
  trade: "Trade",
  "ai-trade": "AI Trading",
  news: "News",
  stele: "Stele",
  inbox: "Inbox",
  provider: "Provider",
  settings: "Settings",
};

export function Topbar({ route }: Props) {
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
