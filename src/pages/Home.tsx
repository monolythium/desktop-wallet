// Home wallet overview.
//
// Public denom: consumer portfolio facts (Available / Staked / APR), a staking
// summary card, token + recent-activity previews, and Send / Receive / Stake /
// Buy hero CTAs.
// Private denom: hero with amount-hidden disclosure + activity note.
//
// HONESTY:
//  - "Available" is the live native balance (loadLiveTokenStatus → eth_getBalance).
//  - "Staked" is total delegated *weight* (basis points) — the SDK exposes no
//    per-delegation principal LYTH, so we never print a fabricated LYTH stake.
//  - "APR" is the best live APY across the wallet's delegated clusters
//    (lyth_clusterApr). It reads "—" until some yield accrues — never 0.00%.
//  - "Earned" comes from lyth_pendingRewards (real lythoshi), rendered as LYTH.
//  - Endpoint / chain-height / probe telemetry is dropped from the hero (the
//    topbar already shows live sync + the peer switcher).

import { useEffect, useState } from "react";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { ReceiveModal } from "../components/ReceiveModal";
import { SendComposeModal } from "../components/SendComposeModal";
import { TokenRow } from "../components/TokenRow";
import { TxRow } from "../components/TxRow";
import type { Denom } from "../data/types";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import { activityRowToTx } from "../sdk/activity-rows";
import { liveTokenStatusToRows } from "../sdk/token-rows";
import {
  deriveStakeSummary,
  type StakeSummaryFacts,
} from "../sdk/staking-summary";
import { MONOSCAN_GET_LYTH_URL } from "../sdk/monoscan";
import {
  fetchPendingRewards,
  formatRewardLyth,
} from "../sdk/staking";
import {
  capture,
  loadLiveAddressActivity,
  loadLiveClusterApys,
  loadLiveStakeStatus,
  loadLiveTokenStatus,
  type LiveAddressActivityRow,
  type LiveStakeStatus,
  type LiveTokenStatus,
  type RpcOutcome,
} from "../sdk/live";
import type { PendingRewardsResponse } from "@monolythium/core-sdk";

interface Props {
  denom: Denom;
  goto: (r: Route) => void;
}

