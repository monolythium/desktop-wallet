// Topbar — adapted from the wallet-app design (WTopbar). Trimmed for Stage 2:
// title, sync indicator (driven by the live SDK snapshot), profile pill.
//
// The sync chip is a button that opens the peer popover (the design's
// `.w-peer-pop`): the user can probe every official RPC endpoint, see each
// one's region + latency + chain status, switch to any reachable peer, or let
// the wallet switch to the fastest. See `sdk/peers.ts` + `sdk/client.ts`.
//
// It also renders a notifications bell — a quick-access shortcut with a live
// unread badge that opens the Notifications center, the same route the sidebar's
// Notifications item navigates to. Notifications are a DEFAULT-ON wallet
// feature, so neither the bell nor the sidebar entry is flag-gated. The count is
// read from the notifications store and refreshed via the store's write
// subscription (no polling) so it updates the moment a record is added or marked
// read; the badge renders only once a resolved count exceeds zero, so it never
// flashes a "0".

import { useEffect, useRef, useState } from "react";
import { useActiveWallet } from "../sdk/active-wallet";
import { useChainHealthView } from "../sdk/ChainHealthProvider";
import { chainHealthPresentation } from "../sdk/chain-health-presentation";
import { useDeveloperMode } from "../sdk/developer-mode";
import { getUnread, subscribeNotifications } from "../sdk/notifications-store";
import {
  currentEndpoint,
  setEndpoint,
  subscribeEndpoint,
} from "../sdk/client";
import {
  latencyBucket,
  pickFastest,
  probePeer,
  type Peer,
  type ProbeResult,
} from "../sdk/peers";
import { activeFleet } from "../sdk/fleet";
import { probeActiveChainOperator } from "../sdk/chain-trust";
import { shortHex } from "./format";
import { useAddressDerived } from "../sdk/use-address-provenance";
import type { Route } from "./types";

interface Props {
  route: Route;
  setRoute: (r: Route) => void;
}

const TITLES: Record<Route, string> = {
  home: "Home",
  activity: "Activity",
  wallets: "Wallets",
  tokens: "Tokens",
  "token-detail": "Token",
  delegate: "Delegate",
  bridges: "Bridges",
  agents: "Agents",
  contacts: "Contacts",
  operators: "Operators",
  "operator-management": "Operator management",
  networks: "Networks",
  "network-status": "Network status",
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
  display: "Display & Preferences",
  recovery: "Recovery phrase",
  reset: "Reset wallet",
  resources: "Resources",
  "why-monolythium": "Why Monolythium",
  help: "Help",
  about: "About",
};

