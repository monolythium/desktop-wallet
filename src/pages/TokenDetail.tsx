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
import { RefreshButton } from "../components/RefreshButton";
import { SendComposeModal, type SendTokenContext } from "../components/SendComposeModal";
import { isSupportedTokenDecimals } from "../sdk/token-send-compose";
import { TxRow } from "../components/TxRow";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import { activityRowToTx } from "../sdk/activity-rows";
import { formatLythDisplay, isNativeLythTokenId } from "../sdk/lyth-display";
import {
  assessRoute,
  fetchBridgeRoutes,
  type BridgeRouteDisclosure,
} from "../sdk/bridge";
import {
  errorMessage,
  loadLiveAddressActivity,
  loadLiveSupplyStatus,
  loadLiveTokenStatus,
  type LiveAddressActivityRow,
  type LiveSupplyStatus,
  type LiveTokenStatus,
  type RpcOutcome,
} from "../sdk/live";
import { NATIVE_LYTH_DECIMALS, formatLyth } from "@monolythium/core-sdk";
import { MONOSCAN_GET_LYTH_URL } from "../sdk/monoscan";
import { ExternalLink } from "../components/ExternalLink";
import { isNativeRef, readSelectedToken } from "../sdk/selected-token";
import { useDeveloperMode } from "../sdk/developer-mode";
import { selectTokenDetailFacts } from "../sdk/token-detail";
import { nativeFracDigits } from "../sdk/token-rows";
import { loadTokenMetaMap, type TokenMeta } from "../sdk/token-metadata";

interface Props {
  goto: (r: Route) => void;
}

type DetailTab = "activity" | "info" | "bridges";

