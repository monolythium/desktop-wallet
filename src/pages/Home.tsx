// Home wallet overview.
//
// Consumer portfolio facts (Available / Delegated), a delegation summary card,
// token + recent-activity previews, and Send / Receive / Delegate / Buy hero CTAs.
//
// HONESTY:
//  - "Available" is the live native balance (loadLiveTokenStatus → eth_getBalance).
//  - "Delegated" is total delegated *weight* (basis points) — the SDK exposes
//    no per-delegation principal LYTH, so we never print a fabricated LYTH figure.
//  - "Earned" comes from lyth_pendingRewards (real lythoshi), rendered as LYTH.
//  - Endpoint / chain-height / probe telemetry is dropped from the hero (the
//    topbar already shows live sync + the peer switcher).

import { useEffect, useState } from "react";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { useChainHealthView } from "../sdk/ChainHealthProvider";
import { chainKindNotLive } from "../sdk/chain-health";
import { ReceiveModal } from "../components/ReceiveModal";
import { SendComposeModal } from "../components/SendComposeModal";
import { TokenRow } from "../components/TokenRow";
import { TxRow } from "../components/TxRow";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import { activityRowToTx } from "../sdk/activity-rows";
import { liveTokenStatusToRows } from "../sdk/token-rows";
import { loadTokenMetaMap, type TokenMeta } from "../sdk/token-metadata";
import { truncateDecimals } from "../sdk/lyth-display";
import { formatFiatFromLythoshi, getLythFiatRate } from "../sdk/fiat";
import { useDisplayCurrency } from "../sdk/display-prefs";
import { balanceDisplayState, STALE_BALANCE_LABEL } from "../sdk/balance-display";
import { BalanceFigure } from "../components/BalanceFigure";
import {
  deriveDelegationSummary,
  type DelegationSummaryFacts,
} from "../sdk/delegation-summary";
import { MONOSCAN_GET_LYTH_URL } from "../sdk/monoscan";
import {
  fetchPendingRewards,
  formatRewardLyth,
} from "../sdk/delegation";
import {
  capture,
  loadLiveAddressActivity,
  loadLiveDelegationStatus,
  loadLiveTokenStatus,
  type LiveAddressActivityRow,
  type LiveDelegationStatus,
  type LiveTokenStatus,
  type RpcOutcome,
} from "../sdk/live";
import type { PendingRewardsResponse } from "@monolythium/core-sdk";

interface Props {
  goto: (r: Route) => void;
}

