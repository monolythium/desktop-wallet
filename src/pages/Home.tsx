// Home wallet overview.
// Public denom: hero balance + token preview + activity preview.
// Private denom: hero with amount-hidden disclosure + activity preview.

import { useEffect, useState } from "react";
import { useOperations } from "../operations/context";
import { loadChainSnapshot } from "../sdk/client";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { ReceiveModal } from "../components/ReceiveModal";
import { SendComposeModal } from "../components/SendComposeModal";
import type { Denom } from "../data/types";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import {
  loadLiveAddressActivity,
  loadLiveTokenStatus,
  type LiveAddressActivityRow,
  type LiveTokenStatus,
  type RpcOutcome,
} from "../sdk/live";

interface Props {
  denom: Denom;
  goto: (r: Route) => void;
}

export function Home({ denom, goto }: Props) {
  const ops = useOperations();
  const isPub = denom === "public";
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [liveTokens, setLiveTokens] = useState<LiveTokenStatus | null>(null);
  const [liveActivity, setLiveActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);

  // Live SDK call: chain id + balance for the bound address. The result is
  // surfaced through the topbar (see Topbar.tsx); the hook is mounted here so
  // a Home revisit refreshes the chain snapshot.
  const chain = useChainSnapshot(walletAddress);

  useEffect(() => {
    if (!isPub || !walletAddress) {
      setLiveTokens(null);
      setLiveActivity(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      loadLiveTokenStatus(walletAddress),
      loadLiveAddressActivity(walletAddress),
    ]).then(([tokens, activity]) => {
      if (cancelled) return;
      setLiveTokens(tokens);
      setLiveActivity(activity);
    });
    return () => {
      cancelled = true;
    };
  }, [isPub, walletAddress]);

  const openNativeSend = () => setSendOpen(true);
  const openReceive = () => setReceiveOpen(true);

  const openChainProbe = () => {
    ops.open({
      title: "Refresh chain snapshot",
      subtitle: "Read-only RPC round trip via @monolythium/core-sdk",
      auth: "none",
      diff: [
        { k: "Endpoint", v: chain.snapshot?.endpoint ?? "(unknown)" },
        { k: "Address",  v: walletAddress || "(no active address)" },
      ],
      effects: [
        { text: "Reads chain, block, and balance data." },
        { text: "No keychain access. No outbound transaction." },
      ],
      execute: async () => {
        if (!walletAddress) throw new Error("No active wallet address.");
        const snap = await loadChainSnapshot(walletAddress);
        if (snap.error) {
          throw new Error(`${snap.error.kind}: ${snap.error.message}`);
        }
        return {
          headline: `chain id ${snap.chainId} · height ${snap.blockHeight ?? "?"}`,
          detail: `balance ${snap.balanceLyth} LYTH (${snap.balanceLythoshi} lythoshi)`,
        };
      },
    });
  };

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
            {liveTokens?.nativeBalance.ok
              ? liveTokens.nativeBalance.value
              : chain.status === "ok"
                ? chain.snapshot.balanceLyth
                : "—"}
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
              <span>Wallet <b>{wallet.status === "ready" ? wallet.name : "not selected"}</b></span>
              <span>Indexed assets <b>{liveTokens?.tokenBalances.ok ? liveTokens.tokenBalances.value?.length ?? 0 : "—"}</b></span>
              <span>Endpoint <b>{liveTokens?.endpoint ?? chain.snapshot?.endpoint ?? "—"}</b></span>
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
          <button className="w-hbtn" onClick={openChainProbe} title="Run an SDK round-trip via the Operations drawer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9" />
              <polyline points="21 3 21 12 12 12" />
            </svg>
            <span>Probe chain</span>
          </button>
        </div>

        <ChainStatusLine
          hasAddress={Boolean(walletAddress)}
          status={chain.status}
          chainId={chain.snapshot?.chainId ?? 0n}
          height={chain.snapshot?.blockHeight ?? null}
          error={chain.snapshot?.error?.message ?? null}
        />
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
              {liveTokens?.tokenBalances.ok && liveTokens.tokenBalances.value && liveTokens.tokenBalances.value.length > 0 ? (
                <div className="w-live-list">
                  {liveTokens.tokenBalances.value.slice(0, 4).map((row) => (
                    <div className="w-live-row" key={row.tokenId}>
                      <div>
                        <div className="row-label mono">{shortHex(row.tokenId)}</div>
                        <div className="row-help">updated at block {row.updatedAtBlock.toString()}</div>
                      </div>
                      <div className="w-live-right mono">{row.balance}</div>
                    </div>
                  ))}
                </div>
              ) : liveTokens?.tokenBalances.ok === false ? (
                <div className="w-live-error">{liveTokens.tokenBalances.error}</div>
              ) : liveTokens?.tokenBalances.ok ? (
                <div className="row-help">No indexed token balances returned for this address.</div>
              ) : (
                <div className="row-help">{walletAddress ? "Loading token balances…" : "Select or unlock a wallet to load balances."}</div>
              )}
            </div>
          </div>

          <div className="w-card">
            <div className="w-card__head">
              <h3>Recent activity</h3>
              <div className="w-card__head__spacer" />
              <button className="btn btn--sm btn--ghost" onClick={() => goto("activity")}>View all</button>
            </div>
            <div className="w-card__body">
              {liveActivity?.ok && liveActivity.value && liveActivity.value.length > 0 ? (
                <div className="w-live-list">
                  {liveActivity.value.slice(0, 4).map((row) => (
                    <div className="w-live-row" key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}>
                      <div>
                        <div className="row-label mono">{formatLiveActivity(row)}</div>
                        <div className="row-help">block {row.blockHeight.toString()} · tx {row.txIndex}</div>
                      </div>
                      <span className="w-live-pill">{formatLiveAmount(row)}</span>
                    </div>
                  ))}
                </div>
              ) : liveActivity?.ok === false ? (
                <div className="w-live-error">{liveActivity.error}</div>
              ) : liveActivity?.ok ? (
                <div className="row-help">No indexed activity returned for this address.</div>
              ) : (
                <div className="row-help">{walletAddress ? "Loading indexed activity…" : "Select or unlock a wallet to load activity."}</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Recent activity</h3>
            <div className="w-card__head__spacer" />
            <button className="btn btn--sm btn--ghost" onClick={() => goto("activity")}>View all</button>
          </div>
          <div className="w-card__body">
            <div className="row-help">
              Private-denomination activity is not exposed as public indexed rows.
            </div>
          </div>
        </div>
      )}

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