export function TokenDetail({ goto }: Props) {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  // The reference is set when a Tokens-page row is clicked. Read it once on
  // mount; a fresh navigation re-mounts the page (route change) so this is the
  // current selection. Defaults to native LYTH.
  const [ref] = useState(() => readSelectedToken());
  const [tab, setTab] = useState<DetailTab>("activity");

  const [live, setLive] = useState<LiveTokenStatus | null>(null);
  const [tokenMeta, setTokenMeta] = useState<Map<string, TokenMeta>>(new Map());
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  // Native LYTH supply stats (circulating + burned). Only loaded/shown for the
  // native row — MRC-20 has no such read. Null until the first load resolves.
  const [supply, setSupply] = useState<LiveSupplyStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  const refresh = async () => {
    if (!walletAddress) {
      setLive(null);
      setActivity(null);
      setSupply(null);
      return;
    }
    setBusy(true);
    try {
      // Supply stats are a chain-global read; only fetch them for the native
      // LYTH row (the only token they apply to).
      const wantSupply = isNativeRef(ref);
      const [tokens, act, sup] = await Promise.all([
        loadLiveTokenStatus(walletAddress),
        loadLiveAddressActivity(walletAddress),
        wantSupply ? loadLiveSupplyStatus() : Promise.resolve(null),
      ]);
      setLive(tokens);
      setActivity(act);
      setSupply(sup);
      // Fetch the selected MRC-20's metadata (cached) so the balance renders at
      // its real decimals. Native LYTH needs none (fixed 18-decimal path).
      if (!isNativeRef(ref) && tokens.tokenBalances.ok && tokens.tokenBalances.value) {
        const found = tokens.tokenBalances.value.find((r) => r.tokenId === ref);
        setTokenMeta(await loadTokenMetaMap([found?.mrc?.assetId ?? ref]));
      }
    } catch (cause) {
      setLive(null);
      setActivity({ ok: false, error: errorMessage(cause) });
      setSupply(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  const facts = selectTokenDetailFacts(live, ref, tokenMeta);
  const fracDigits = nativeFracDigits(facts.balanceAmount);
  // Native LYTH formats from the EXACT decimal string at the magnitude-picked
  // precision — not from the parsed float, which rounds: a balance of
  // 99.999… would render as "100.00" and overstate the funds. An MRC-20 row
  // uses its decimals-correct `balanceText` (or "—" when the scale is unknown),
  // never the raw base-units figure.
  const balanceLabel =
    facts.balanceDisplay === null
      ? "—"
      : facts.isNative
        ? formatLythDisplay(facts.balanceDisplay, fracDigits) ?? "—"
        : facts.balanceText ?? "—";

  // A token is sendable only when it is a fungible MRC-20 (standard mrc20 —
  // excludes 721/1155/4626), its decimals are known (never guess a scale), and a
  // balance row exists. The modal then encodes the amount at these real decimals.
  const sendableToken: SendTokenContext | null =
    !facts.isNative &&
    facts.standard === "mrc20" &&
    isSupportedTokenDecimals(facts.decimals) &&
    facts.tokenId !== null &&
    facts.balanceDisplay !== null
      ? {
          tokenId: facts.tokenId,
          symbol: facts.ticker,
          decimals: facts.decimals,
          balanceBaseUnits: facts.balanceDisplay,
        }
      : null;
  // Honest reason a non-native row's Send is disabled.
  const sendDisabledReason =
    facts.isNative || sendableToken !== null
      ? undefined
      : facts.standard !== null && facts.standard !== "mrc20"
        ? "Only fungible MRC-20 tokens can be sent from the wallet."
        : !isSupportedTokenDecimals(facts.decimals)
          ? "This token's decimals aren't available yet — can't send safely."
          : "This token can't be sent right now.";

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
              {balanceLabel}
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
          {/* Send reuses the single SendComposeModal: native LYTH, or a fungible
              MRC-20 with a known scale (factory-origin, standard mrc20, decimals
              loaded). MRC-721/1155/4626 and unknown-decimals rows stay honestly
              disabled with a reason rather than opening a send that can't
              encode safely. Convert stays unwired. */}
          <button
            className="btn btn--primary"
            onClick={() => setSendOpen(true)}
            disabled={!walletAddress || (!facts.isNative && sendableToken === null)}
            title={sendDisabledReason}
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
            <ExternalLink
              className="btn"
              href={MONOSCAN_GET_LYTH_URL}
              style={{ textDecoration: "none" }}
            >
              Buy
            </ExternalLink>
          ) : null}
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={() => void refresh()} />
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
          hasAddress={Boolean(walletAddress)}
          tokenMeta={tokenMeta}
        />
      ) : null}
      {tab === "info" ? <InfoTab facts={facts} endpoint={live?.endpoint ?? "—"} supply={supply} /> : null}
      {tab === "bridges" ? <BridgesTab facts={facts} /> : null}

      {sendOpen && walletAddress ? (
        <SendComposeModal
          fromBech32m={walletAddress}
          token={sendableToken ?? undefined}
          onClose={() => setSendOpen(false)}
        />
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
  hasAddress,
  tokenMeta,
}: {
  facts: ReturnType<typeof selectTokenDetailFacts>;
  activity: RpcOutcome<LiveAddressActivityRow[]> | null;
  hasAddress: boolean;
  tokenMeta: Map<string, TokenMeta>;
}) {
  // Filter rows to this token. Native LYTH rows carry the zero-address (or null)
  // token id, so the native view (detected by isNativeLythTokenId) shows the
  // wallet's full activity with an honest note rather than dropping every row; an
  // MRC-20 view filters to its exact token id.
  const { rows, filtered } = useMemo(() => {
    const all = activity?.ok && activity.value ? activity.value : [];
    if (isNativeLythTokenId(facts.tokenId)) {
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
                  tx={activityRowToTx(row, tokenMeta)}
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
  supply,
}: {
  facts: ReturnType<typeof selectTokenDetailFacts>;
  endpoint: string;
  supply: LiveSupplyStatus | null;
}) {
  const devMode = useDeveloperMode();
  // Asset policy fields are only available for native LYTH (the live read
  // queries the LYTH policy). MRC rows show "—" rather than a fabricated
  // policy. There is no decimals read for an MRC row either, so native shows
  // the protocol's 18 decimals and MRC rows show "—".
  const policy = facts.assetPolicy;
  // Circulating supply + total burned are real chain reads, native LYTH only.
  // Each falls back to the honest "—" when the read failed or for an MRC row.
  const circulating =
    facts.isNative && supply?.circulatingSupply.ok && supply.circulatingSupply.value
      ? `${formatLyth(supply.circulatingSupply.value.circulatingSupplyLythoshi, { includeUnit: false })} LYTH`
      : "—";
  const burned =
    facts.isNative && supply?.totalBurned.ok && supply.totalBurned.value
      ? `${formatLyth(supply.totalBurned.value.totalBurnedLythoshi, { includeUnit: false })} LYTH`
      : facts.isNative && supply?.circulatingSupply.ok && supply.circulatingSupply.value
        ? `${formatLyth(supply.circulatingSupply.value.totalBurnedLythoshi, { includeUnit: false })} LYTH`
        : "—";
  const rows: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: "Token id", v: facts.isNative ? "native (LYTH)" : facts.tokenId ?? "—", mono: !facts.isNative },
    {
      k: "Decimals",
      v: facts.isNative
        ? String(NATIVE_LYTH_DECIMALS)
        : facts.decimals !== null
          ? String(facts.decimals)
          : "—",
    },
    ...(facts.isNative
      ? [
          { k: "Circulating supply", v: circulating },
          { k: "Total burned", v: burned },
        ]
      : []),
    {
      k: "Last seen at block",
      v: facts.updatedAtBlock !== null ? facts.updatedAtBlock.toString() : "—",
    },
    { k: "Policy mode", v: policyString(policy, "mode") },
    { k: "Transparent transfers", v: policyBool(policy, "allowTransparent") },
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
        {devMode && facts.isNative && facts.assetPolicyError !== null ? (
          // A failed policy read must not read as an honest absence: in developer
          // mode show the raw error so a broken call is visible, not a bare "—".
          <div className="w-live-error" style={{ marginTop: 10 }}>
            asset policy read failed: {facts.assetPolicyError}
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
