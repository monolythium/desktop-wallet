// Home — port of designs/src/wallet-pages.jsx WHome.
// Public denom: hero balance + token preview + activity preview.
// Private denom: hero with amount-hidden disclosure + activity preview.

import { useOperations } from "../operations/context";
import { loadChainSnapshot } from "../sdk/client";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { BALANCES, IDENTITY, TOKENS, TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import { TokenRow } from "../components/TokenRow";
import { TxRow } from "../components/TxRow";
import { fmt } from "../components/format";
import type { Route } from "../components/types";

interface Props {
  denom: Denom;
  goto: (r: Route) => void;
}

export function Home({ denom, goto }: Props) {
  const ops = useOperations();
  const isPub = denom === "public";
  const bal = BALANCES[denom];
  const totalUsd = TOKENS.reduce((a, t) => a + t.amount * t.priceUsd, 0);

  // Live SDK call: chain id + balance for the bound address. The result is
  // surfaced through the topbar (see Topbar.tsx); the hook is mounted here so
  // a Home revisit refreshes the chain snapshot.
  const chain = useChainSnapshot(IDENTITY.address);

  const openSend = () => {
    ops.open({
      title: "Send LYTH",
      subtitle: `From ${IDENTITY.handle}`,
      auth: "keychain",
      diff: [
        { k: "From",   v: IDENTITY.address },
        { k: "Token",  v: "LYTH" },
        { k: "Amount", v: "12.50 LYTH" },
        { k: "Fee",    v: "0.0008 LYTH", kind: "fee" },
      ],
      effects: [
        { text: "Releases 12.50 LYTH from the public denomination." },
        { text: "Charges 0.0008 LYTH in fees from the same balance." },
      ],
      execute: () => Promise.resolve({
        headline: "Sent 12.50 LYTH",
        detail: "Stage 2 mock — Stage 3 wires this to the SDK eth_sendRawTransaction path.",
      }),
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
        { text: "Calls eth_chainId + eth_blockNumber + eth_getBalance." },
        { text: "No keychain access. No outbound transaction." },
      ],
      execute: async () => {
        const snap = await loadChainSnapshot(IDENTITY.address);
        if (snap.error) {
          throw new Error(`${snap.error.kind}: ${snap.error.message}`);
        }
        return {
          headline: `chain id ${snap.chainId} · height ${snap.blockHeight ?? "?"}`,
          detail: `balance ${snap.balanceWei} wei (${snap.balanceLyth.toFixed(4)} LYTH)`,
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
          <button className="w-hbtn w-hbtn--primary" onClick={openSend}>
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
          chainId={chain.snapshot?.chainId ?? 0}
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
              {TOKENS.slice(0, 4).map((t) => <TokenRow key={t.sym} token={t} />)}
            </div>
          </div>

          <div className="w-card">
            <div className="w-card__head">
              <h3>Recent activity</h3>
              <div className="w-card__head__spacer" />
              <button className="btn btn--sm btn--ghost" onClick={() => goto("activity")}>View all</button>
            </div>
            <div className="w-card__body">
              {TXS_PUBLIC.slice(0, 4).map((tx) => <TxRow key={tx.id} tx={tx} />)}
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

function ChainStatusLine({
  status,
  chainId,
  height,
  error,
}: {
  status: "loading" | "ok" | "error";
  chainId: number;
  height: number | null;
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
      chain id <b style={{ color: "var(--w-text)" }}>{chainId}</b>
      {" · "}
      height <b style={{ color: "var(--w-text)" }}>{height ?? "?"}</b>
    </div>
  );
}
