// Home wallet overview.
//
// Consumer portfolio facts (Available / Delegated), a delegation summary card,
// token + recent-activity previews, and Send / Receive / Delegate / Buy hero CTAs.
//
// HONESTY:
//  - "Total" is the live native balance (loadLiveTokenStatus → eth_getBalance).
//  - "Delegated" is `balance × totalBps / 10000` in exact bigint math. The SDK
//    still exposes no per-delegation principal LYTH, and we still never print a
//    fabricated one — this is the chain's OWN definition of the wallet's current
//    weighted contribution, since delegation here is by weight of the live
//    balance and non-custodial (the LYTH stays spendable). It is a different
//    quantity from the Delegate page's whole-LYTH-floored effective weight, and
//    the two are deliberately never forced equal. It renders only when the
//    delegations read actually resolved.
//  - "Earned" comes from lyth_pendingRewards (a real hex lythoshi quantity),
//    normalised then rendered as LYTH; an undecodable quantity shows no line.
//  - Every balance figure resolves through the one ordered ladder
//    (sdk/balance-display.ts), so a fabricated "0.00" while the value is unknown
//    is structurally unreachable and a remembered value can never display while
//    the chain isn't live.
//  - Endpoint / chain-height / probe telemetry is dropped from the hero (the
//    topbar already shows live sync + the peer switcher).

import { useCallback, useEffect, useRef, useState } from "react";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { subscribeEndpoint } from "../sdk/client";
import { useChainHealthView } from "../sdk/ChainHealthProvider";
import { chainKindNotLive } from "../sdk/chain-health";
import { ReceiveModal } from "../components/ReceiveModal";
import { SendComposeModal } from "../components/SendComposeModal";
import { TokenRow } from "../components/TokenRow";
import { TxRow } from "../components/TxRow";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import { activityRowToTx } from "../sdk/activity-rows";
import { confirmedRowKey } from "../sdk/activity-cache";
import { liveTokenStatusToRows } from "../sdk/token-rows";
import { loadTokenMetaMap, type TokenMeta } from "../sdk/token-metadata";
import { truncateDecimals } from "../sdk/lyth-display";
import { formatFiatFromLythoshi, getLythFiatRate } from "../sdk/fiat";
import { useDisplayCurrency } from "../sdk/display-prefs";
import {
  balanceDisplayState,
  STALE_BALANCE_LABEL,
  type BalanceDisplayState,
} from "../sdk/balance-display";
import { BalanceFigure } from "../components/BalanceFigure";
import { HeroChips, type HeroChipId } from "../components/HeroChips";
import { FeaturesHintBar } from "../components/FeaturesHintBar";
import { useFitText } from "../components/useFitText";
import { formatLythFixed } from "../sdk/lyth-display";
import { loadLastKnownBalance, saveLastKnownBalance } from "../sdk/last-known-balance";
import {
  bpsToPercentLabel,
  delegatedLythoshiFromBps,
  deriveDelegationSummary,
  type DelegationSummaryFacts,
} from "../sdk/delegation-summary";
import { MONOSCAN_GET_LYTH_URL } from "../sdk/monoscan";
import { ExternalLink } from "../components/ExternalLink";
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

/** Home refresh cadence while the window is visible. Deliberately equal to the
 *  chain-health HEALTH_TICK_MS so the wallet keeps ONE heartbeat rather than two
 *  competing timers. */
