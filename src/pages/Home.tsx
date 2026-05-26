// Home wallet overview.
// Public denom: hero balance + token preview + activity preview.
// Private denom: hero with amount-hidden disclosure + activity preview.

import { useEffect, useState } from "react";
import { useOperations } from "../operations/context";
import { loadChainSnapshot } from "../sdk/client";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { sendNativeLyth } from "../sdk/native-send";
import { BALANCES, IDENTITY, SEND_DEMO, TOKENS, TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import { TokenRow } from "../components/TokenRow";
import { TxRow } from "../components/TxRow";
import { fmt } from "../components/format";
import type { Route } from "../components/types";
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
  const bal = BALANCES[denom];
  const totalUsd = TOKENS.reduce((a, t) => a + t.amount * t.priceUsd, 0);
  const [liveTokens, setLiveTokens] = useState<LiveTokenStatus | null>(null);
  const [liveActivity, setLiveActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);

  // Live SDK call: chain id + balance for the bound address. The result is
  // surfaced through the topbar (see Topbar.tsx); the hook is mounted here so
  // a Home revisit refreshes the chain snapshot.
  const chain = useChainSnapshot(IDENTITY.address);

  useEffect(() => {
    if (!isPub) return;
    let cancelled = false;
    void Promise.all([
      loadLiveTokenStatus(IDENTITY.address),
      loadLiveAddressActivity(IDENTITY.address),
    ]).then(([tokens, activity]) => {
      if (cancelled) return;
      setLiveTokens(tokens);
      setLiveActivity(activity);
    });
    return () => {
      cancelled = true;
    };
  }, [isPub]);

  const openNativeSend = () => {
    ops.open({
      title: `Send ${SEND_DEMO.amountLyth} LYTH`,
      subtitle: "Native ML-DSA encrypted Sprintnet send",
      auth: "keychain",
      diff: [
        { k: "From",      v: "Unlocked vault address" },
        { k: "To",        v: SEND_DEMO.to },
        { k: "Token",     v: "LYTH" },
        { k: "Amount",    v: `${SEND_DEMO.amountLyth} LYTH` },
        { k: "Network",   v: chain.snapshot ? `chain ${chain.snapshot.chainId}` : "Sprintnet" },
        { k: "Endpoint",  v: chain.snapshot?.endpoint ?? "(default RPC)" },
      ],
      effects: [
        { text: "Unlocks the local vault for this operation only." },
        { text: "Derives an ML-DSA-65 signer with @monolythium/core-sdk/crypto." },
        { text: "Wraps the native transaction in an encrypted envelope and submits lyth_submitEncrypted." },
      ],
      execute: async (ctx) => {
        if (!ctx?.vaultSeed) {
          throw new Error("vault seed unavailable after keychain authorization");
        }
        const result = await sendNativeLyth({
          seed: ctx.vaultSeed,
          to: SEND_DEMO.to,
          amountLyth: SEND_DEMO.amountLyth,
        });
        return {
          headline: `Broadcast ${SEND_DEMO.amountLyth} LYTH`,
          detail: `${result.txHash} · from ${result.from}`,
        };
      },
    });
  };

  const openReceive = () => {
    ops.open({
      title: "Receive",
      subtitle: "Share your address",
      auth: "none",
      diff: [{ k: "Address", v: IDENTITY.address }],
      effects: [{ text: "No on-chain action — copy and share with the sender." }],
      execute: () => Promise.resolve({
        headline: "Address ready to share",
        detail: IDENTITY.address,
      }),
    });
  };

  const openChainProbe = () => {
    ops.open({
      title: "Refresh chain snapshot",
      subtitle: "Read-only RPC round trip via @monolythium/core-sdk",
      auth: "none",
      diff: [
        { k: "Endpoint", v: chain.snapshot?.endpoint ?? "(unknown)" },
        { k: "Address",  v: IDENTITY.address },
      ],
      effects: [
        { text: "Reads chain, block, and balance data." },
        { text: "No keychain access. No outbound transaction." },
      ],
      execute: async () => {
        const snap = await loadChainSnapshot(IDENTITY.address);
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
            {isPub ? "LYTH + tokens" : "LYTH-p, shielded"}
          </span>
        </div>

        {isPub ? (
          <div className="w-hero__amount">
            ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="tok">USD</span>
          </div>
        ) : (
          <div className="w-hero__amount" style={{ color: "var(--w-text-2)" }}>
            — <span className="tok" style={{ fontStyle: "italic" }}>amount hidden by design</span>
          </div>
        )}

        <div className="w-hero__meta">
          {isPub ? (
            <>
              <span>Available <b>{fmt(bal.stakable, 0)} LYTH</b></span>
              <span>Staked <b>{fmt(bal.staked, 0)} LYTH</b></span>
              <span>Earning <b className="up">{bal.apr.toFixed(2)}%</b> APR</span>
            </>
          ) : (
            <span>Only you and your recipients can read the amount.</span>
          )}
        </div>

        <div className="w-hero__bar">
          <button className="w-hbtn w-hbtn--primary" onClick={openNativeSend}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
            <span>Send</span>
          </button>
          <button className="w-hbtn" onClick={openReceive}>
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
              ) : (
                TOKENS.slice(0, 4).map((t) => <TokenRow key={t.sym} token={t} />)
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
              ) : (
                TXS_PUBLIC.slice(0, 4).map((tx) => <TxRow key={tx.id} tx={tx} />)
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
            {TXS_PRIVATE.slice(0, 4).map((tx) => <TxRow key={tx.id} tx={tx} />)}
          </div>
        </div>
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
  status,
  chainId,
  height,
  error,
}: {
  status: "loading" | "ok" | "error";
  chainId: bigint;
  height: bigint | null;
  error: string | null;
}) {
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
