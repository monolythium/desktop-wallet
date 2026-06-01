// Token detail page — full-page view for one asset (native LYTH or an
// MRC-20 balance). Ported from designs/wallet-token-detail.jsx: a breadcrumb,
// a hero (balance + name/ticker), an action bar (Send / Receive / Convert /
// Bridge), and three tabs — Activity, Token info, Bridges.
//
// HONESTY: the chain exposes no price oracle and no token-name registry, so
// price, 24h change, market cap, 24h volume and the design's sparkline have no
// source — each renders an em-dash ("—"). We never fabricate a chart or a
// figure. Activity for the selected token is the live indexed address activity
// filtered to rows whose tokenId matches; native LYTH rows carry no tokenId so
// the native view shows the wallet's activity with an honest note. The Bridges
// tab reuses the read-only BridgeRiskPanel — the wallet exposes no live bridge
// send.

import { useEffect, useMemo, useState } from "react";
import { BridgeRiskPanel } from "../components/BridgeRiskPanel";
import { ReceiveModal } from "../components/ReceiveModal";
import { SendComposeModal } from "../components/SendComposeModal";
import { TxRow } from "../components/TxRow";
import { fmt } from "../components/format";
import type { Denom } from "../data/types";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import { activityRowToTx } from "../sdk/activity-rows";
import {
  assessRoute,
  fetchBridgeRoutes,
  type BridgeRouteDisclosure,
} from "../sdk/bridge";
import {
  errorMessage,
  loadLiveAddressActivity,
  loadLiveTokenStatus,
  type LiveAddressActivityRow,
  type LiveTokenStatus,
  type RpcOutcome,
} from "../sdk/live";
import { MONOSCAN_GET_LYTH_URL } from "../sdk/monoscan";
import { readSelectedToken } from "../sdk/selected-token";
import { selectTokenDetailFacts } from "../sdk/token-detail";

interface Props {
  denom: Denom;
  goto: (r: Route) => void;
}

type DetailTab = "activity" | "info" | "bridges";

