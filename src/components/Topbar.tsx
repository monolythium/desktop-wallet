// Topbar — port of designs wallet-app.jsx WTopbar. Trimmed for Stage 2:
// title, sync indicator (driven by the live SDK snapshot), profile pill.

import { useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { useMultisigs } from "../sdk/useMultisig";
import {
  describePolicyPosture,
  getPolicy,
  type PolicyConfig,
} from "../sdk/policy";
import { Identity } from "./Identity";
import type { Route } from "./types";

interface Props {
  route: Route;
  /** Phase 5 — quick "Lock now" action in the Topbar. Wires to the
   *  Rust `vault_lock` command via useVaults().lock(). */
  onLockNow?: () => void | Promise<void>;
  /** Phase 7 — click handler for the unlock-mode badge; routes to
   *  Settings → Security. */
  onBadgeClick?: () => void;
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

export function Topbar({ route, onLockNow, onBadgeClick }: Props) {
  const chain = useChainSnapshot(IDENTITY.address);
  const multisigs = useMultisigs();
  const [policy, setPolicyState] = useState<PolicyConfig>(() => getPolicy());
  // The policy lives in localStorage; refresh on focus so changes
  // made in another tab / Settings panel reflect here without a
  // full app reload.
  useEffect(() => {
    const sync = () => setPolicyState(getPolicy());
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
  const active = multisigs.active;
  const posture = describePolicyPosture({
    policy,
    multisigActive: active !== null,
    multisigThreshold: active?.threshold,
    multisigSignerCount: active?.signerCount,
  });
  const toneColor =
    posture.tone === "strong"
      ? "var(--ok)"
      : posture.tone === "ok"
        ? "var(--gold-hi, var(--w-text-2))"
        : "var(--alert)";
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
      <button
        type="button"
        aria-label={`Unlock posture: ${posture.label}. Click to configure.`}
        title={`Configure security policy — ${posture.label}`}
        onClick={() => onBadgeClick?.()}
        style={{
          marginLeft: 8,
          padding: "4px 10px",
          borderRadius: 8,
          border: `1px solid ${toneColor}33`,
          background: "var(--w-surface, transparent)",
          color: toneColor,
          fontSize: 11,
          fontWeight: 600,
          cursor: onBadgeClick ? "pointer" : "default",
          textTransform: "uppercase",
          letterSpacing: 0.3,
          // Phase 8 — smooth tone transitions when the policy moves
          // between weak / ok / strong (e.g. enrolling the first
          // passkey lifts the badge from weak to ok).
          transition:
            "color 220ms ease, border-color 220ms ease, background 220ms ease",
        }}
      >
        {posture.label}
      </button>
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