export function Home({ goto }: Props) {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [liveTokens, setLiveTokens] = useState<LiveTokenStatus | null>(null);
  const [tokenMeta, setTokenMeta] = useState<Map<string, TokenMeta>>(new Map());
  const [liveActivity, setLiveActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [delegationStatus, setDelegationStatus] = useState<LiveDelegationStatus | null>(null);
  const [rewards, setRewards] = useState<RpcOutcome<PendingRewardsResponse> | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Chain snapshot is mounted as a balance fallback for the hero. The
  // topbar owns the surfaced live-sync indicator; here it only backs the
  // Available figure when the token-status native balance read is in flight.
  const chain = useChainSnapshot(walletAddress);
  // When the chain isn't live (offline / stalled / untrusted / regenesis /
  // quarantined) the balance + confirmed activity are read from an operator we
  // no longer trust or can't reach, so we pause the display rather than show a
  // stale/wrong figure (status specification §N/§O — quarantined HIDES the
  // balance). The honest "—" + empty preview replace it until the chain is live.
  const chainNotLive = chainKindNotLive(useChainHealthView().health.kind);
  // Subscribed, not read once: picking a new currency in Settings re-renders
  // this slot in-session with no reload.
  const currency = useDisplayCurrency();

  useEffect(() => {
    if (!walletAddress) {
      setLiveTokens(null);
      setLiveActivity(null);
      setDelegationStatus(null);
      setRewards(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      loadLiveTokenStatus(walletAddress),
      loadLiveAddressActivity(walletAddress),
      loadLiveDelegationStatus(walletAddress),
      capture(() => fetchPendingRewards(walletAddress)),
    ]).then(([tokens, activity, delegation, rew]) => {
      if (cancelled) return;
      setLiveTokens(tokens);
      setLiveActivity(activity);
      setDelegationStatus(delegation);
      setRewards(rew);
      // Token metadata (cached) so the "Your tokens" card shows MRC-20 amounts
      // at their real decimals; an honest "—" until it resolves.
      if (tokens.tokenBalances.ok && tokens.tokenBalances.value) {
        const ids = tokens.tokenBalances.value.map((r) => r.mrc?.assetId ?? r.tokenId);
        void loadTokenMetaMap(ids).then((m) => {
          if (!cancelled) setTokenMeta(m);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const openNativeSend = () => setSendOpen(true);
  const openReceive = () => setReceiveOpen(true);

  // Available = live native balance, formatted from the RAW lythoshi so the
  // 2-dp Home figure comes out of the exact bigint formatter (never a
  // re-truncated float-tailed decimal). Prefer the token-status read; fall back
  // to the chain snapshot while it loads; "—" when neither is available.
  const availableLythoshi =
    liveTokens?.nativeBalanceLythoshi.ok
      ? liveTokens.nativeBalanceLythoshi.value ?? null
      : chain.status === "ok"
        ? chain.snapshot.balanceLythoshi
        : null;
  // Every hero figure resolves through the one ordered ladder, so a fabricated
  // "0.00" while the balance is unknown is structurally unreachable, and a
  // remembered value can never ride through a window where the chain isn't
  // live. `seededLythoshi` stays null until the last-known store lands.
  const seededLythoshi: string | null = null;
  const totalState = balanceDisplayState(chainNotLive, availableLythoshi, seededLythoshi);

  const summary: DelegationSummaryFacts = deriveDelegationSummary(delegationStatus);
  // Earned is correctly divided to LYTH by formatRewardLyth, but at full 18-dp
  // precision; cap the on-screen value at 2 dp (truncated, trailing-zero trim)
  // to match the rest of the Home surface.
  const earnedLyth =
    rewards?.ok && rewards.value
      ? truncateDecimals(formatRewardLyth(rewards.value.totalAmountLythoshi), 2)
      : null;

  // Token + activity previews via the shared mappers + row components. Paused
  // too while the chain isn't live — a token balance read from an untrusted /
  // unreachable operator is as misleading as the hero figure.
  const tokenRows = chainNotLive || !liveTokens ? [] : liveTokenStatusToRows(liveTokens, tokenMeta);
  const activityRows =
    chainNotLive || !liveActivity?.ok || !liveActivity.value ? [] : liveActivity.value;

  return (
    <div className="w-page">
      {/* Hero */}
      <div className="w-hero">
        <div className="w-hero__label">
          Total balance
          <span style={{ color: "var(--w-text-3)" }}>·</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
            live LYTH
          </span>
        </div>

        <div className={`w-hero__amount${totalState.kind === "value" && totalState.stale ? " is-stale" : ""}`}>
          <BalanceFigure state={totalState} />
          <span className="tok">LYTH</span>
        </div>

        {/* Stale is a LABEL, never a value change — and it only ever appears
            beside a real figure, never over the skeleton or the dash. */}
        {totalState.kind === "value" && totalState.stale && (
          <div className="w-hero__stale">{STALE_BALANCE_LABEL}</div>
        )}

        {/* Fiat estimate — an ADDITIVE SIBLING; the amount above is untouched.
            Rendered only when the ladder resolved to a real value: over a dash
            or a skeleton the amount is unknown, and "{symbol}—" would claim we
            know the balance and merely cannot price it. */}
        {totalState.kind === "value" && (
          <div className="w-hero__fiat">
            {formatFiatFromLythoshi(totalState.lythoshi, currency, getLythFiatRate(currency))}
          </div>
        )}

        <div className="w-hero__meta">
          {/* No fiat here — this duplicates the hero figure, and one figure gets
              one fiat rendering. */}
          <span>
            Available <b><BalanceFigure state={totalState} skeletonWidthCh={4} skeletonRadius={6} /> LYTH</b>
          </span>
          {/* Delegated is delegated *weight* (bps) — no principal LYTH read
              exists, so we never render a fabricated LYTH figure here. */}
          <span>Delegated <b>{summary.totalWeightLabel}</b> weight</span>
        </div>

        <div className="w-hero__bar">
          <button className="w-hbtn w-hbtn--primary" onClick={openNativeSend} disabled={!walletAddress}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
            <span>Send</span>
          </button>
          <button className="w-hbtn" onClick={openReceive} disabled={!walletAddress}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            <span>Receive</span>
          </button>
          <button className="w-hbtn" onClick={() => goto("delegate")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <circle cx="5" cy="7" r="2" />
              <circle cx="19" cy="7" r="2" />
              <circle cx="5" cy="17" r="2" />
              <circle cx="19" cy="17" r="2" />
            </svg>
            <span>Delegate</span>
          </button>
          {/* No on-ramp primitive exists in the wallet — Buy opens the
              canonical monoscan sale page externally (honest external link,
              not a fake in-app card/bank/exchange on-ramp). */}
          <a
            className="w-hbtn"
            href={MONOSCAN_GET_LYTH_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Buy</span>
          </a>
        </div>
      </div>

      <div className="w-grid-2">
        <div className="w-card">
          <div className="w-card__head">
            <h3>Your tokens</h3>
            <div className="w-card__head__spacer" />
            <button className="btn btn--sm btn--ghost" onClick={() => goto("tokens")}>View all</button>
          </div>
          <div className="w-card__body">
            {liveTokens === null ? (
              <div className="row-help">{walletAddress ? "Loading token balances…" : "Select or unlock a wallet to load balances."}</div>
            ) : (
              <>
                {tokenRows.slice(0, 4).map((token) => (
                  <TokenRow key={token.primary ? "native" : token.sym} token={token} />
                ))}
                {liveTokens.tokenBalances.ok === false ? (
                  <div className="w-live-error">{liveTokens.tokenBalances.error}</div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="w-card">
          <div className="w-card__head">
            <h3>Delegation</h3>
            <div className="w-card__head__spacer" />
            <button className="btn btn--sm btn--ghost" onClick={() => goto("delegate")}>Manage</button>
          </div>
          <div className="w-card__body">
            <DelegationSummaryCard
              summary={summary}
              earnedLyth={earnedLyth}
              hasAddress={Boolean(walletAddress)}
              loading={delegationStatus === null}
              goto={goto}
            />
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Recent activity</h3>
          <div className="w-card__head__spacer" />
          <button className="btn btn--sm btn--ghost" onClick={() => goto("activity")}>View all</button>
        </div>
        <div className="w-card__body">
          {liveActivity?.ok && activityRows.length > 0 ? (
            activityRows.slice(0, 5).map((row) => (
              <TxRow
                key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                tx={activityRowToTx(row, tokenMeta)}
              />
            ))
          ) : liveActivity?.ok === false ? (
            <div className="w-live-error">{liveActivity.error}</div>
          ) : liveActivity?.ok ? (
            <div className="row-help">No indexed activity returned for this address.</div>
          ) : (
            <div className="row-help">{walletAddress ? "Loading indexed activity…" : "Select or unlock a wallet to load activity."}</div>
          )}
        </div>
      </div>

      {sendOpen && walletAddress && (
        <SendComposeModal
          fromBech32m={walletAddress}
          onClose={() => setSendOpen(false)}
        />
      )}
      {receiveOpen && walletAddress && (
        <ReceiveModal
          address={walletAddress}
          onClose={() => setReceiveOpen(false)}
        />
      )}
    </div>
  );
}

function DelegationSummaryCard({
  summary,
  earnedLyth,
  hasAddress,
  loading,
  goto,
}: {
  summary: DelegationSummaryFacts;
  earnedLyth: string | null;
  hasAddress: boolean;
  loading: boolean;
  goto: (r: Route) => void;
}) {
  if (!hasAddress) {
    return <div className="row-help">Select or unlock a wallet to load delegation.</div>;
  }
  if (loading) {
    return <div className="row-help">Loading delegation…</div>;
  }
  if (summary.delegationsFailed) {
    return <div className="w-live-error">delegations: {summary.delegationsError}</div>;
  }
  if (summary.delegationCount === 0) {
    return (
      <div>
        <div className="row-help" style={{ marginBottom: 10 }}>
          You are not delegating to any cluster yet.
        </div>
        <button className="btn btn--sm btn--primary" onClick={() => goto("delegate")}>
          Start delegating
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="w-live-grid">
        {/* Total delegated *weight* — not a LYTH principal (no such read). */}
        <div className="w-live-cell">
          <div className="cap">Delegated weight</div>
          <div>{summary.totalWeightLabel}</div>
        </div>
        <div className="w-live-cell">
          <div className="cap">Earned</div>
          <div>{earnedLyth === null ? "—" : `${earnedLyth} LYTH`}</div>
        </div>
      </div>
      <div className="row-help" style={{ marginTop: 10 }}>
        {/* No per-wallet slot-cap read exists; the honest denominator is the
            number of active clusters available to delegate to. */}
        Delegating to {summary.delegationCount} of {summary.activeClusterCount} active clusters.
      </div>
    </div>
  );
}