function shortHex(value: string): string {
  return value.length > 28 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;
}

function formatLiveActivity(row: LiveAddressActivityRow): string {
  const kind = row.subKind ? `${row.kind} · ${row.subKind}` : row.kind;
  if (row.counterparty) return `${kind} · ${shortHex(row.counterparty)}`;
  if (row.cluster !== null) return `${kind} · C-${String(row.cluster + 1).padStart(3, "0")}`;
  return kind;
}

function formatLiveAmount(row: LiveAddressActivityRow): string {
  if (row.amount) return `${row.direction === "out" ? "-" : "+"}${row.amount}`;
  if (row.weightBps !== null) return `${row.weightBps} bps`;
  return "indexed";
}

function ChainStatusLine({
  hasAddress,
  status,
  chainId,
  height,
  error,
}: {
  hasAddress: boolean;
  status: "loading" | "ok" | "error";
  chainId: bigint;
  height: bigint | null;
  error: string | null;
}) {
  if (!hasAddress) {
    return (
      <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
        no active wallet address
      </div>
    );
  }
  if (status === "loading") {
    return (
      <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
        querying chain via @monolythium/core-sdk…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--warn)" }}>
        offline · {error ?? "no node reachable"}
      </div>
    );
  }
  return (
    <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--w-text-3)" }}>
      chain id <b style={{ color: "var(--w-text)" }}>{chainId.toString()}</b>
      {" · "}
      height <b style={{ color: "var(--w-text)" }}>{height === null ? "?" : height.toString()}</b>
    </div>
  );
}