export function Home({ denom, goto }: Props) {
  const isPub = denom === "public";
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [liveTokens, setLiveTokens] = useState<LiveTokenStatus | null>(null);
  const [liveActivity, setLiveActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [stakeStatus, setStakeStatus] = useState<LiveStakeStatus | null>(null);
  const [rewards, setRewards] = useState<RpcOutcome<PendingRewardsResponse> | null>(null);
  // Live APY for the wallet's delegated clusters (lyth_clusterApr). Empty until
  // some yield accrues; the summary card shows "—" while empty.
  const [delegatedApys, setDelegatedApys] = useState<Map<number, number>>(new Map());
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Chain snapshot is mounted as a balance fallback for the hero. The
  // topbar owns the surfaced live-sync indicator; here it only backs the
  // Available figure when the token-status native balance read is in flight.
  const chain = useChainSnapshot(walletAddress);

  useEffect(() => {
    if (!isPub || !walletAddress) {
      setLiveTokens(null);
      setLiveActivity(null);
      setStakeStatus(null);
      setRewards(null);
      setDelegatedApys(new Map());
      return;
    }
    let cancelled = false;
    void Promise.all([
      loadLiveTokenStatus(walletAddress),
      loadLiveAddressActivity(walletAddress),
      loadLiveStakeStatus(walletAddress),
      capture(() => fetchPendingRewards(walletAddress)),
    ]).then(([tokens, activity, stake, rew]) => {
      if (cancelled) return;
      setLiveTokens(tokens);
      setLiveActivity(activity);
      setStakeStatus(stake);
      setRewards(rew);
      // Load live APY for the clusters this wallet delegates to (if any) — the
      // honest input to the summary's APR cell.
      const delegated = stake.delegations.ok
        ? stake.delegations.value?.rows.map((r) => r.cluster) ?? []
        : [];
      if (delegated.length > 0) {
        loadLiveClusterApys(delegated)
          .then((m) => {
            if (!cancelled) setDelegatedApys(m);
          })
          .catch(() => {
            if (!cancelled) setDelegatedApys(new Map());
          });
      } else {
        setDelegatedApys(new Map());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isPub, walletAddress]);

  const openNativeSend = () => setSendOpen(true);
  const openReceive = () => setReceiveOpen(true);

  // Available = live native balance. Prefer the token-status read; fall back
  // to the chain snapshot while it loads; "—" when neither is available.
  const availableLyth =
    liveTokens?.nativeBalance.ok
      ? liveTokens.nativeBalance.value ?? "—"
      : chain.status === "ok"
        ? chain.snapshot.balanceLyth
        : "—";

  const summary: StakeSummaryFacts = deriveStakeSummary(stakeStatus);
  const earnedLyth =
    rewards?.ok && rewards.value
      ? formatRewardLyth(rewards.value.totalAmountLythoshi)
      : null;

  // APR label for the hero + summary card: the best live APY across the
  // wallet's delegated clusters (lyth_clusterApr). "—" when no delegated
  // cluster has accrued yield yet — never a misleading 0.00%.
  const bestApy = delegatedApys.size > 0 ? Math.max(...delegatedApys.values()) : null;
  const aprLabel = bestApy !== null ? `${bestApy.toFixed(2)}%` : "—";

  // Token + activity previews via the shared mappers + row components.
  const tokenRows = liveTokens ? liveTokenStatusToRows(liveTokens) : [];
  const activityRows =
    liveActivity?.ok && liveActivity.value ? liveActivity.value : [];

  return (
    <div className="w-page">
      {/* Hero */}
      <div className="w-hero">
        <div className="w-hero__label">
          {isPub ? "Total balance" : "Private balance"}
          <span style={{ color: "var(--w-text-3)" }}>·</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
            {isPub ? "live LYTH" : "LYTH-p, shielded"}
          </span>
        </div>

        {isPub ? (
          <div className="w-hero__amount">
            {availableLyth}
            <span className="tok">LYTH</span>
          </div>
        ) : (
          <div className="w-hero__amount" style={{ color: "var(--w-text-2)" }}>
            — <span className="tok" style={{ fontStyle: "italic" }}>amount hidden by design</span>
          </div>
        )}

        <div className="w-hero__meta">
          {isPub ? (
            <>
              <span>Available <b>{availableLyth} LYTH</b></span>
              {/* Staked is delegated *weight* (bps) — no principal LYTH read
                  exists, so we never render a fabricated LYTH stake here. */}
              <span>Staked <b>{summary.totalWeightLabel}</b> weight</span>
              {/* Live APR — best APY across the wallet's delegated clusters
                  (lyth_clusterApr). "—" until some yield accrues. */}
              <span>APR <b>{aprLabel}</b></span>
            </>
          ) : (
            <span>Only you and your recipients can read the amount.</span>
          )}
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
          {isPub && (
            <>
              <button className="w-hbtn" onClick={() => goto("stake")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="5" cy="7" r="2" />
                  <circle cx="19" cy="7" r="2" />
                  <circle cx="5" cy="17" r="2" />
                  <circle cx="19" cy="17" r="2" />
                </svg>
                <span>Stake</span>
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
            </>
          )}
        </div>
      </div>

      {isPub ? (
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
              <h3>Staking</h3>
              <div className="w-card__head__spacer" />
              <button className="btn btn--sm btn--ghost" onClick={() => goto("stake")}>Manage</button>
            </div>
            <div className="w-card__body">
              <StakeSummaryCard
                summary={summary}
                earnedLyth={earnedLyth}
                aprLabel={aprLabel}
                hasAddress={Boolean(walletAddress)}
                loading={stakeStatus === null}
                goto={goto}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="w-card">
        <div className="w-card__head">
          <h3>Recent activity</h3>
          <div className="w-card__head__spacer" />
          <button className="btn btn--sm btn--ghost" onClick={() => goto("activity")}>View all</button>
        </div>
        <div className="w-card__body">
          {isPub ? (
            liveActivity?.ok && activityRows.length > 0 ? (
              activityRows.slice(0, 5).map((row) => (
                <TxRow
                  key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}
                  tx={activityRowToTx(row, denom)}
                />
              ))
            ) : liveActivity?.ok === false ? (
              <div className="w-live-error">{liveActivity.error}</div>
            ) : liveActivity?.ok ? (
              <div className="row-help">No indexed activity returned for this address.</div>
            ) : (
              <div className="row-help">{walletAddress ? "Loading indexed activity…" : "Select or unlock a wallet to load activity."}</div>
            )
          ) : (
            <div className="row-help">
              Private-denomination activity is not exposed as public indexed rows.
            </div>
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

function StakeSummaryCard({
  summary,
  earnedLyth,
  aprLabel,
  hasAddress,
  loading,
  goto,
}: {
  summary: StakeSummaryFacts;
  earnedLyth: string | null;
  aprLabel: string;
  hasAddress: boolean;
  loading: boolean;
  goto: (r: Route) => void;
}) {
  if (!hasAddress) {
    return <div className="row-help">Select or unlock a wallet to load staking.</div>;
  }
  if (loading) {
    return <div className="row-help">Loading staking…</div>;
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
        <button className="btn btn--sm btn--primary" onClick={() => goto("stake")}>
          Start staking
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="w-live-grid">
        {/* Total delegated *weight* — not a LYTH principal (no such read). */}
        <div className="w-live-cell">
          <div className="cap">Staked weight</div>
          <div>{summary.totalWeightLabel}</div>
        </div>
        <div className="w-live-cell">
          <div className="cap">Earned</div>
          <div>{earnedLyth === null ? "—" : `${earnedLyth} LYTH`}</div>
        </div>
        <div className="w-live-cell">
          <div className="cap">APR</div>
          <div>{aprLabel}</div>
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