export function TokenDetail({ denom, goto }: Props) {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  // The reference is set when a Tokens-page row is clicked. Read it once on
  // mount; a fresh navigation re-mounts the page (route change) so this is the
  // current selection. Defaults to native LYTH.
  const [ref] = useState(() => readSelectedToken());
  const [tab, setTab] = useState<DetailTab>("activity");

  const [live, setLive] = useState<LiveTokenStatus | null>(null);
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [busy, setBusy] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const refresh = async () => {
    if (!walletAddress) {
      setLive(null);
      setActivity(null);
      return;
    }
    setBusy(true);
    try {
      const [tokens, act] = await Promise.all([
        loadLiveTokenStatus(walletAddress),
        loadLiveAddressActivity(walletAddress),
      ]);
      setLive(tokens);
      setActivity(act);
    } catch (cause) {
      setLive(null);
      setActivity({ ok: false, error: errorMessage(cause) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  const facts = selectTokenDetailFacts(live, ref);
  const fracDigits = facts.balanceAmount >= 100 ? 2 : facts.balanceAmount >= 1 ? 3 : 4;

  return (
    <div className="w-page w-token-detail">
      <div className="w-breadcrumb">
        <a onClick={() => goto("tokens")}>Tokens</a>
        <span>›</span>
        <span>{facts.ticker}</span>
      </div>

      {/* Hero header — name/ticker + live balance. No price/chg: no oracle. */}
      <div className="w-tok-hero">
        <div className="w-tok-hero__left">
          <div className={`w-tok-hero__icon ${facts.isNative ? "is-native" : ""}`}>
            {facts.ticker.slice(0, 2)}
          </div>
          <div>
            <div className="w-tok-hero__name">
              {facts.name}
              {facts.isNative ? <span className="w-tok-hero__pill is-native">native</span> : null}
            </div>
            <div className="w-tok-hero__sym">{facts.ticker}</div>
          </div>
        </div>
        <div className="w-tok-hero__right">
          {/* No price oracle on-chain — price + 24h change are em-dashes and
              there is no sparkline (we never fabricate a chart). */}
          <div className="w-tok-hero__price">
            —<span className="w-tok-hero__chg">—</span>
          </div>
          <div className="w-tok-hero__nochart">No price feed</div>
        </div>
      </div>

      {/* Balance + action bar */}
      <div className="w-tok-bal">
        <div className="w-tok-bal__grid">
          <div className="w-tok-bal__cell">
            <div className="w-tok-bal__lbl">Your balance</div>
            <div className="w-tok-bal__val">
              {facts.balanceDisplay === null ? "—" : fmt(facts.balanceAmount, fracDigits)}
              <span className="tok">{facts.ticker}</span>
            </div>
            {/* No USD price feed — value can't be shown honestly. */}
            <div className="w-tok-bal__sub">≈ — USD</div>
          </div>
          <div className="w-tok-bal__cell">
            <div className="w-tok-bal__lbl">Market cap</div>
            <div className="w-tok-bal__val">—</div>
            <div className="w-tok-bal__sub">No supply / price oracle</div>
          </div>
          <div className="w-tok-bal__cell">
            <div className="w-tok-bal__lbl">24h volume</div>
            <div className="w-tok-bal__val">—</div>
            <div className="w-tok-bal__sub">No market data feed</div>
          </div>
        </div>
        <div className="w-tok-bal__actions">
          {/* Send / Receive / Convert reuse the existing wallet surfaces.
              Native LYTH is the only asset the wallet can build a transfer
              for today; MRC-20 send/convert are not wired, so those buttons
              are honestly disabled for MRC rows rather than opening a modal
              that can't complete. */}
          <button
            className="btn btn--primary"
            onClick={() => setSendOpen(true)}
            disabled={!walletAddress || !facts.isNative}
            title={facts.isNative ? undefined : "MRC-20 send is not wired in this build"}
          >
            Send
          </button>
          <button className="btn" onClick={() => setReceiveOpen(true)} disabled={!walletAddress}>
            Receive
          </button>
          {/* Convert (off-ramp) is the Stele marketplace flow; from here we
              route to Trade for on-chain CLOB swaps (the native convert path).
              No fabricated in-asset swap modal. */}
          <button className="btn" onClick={() => goto("trade")}>
            Convert
          </button>
          {/* Bridge → the read-only disclosure registry (no live send). */}
          <button className="btn" onClick={() => goto("bridges")}>
            Bridge
          </button>
          {facts.isNative ? (
            <a
              className="btn"
              href={MONOSCAN_GET_LYTH_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              Buy
            </a>
          ) : null}
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {facts.notFound ? (
        <div className="w-card">
          <div className="w-card__body">
            <div className="row-help">
              This token is not in the active wallet's indexed balances. It may
              have been spent, or the indexer has not caught up.
            </div>
          </div>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="w-tok-tabs">
        <button
          className={`w-tok-tab${tab === "activity" ? " is-active" : ""}`}
          onClick={() => setTab("activity")}
        >
          Activity
        </button>
        <button
          className={`w-tok-tab${tab === "info" ? " is-active" : ""}`}
          onClick={() => setTab("info")}
        >
          Token info
        </button>
        <button
          className={`w-tok-tab${tab === "bridges" ? " is-active" : ""}`}
          onClick={() => setTab("bridges")}
        >
          Bridges
        </button>
      </div>

      {tab === "activity" ? (
        <ActivityTab
          facts={facts}
          activity={activity}
          denom={denom}
          hasAddress={Boolean(walletAddress)}
        />
      ) : null}
      {tab === "info" ? <InfoTab facts={facts} endpoint={live?.endpoint ?? "—"} /> : null}
      {tab === "bridges" ? <BridgesTab facts={facts} /> : null}

      {sendOpen && walletAddress ? (
        <SendComposeModal fromBech32m={walletAddress} onClose={() => setSendOpen(false)} />
      ) : null}
      {receiveOpen && walletAddress ? (
        <ReceiveModal address={walletAddress} onClose={() => setReceiveOpen(false)} />
      ) : null}
    </div>
  );
}

function ActivityTab({
  facts,
  activity,
  denom,
  hasAddress,
}: {
  facts: ReturnType<typeof selectTokenDetailFacts>;
  activity: RpcOutcome<LiveAddressActivityRow[]> | null;
  denom: Denom;
  hasAddress: boolean;
}) {
  // Filter rows to this token where the indexer exposes a tokenId. Native LYTH
  // rows carry no tokenId, so for the native view we show the wallet's full
  // activity with an honest note rather than dropping every row.
  const { rows, filtered } = useMemo(() => {
    const all = activity?.ok && activity.value ? activity.value : [];
    if (facts.tokenId === null) {
      return { rows: all, filtered: false };
    }
    return { rows: all.filter((r) => r.tokenId === facts.tokenId), filtered: true };
  }, [activity, facts.tokenId]);

  return (
    <div className="w-card">
      <div className="w-card__body" style={{ paddingTop: 6 }}>
        {!hasAddress ? (
          <div className="row-help">Select or unlock a wallet to load activity.</div>
        ) : activity === null ? (
          <div className="row-help">Loading activity…</div>
        ) : activity.ok === false ? (
          <div className="w-live-error">{activity.error}</div>
        ) : (
          <>
            {!filtered ? (
              <div className="row-help" style={{ marginBottom: 8 }}>
                The indexer's native LYTH rows carry no per-token id, so this is
                the wallet's recent activity.
              </div>
            ) : null}
            {rows.length === 0 ? (
              <div className="w-empty">
                <h4>No {facts.ticker} activity yet</h4>
                <p>When you send, receive, or trade {facts.ticker}, it shows up here.</p>
              </div>
            ) : (
              rows.map((row) => (
                <TxRow
                  key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                  tx={activityRowToTx(row, denom)}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

function InfoTab({
  facts,
  endpoint,
}: {
  facts: ReturnType<typeof selectTokenDetailFacts>;
  endpoint: string;
}) {
  // Asset policy fields are only available for native LYTH (the live read
  // queries the LYTH policy). MRC rows show "—" rather than a fabricated
  // policy. There is no decimals read for an MRC row either, so native shows
  // the protocol's 8 decimals and MRC rows show "—".
  const policy = facts.assetPolicy;
  const rows: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: "Token id", v: facts.isNative ? "native (LYTH)" : facts.tokenId ?? "—", mono: !facts.isNative },
    { k: "Decimals", v: facts.isNative ? "8" : "—" },
    {
      k: "Last seen at block",
      v: facts.updatedAtBlock !== null ? facts.updatedAtBlock.toString() : "—",
    },
    { k: "Policy mode", v: policyString(policy, "mode") },
    { k: "Transparent transfers", v: policyBool(policy, "allowTransparent") },
    { k: "Shielded transfers", v: policyBool(policy, "allowShielded") },
    { k: "Confidential transfers", v: policyBool(policy, "allowConfidential") },
    { k: "Stealth transfers", v: policyBool(policy, "allowStealth") },
    { k: "Requires KYC", v: policyBool(policy, "requireKyc") },
  ];

  return (
    <div className="w-card w-tok-info">
      <div className="w-card__body">
        {rows.map((r) => (
          <div className="w-kv" key={r.k}>
            <span className="k">{r.k}</span>
            <span className={`v ${r.mono ? "mono" : ""}`}>{r.v}</span>
          </div>
        ))}
        {!facts.isNative ? (
          <div className="row-help" style={{ marginTop: 10 }}>
            No price, supply, holder, or per-asset policy oracle is exposed for
            MRC-20 rows yet — those fields read as "—".
          </div>
        ) : null}
        <div className="row-help" style={{ marginTop: 10 }}>
          Source: <span className="mono">{endpoint}</span>
        </div>
      </div>
    </div>
  );
}

function BridgesTab({ facts }: { facts: ReturnType<typeof selectTokenDetailFacts> }) {
  const [routes, setRoutes] = useState<BridgeRouteDisclosure[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setRoutes(null);
    void fetchBridgeRoutes(undefined, 25)
      .then(({ routes: fetched }) => {
        if (!cancelled) setRoutes(fetched);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Show disclosures whose asset label matches this token's ticker, else the
  // full registry (still read-only). Never fabricate a route.
  const matched = useMemo(() => {
    if (!routes) return [];
    const ticker = facts.ticker.toLowerCase();
    const byAsset = routes.filter((r) => r.asset.toLowerCase() === ticker);
    return byAsset.length > 0 ? byAsset : routes;
  }, [routes, facts.ticker]);

  return (
    <div className="w-card">
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 12 }}>
          Read-only trusted-route disclosures. The wallet exposes no live bridge
          send — these are the facts to verify before signing a bridge call
          elsewhere.
        </div>
        {error ? <div className="w-live-error">{error}</div> : null}
        {!error && routes === null ? <div className="row-help">Loading routes…</div> : null}
        {!error && routes !== null && matched.length === 0 ? (
          <div className="row-help">
            No bridge route disclosures returned. Either the indexer is still
            catching up or no routes have been seeded for this network.
          </div>
        ) : null}
        <div style={{ display: "grid", gap: 14 }}>
          {matched.map((route) => (
            <BridgeRiskPanel
              key={route.routeId}
              route={route}
              assessment={assessRoute(route)}
              showSendBlockedNotice
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function policyString(policy: Record<string, unknown> | null, key: string): string {
  if (!policy) return "—";
  const v = policy[key];
  return typeof v === "string" && v.length > 0 ? v : "—";
}

function policyBool(policy: Record<string, unknown> | null, key: string): string {
  if (!policy) return "—";
  const v = policy[key];
  if (typeof v !== "boolean") return "—";
  return v ? "yes" : "no";
}