const HOME_REFRESH_MS = 5_000;

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

  // Last-known balance, shown (labelled) until a live read confirms. Held in a
  // ref as well as state so the seed effect can tell whether a live value has
  // already landed without re-subscribing.
  const [seededLythoshi, setSeededLythoshi] = useState<string | null>(null);
  const liveBalanceRef = useRef<string | null>(null);

  useEffect(() => {
    liveBalanceRef.current = null;
    setSeededLythoshi(null);
    if (!walletAddress) return;
    let cancelled = false;
    void loadLastKnownBalance(walletAddress.toLowerCase()).then((seed) => {
      // Apply ONLY if the live read has not already landed for this scope —
      // checked after the await, so a fast live value is never overwritten by a
      // slower seed and never re-labelled stale.
      if (cancelled || seed === null || liveBalanceRef.current !== null) return;
      setSeededLythoshi(seed);
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Race token: every trigger takes the next number, and a resolution whose
  // token is no longer current is dropped WHOLESALE. Applying a late response
  // partially — an old balance beside fresh activity — would produce a
  // self-inconsistent screen that still looks authoritative.
  const loadTokenRef = useRef(0);
  // Coalescing flag: `visibilitychange`, `focus` and an interval tick can all
  // land in the same instant, so a tick whose predecessor is still running is
  // skipped rather than stacking a second pipeline.
  const inFlightRef = useRef(false);

  const runLoad = useCallback(async () => {
    if (!walletAddress) return;
    if (inFlightRef.current) return; // coalesce — at most one pipeline at a time
    inFlightRef.current = true;
    const token = ++loadTokenRef.current;
    try {
      const [tokens, activity, delegation, rew] = await Promise.all([
        loadLiveTokenStatus(walletAddress),
        loadLiveAddressActivity(walletAddress),
        loadLiveDelegationStatus(walletAddress),
        capture(() => fetchPendingRewards(walletAddress)),
      ]);
      // Stale-token check: nothing from this response reaches state.
      if (token !== loadTokenRef.current) return;

      setLiveTokens(tokens);
      setLiveActivity(activity);
      setDelegationStatus(delegation);
      setRewards(rew);

      // THE SINGLE WRITE PATH for the last-known balance: a confirmed-live read
      // only. A failed read falls through, leaving the prior record untouched —
      // never zeroed, never written from the seed.
      const confirmed = tokens.nativeBalanceLythoshi.ok
        ? tokens.nativeBalanceLythoshi.value ?? null
        : null;
      if (confirmed !== null) {
        liveBalanceRef.current = confirmed;
        void saveLastKnownBalance(walletAddress.toLowerCase(), confirmed, Date.now());
      }

      // Token metadata (cached) so the "Your tokens" card shows MRC-20 amounts
      // at their real decimals; an honest "—" until it resolves.
      if (tokens.tokenBalances.ok && tokens.tokenBalances.value) {
        const ids = tokens.tokenBalances.value.map((r) => r.mrc?.assetId ?? r.tokenId);
        const metas = await loadTokenMetaMap(ids);
        if (token === loadTokenRef.current) setTokenMeta(metas);
      }
    } finally {
      // Only a pipeline that is still current releases the flag. A superseded
      // one (a wallet switch invalidated it) must not clear the flag out from
      // under its successor.
      if (token === loadTokenRef.current) inFlightRef.current = false;
    }
  }, [walletAddress]);

  // Latest callback in a ref so the interval below is armed ONCE per mount
  // rather than re-armed on every render.
  const runLoadRef = useRef(runLoad);
  runLoadRef.current = runLoad;

  useEffect(() => {
    // A scope change invalidates anything in flight — otherwise the previous
    // wallet's response would still hold the current token and repopulate the
    // surface under the new wallet. Clearing the coalescing flag alongside it
    // lets the new scope start immediately; the superseded pipeline drops
    // wholesale when it lands.
    loadTokenRef.current += 1;
    inFlightRef.current = false;

    if (!walletAddress) {
      setLiveTokens(null);
      setLiveActivity(null);
      setDelegationStatus(null);
      setRewards(null);
      return;
    }
    void runLoad();
  }, [walletAddress, runLoad]);

  // Trigger set: an endpoint switch (every figure must come from the NEW
  // operator), the window becoming visible or focused (the balance may have
  // moved while it was hidden), and a visible-gated interval. The cadence
  // matches the chain-health heartbeat deliberately — one heartbeat, not two.
  useEffect(() => {
    if (!walletAddress) return;
    const refresh = () => void runLoadRef.current();

    const unsubscribeEndpoint = subscribeEndpoint(refresh);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);

    const interval = setInterval(() => {
      // Gated on visibility: a hidden window polls nobody.
      if (document.visibilityState === "visible") refresh();
    }, HOME_REFRESH_MS);

    return () => {
      unsubscribeEndpoint();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
      clearInterval(interval);
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
  // live.
  const totalState = balanceDisplayState(chainNotLive, availableLythoshi, seededLythoshi);

  // The delegated figure needs the bps from a read that actually RESOLVED —
  // `deriveDelegationSummary` reports totalWeightBps 0 for both an unresolved
  // and a failed read, so using it here would render a confident "0.00" for a
  // read that never landed.
  const delegationsResolved = delegationStatus?.delegations.ok === true;
  const delegationsFailed = delegationStatus?.delegations.ok === false;
  const delegatedLythoshi =
    delegationsResolved && delegationStatus?.delegations.ok
      ? delegatedLythoshiFromBps(
          availableLythoshi,
          delegationStatus.delegations.value?.totalBps ?? null,
        )
      : null;
  // A FAILED read is hidden ("—"), not loading: the answer arrived and it was
  // an error, so a skeleton would imply something is still on its way. An
  // unresolved read keeps the skeleton.
  const delegatedState: BalanceDisplayState =
    delegationsFailed
      ? { kind: "hidden" }
      : balanceDisplayState(chainNotLive, delegatedLythoshi, null);

  const [activeChip, setActiveChip] = useState<HeroChipId>("total");
  const heroState = activeChip === "total" ? totalState : delegatedState;
  // A whale-scale figure shrinks to stay on one line rather than wrapping away
  // from its unit chip.
  const heroFitRef = useFitText(
    heroState.kind === "value" ? heroState.lythoshi : String(heroState.kind),
    44,
    24,
  );

  // `totalAmountLythoshi` is a HEX quantity (lyth_pendingRewards) — normalise to
  // decimal lythoshi first. An undecodable quantity is treated as a failed read:
  // no line at all, never a fabricated 0.00 and never a dash line.
  const pendingRewardsLyth: string | null = (() => {
    if (!rewards?.ok || !rewards.value) return null;
    try {
      return formatLythFixed(BigInt(rewards.value.totalAmountLythoshi).toString(), 2);
    } catch {
      return null;
    }
  })();

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
      {/* At most ONE hint bar renders. */}
      {walletAddress && <FeaturesHintBar address={walletAddress} goto={goto} />}

      {/* Hero */}
      <div className="w-hero">
        <div className="w-hero__label">
          {activeChip === "total" ? (
            <>
              Total balance
              <span style={{ color: "var(--w-text-3)" }}>·</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
                live LYTH
              </span>
            </>
          ) : (
            <>
              Delegated
              <span style={{ color: "var(--w-text-3)" }}>·</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
                LYTH
              </span>
            </>
          )}
        </div>

        <div
          ref={heroFitRef as React.RefObject<HTMLDivElement>}
          className={`w-hero__amount${heroState.kind === "value" && heroState.stale ? " is-stale" : ""}`}
        >
          <BalanceFigure state={heroState} />
          <span className="tok">LYTH</span>
        </div>

        {/* Stale is a LABEL, never a value change — and it only ever appears
            beside a real figure, never over the skeleton or the dash. */}
        {heroState.kind === "value" && heroState.stale && (
          <div className="w-hero__stale">{STALE_BALANCE_LABEL}</div>
        )}

        {/* Fiat estimate — an ADDITIVE SIBLING; the amount above is untouched.
            Follows the ACTIVE chip, and renders only when that chip's ladder
            state is a real value: over a dash or a skeleton the amount is
            unknown, and "{symbol}—" would claim we know it and merely cannot
            price it. */}
        {heroState.kind === "value" && (
          <div className="w-hero__fiat">
            {formatFiatFromLythoshi(heroState.lythoshi, currency, getLythFiatRate(currency))}
          </div>
        )}

        {/* Delegated view — stacked lines, only while that chip is active and
            the delegations read actually resolved. On a failed read the hero
            shows its figure alone: the Delegation card below already carries the
            verbatim error, and the hero never duplicates error copy. */}
        {activeChip === "staked" && delegationsResolved && (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 10, fontSize: 11.5, color: "var(--fg-100)", alignItems: "flex-start" }}
          >
            {summary.delegationCount > 0 ? (
              <button
                type="button"
                onClick={() => goto("delegate")}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", fontSize: "inherit" }}
              >
                Delegated to {summary.delegationCount}{" "}
                {summary.delegationCount === 1 ? "cluster" : "clusters"} ·{" "}
                <span style={{ color: "rgba(var(--gold-glow), 1)" }}>
                  {bpsToPercentLabel(summary.totalWeightBps)}
                </span>
                <span style={{ fontSize: 11, marginLeft: 4 }}>→</span>
              </button>
            ) : (
              <span>Not delegated</span>
            )}
            {/* Only on a resolved rewards read — a failed one renders NO line,
                never a dash line and never a fabricated 0.00. */}
            {pendingRewardsLyth !== null && (
              <button
                type="button"
                onClick={() => goto("delegate")}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", fontSize: "inherit" }}
              >
                <span style={{ color: "rgba(var(--gold-glow), 1)" }}>{pendingRewardsLyth}</span> LYTH
                pending rewards
                <span style={{ fontSize: 11, marginLeft: 4 }}>→</span>
              </button>
            )}
          </div>
        )}

        <HeroChips
          active={activeChip}
          onSelect={setActiveChip}
          totalState={totalState}
          delegatedState={delegatedState}
        />

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
          <ExternalLink
            className="w-hbtn"
            href={MONOSCAN_GET_LYTH_URL}
            style={{ textDecoration: "none", justifyContent: "center" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Buy</span>
          </ExternalLink>
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
                key={confirmedRowKey(row)}
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