export function Topbar({ route, setRoute }: Props) {
  const wallet = useActiveWallet();
  const addressVerified = useAddressDerived(wallet.addressHex);
  const ready = wallet.status === "ready";
  const chain = useChainHealthView();
  const pres = chainHealthPresentation(chain.health);
  const devMode = useDeveloperMode();
  const dotClass = !ready ? "is-stale" : pres.dotClass;
  // The head height is a developer diagnostic, so the chip states the CONNECTION
  // (dot + state name) and shows the block number only in developer mode. What a
  // normal user needs from this control — whether the wallet is talking to a
  // trusted operator — is carried by the dot and the state word either way; no
  // signal is lost, only the number.
  const syncLabel = !ready
    ? "No active address"
    : devMode
      ? pres.label
      : pres.labelPlain;

  return (
    <header className="w-top">
      <div className="w-top__title">{TITLES[route]}</div>
      <div className="w-top__spacer" />
      <NotificationsBell active={route === "notifications"} onOpen={() => setRoute("notifications")} />
      <PeerChip dotClass={dotClass} syncLabel={syncLabel} endpoint={chain.endpoint} onOpenOperators={() => setRoute("operators")} />
      <div className="w-top__user">
          <div className="w-top__user__avatar" />
        <div>
          <div className="w-top__user__name">
            {wallet.status === "ready" || wallet.status === "locked" ? wallet.name : "Wallet"}
          </div>
          <div className="w-top__user__addr">
            {wallet.status === "ready" ? shortHex(wallet.address) : "no address"}
            {/* This address comes from the plaintext catalog, and it is the
                widest surface for a planted one — it renders on every route,
                where it doubles as the reference a user would check the Receive
                address against. If this process has not derived it, say so: an
                unverified value that corroborates itself on two surfaces is
                worse than one the user knows is unchecked. Marked rather than
                hidden, because unlike the QR this is read, not scanned. */}
            {wallet.status === "ready" && !addressVerified ? (
              <span
                data-testid="topbar-addr-unverified"
                title="Not verified this session — unlock to confirm this is your address"
                className="w-top__user__addr__unverified"
              >
                unverified
              </span>
            ) : null}
          </div>
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

// The sync chip + peer popover. The chip reflects the live snapshot state; the
// popover lists every switchable RPC endpoint with a probed latency/chain
// badge and lets the user switch peers (per-peer, or "Switch to fastest").
function PeerChip({
  dotClass,
  syncLabel,
  endpoint,
  onOpenOperators,
}: {
  dotClass: string;
  syncLabel: string;
  endpoint: string | null;
  onOpenOperators: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>(() => currentEndpoint());
  // Per-URL probe results, keyed by endpoint URL. Absent = not probed yet.
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  // URLs with an in-flight probe (drives the "probing…" state per row).
  const [probing, setProbing] = useState<Set<string>>(new Set());
  const [switchingFastest, setSwitchingFastest] = useState(false);
  // Set when a chosen peer failed the pin, so the refusal is visible instead of
  // the popover simply doing nothing.
  const [switchError, setSwitchError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const peers = activeFleet();

  // Keep the active endpoint in sync with client-side switches.
  useEffect(() => subscribeEndpoint((url) => setActive(url)), []);

  // Click-outside + Escape close the popover.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Re-probe every peer when the popover opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const urls = peers.map((p) => p.url);
    setProbing(new Set(urls));
    for (const url of urls) {
      void probePeer(url).then((result) => {
        if (cancelled) return;
        setProbes((prev) => ({ ...prev, [url]: result }));
        setProbing((prev) => {
          const next = new Set(prev);
          next.delete(url);
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
    // Intentionally keyed only on `open`: probe the static peer registry once
    // per open, not on every render (the peer list is constant per session).
  }, [open]);

  // Point the read path at `url` only once it has PROVEN the active chain's pin.
  // The row probe behind this popover reads `eth_chainId` alone, and a fork that
  // shares our chain id answers it correctly — so latency and chain id together
  // still cannot tell a fork from the real chain. Only the genesis read can, and
  // it is one call, made here, before anything moves.
  //
  // The seam makes an unverified switch SAFE regardless (setEndpoint drops the
  // trust verdict, so reads refuse until a tick verdicts the new operator). This
  // gate makes it HONEST: the user is told now, and their operator is left alone,
  // rather than being moved and silently moved back a tick later.
  const switchVerified = async (url: string, name: string): Promise<void> => {
    const verdict = await probeActiveChainOperator(url);
    if (!verdict.trusted) {
      setSwitchError(`Couldn't switch to ${name} — it didn't prove this build's chain identity. Your operator was left unchanged.`);
      return;
    }
    setSwitchError(null);
    setEndpoint(url);
    setOpen(false);
  };

  const onSwitch = (url: string) => {
    const name = peers.find((p) => p.url === url)?.label ?? stripScheme(url);
    void switchVerified(url, name);
  };

  const onSwitchFastest = async () => {
    setSwitchingFastest(true);
    try {
      const results = await Promise.all(peers.map((p) => probePeer(p.url)));
      const merged: Record<string, ProbeResult> = {};
      for (const r of results) merged[r.url] = r;
      setProbes(merged);
      const winner = pickFastest(results);
      if (winner) {
        const name = peers.find((p) => p.url === winner.url)?.label ?? stripScheme(winner.url);
        await switchVerified(winner.url, name);
      }
    } finally {
      setSwitchingFastest(false);
    }
  };

  const activePeer = peers.find((p) => p.url === active) ?? null;
  const activeProbe = probes[active];
  const activeLatency = activeProbe?.reachable && activeProbe.chainIdOk ? `${activeProbe.latencyMs} ms` : "—";

  return (
    <div className="w-top__sync-wrap" ref={wrapRef}>
      <button
        type="button"
        className="w-top__sync"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={endpoint ?? "(no endpoint)"}
      >
        <span className={`dot ${dotClass}`} />
        <span>{syncLabel}</span>
        <span className="w-top__sync__caret" aria-hidden="true">
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="m2 4 3 3 3-3" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="w-peer-pop" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="w-peer-pop__head">
            <div className="w-peer-pop__head__title">Sync peer</div>
            <div className="w-peer-pop__head__sub">
              Connected to <b>{activePeer?.label ?? "—"}</b> · latency {activeLatency}
            </div>
          </div>

          <div className="w-peer-pop__list">
            {peers.map((peer) => (
              <PeerRow
                key={peer.url}
                peer={peer}
                active={peer.url === active}
                probe={probes[peer.url]}
                probing={probing.has(peer.url)}
                onSwitch={() => onSwitch(peer.url)}
              />
            ))}
          </div>

          {switchError ? (
            <div className="w-peer-pop__error" role="status">
              {switchError}
            </div>
          ) : null}

          <div className="w-peer-pop__foot">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => {
                setOpen(false);
                onOpenOperators();
              }}
            >
              Open Operators
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => void onSwitchFastest()}
              disabled={switchingFastest}
            >
              {switchingFastest ? "Probing…" : "Switch to fastest"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// One peer row in the popover. Renders the honest probe state: probing,
// reachable+on-chain (latency + height), reachable-but-wrong-chain, or
// unreachable. Only on-chain peers are switchable.
function PeerRow({
  peer,
  active,
  probe,
  probing,
  onSwitch,
}: {
  peer: Peer;
  active: boolean;
  probe: ProbeResult | undefined;
  probing: boolean;
  onSwitch: () => void;
}) {
  const onChain = probe?.reachable === true && probe.chainIdOk === true;
  const wrongChain = probe?.reachable === true && probe.chainIdOk === false;
  const unreachable = probe?.reachable === false;
  // A peer is only switchable once it has been confirmed reachable AND on the
  // right chain. A wrong-chain, unreachable, or not-yet-probed peer is never
  // selectable — switching there would silently break the wallet.
  const selectable = onChain;

  // Dim only rows with a definitive ineligible result (not while probing).
  const ineligible = wrongChain || unreachable;

  const handleClick = () => {
    if (active || !selectable) return;
    onSwitch();
  };

  return (
    <div
      className={`w-peer-row ${active ? "is-on" : ""} ${ineligible ? "is-disabled" : ""}`}
      role={selectable && !active ? "button" : undefined}
      tabIndex={selectable && !active ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && selectable && !active) {
          e.preventDefault();
          onSwitch();
        }
      }}
    >
      <div className="w-peer-row__main">
        <div className="w-peer-row__label">
          <span>{peer.label}</span>
          {peer.tier === "gateway" ? <span className="w-peer-row__tag">gateway</span> : null}
        </div>
        <div className="w-peer-row__meta">
          <span>{peer.region ?? "—"}</span>
          <span className="sep">·</span>
          <span className="mono">{stripScheme(peer.url)}</span>
        </div>
      </div>
      <div className="w-peer-row__stats">
        {probing ? (
          <div className="w-peer-row__lat w-peer-row__lat--warn">probing…</div>
        ) : unreachable ? (
          <div className="w-peer-row__lat w-peer-row__lat--slow">unreachable</div>
        ) : wrongChain ? (
          <div className="w-peer-row__lat w-peer-row__lat--slow">wrong chain</div>
        ) : onChain ? (
          <>
            <div className={`w-peer-row__lat w-peer-row__lat--${latencyBucket(probe!.latencyMs)}`}>
              {probe!.latencyMs} ms
            </div>
            {probe!.blockHeight !== undefined ? (
              <div className="w-peer-row__height">#{probe!.blockHeight.toLocaleString("en-US")}</div>
            ) : null}
          </>
        ) : (
          <div className="w-peer-row__lat">—</div>
        )}
      </div>
      {active ? (
        <div className="w-peer-row__check" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m2 6 3 3 5-6" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}

// Drop the scheme from a URL for the compact peer-row address line.
function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
