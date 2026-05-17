// Home — port of designs/src/wallet-pages.jsx WHome.
// Public denom: hero balance + token preview + activity preview.
// Private denom: hero with amount-hidden disclosure + activity preview.

import { useEffect, useState } from "react";
import { useOperations } from "../operations/context";
import { loadChainSnapshot } from "../sdk/client";
import { useChainSnapshot } from "../sdk/useChainSnapshot";
import { sendLyth } from "../sdk/send";
import { sendNativeLyth } from "../sdk/native-send";
import { makeLedgerSigner } from "../sdk/signer";
import { enumerateDevices, getAddress as ledgerGetAddress } from "../sdk/ledger";
import { BALANCES, IDENTITY, SEND_DEMO, TOKENS, TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import { TokenRow } from "../components/TokenRow";
import { TxRow } from "../components/TxRow";
import { fmt, formatAddress, formatAddressShort } from "../components/format";
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
  // Staking / APR live-data is Phase 2 (Stake + autovote). The numbers
  // come from `BALANCES[denom]` for now so the hero stays visually
  // populated; the `is-mock` className tags every mocked figure so the
  // user can tell what's real and what isn't.
  const bal = BALANCES[denom];
  const [liveTokens, setLiveTokens] = useState<LiveTokenStatus | null>(null);
  const [liveActivity, setLiveActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);

  // Live SDK call: chain id + balance for the bound address. The result is
  // surfaced through the topbar (see Topbar.tsx); the hook is mounted here so
  // a Home revisit refreshes the chain snapshot. The hero balance below is
  // derived from `chain.snapshot.balanceLyth` once the snapshot lands.
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

  // Send LYTH — existing hardware-signer path. The drawer's hardware flow
  // enumerates the device + confirms the address; once the user approves,
  // `descriptor.execute()` builds a live TransactionRequest and broadcasts
  // through `MonolythiumProvider`.
  const openSend = () => {
    ops.open({
      title: `Send ${SEND_DEMO.amountLyth} LYTH`,
      subtitle: `From ${IDENTITY.handle} via Ledger`,
      auth: "hardware",
      ledger: {
        // Default Ethereum HD path; the drawer surfaces a hard error if
        // the device-derived address doesn't match `expectedAddress`.
        // We don't pin `expectedAddress` here yet because the demo
        // identity address is a fixture — once Stage 5 binds an address
        // from the unlocked vault, we'll wire that in.
      },
      diff: [
        { k: "From",      v: formatAddress(IDENTITY.address) },
        { k: "To",        v: formatAddress(SEND_DEMO.to) },
        { k: "Token",     v: "LYTH" },
        { k: "Amount",    v: `${SEND_DEMO.amountLyth} LYTH` },
        { k: "Network",   v: chain.snapshot ? `chain ${chain.snapshot.chainId}` : "(querying)" },
        { k: "Endpoint",  v: chain.snapshot?.endpoint ?? "(unknown)" },
      ],
      effects: [
        { text: `Releases ${SEND_DEMO.amountLyth} LYTH from the public denomination.` },
        { text: "Reads sender nonce + EIP-1559 fee data via @monolythium/core-sdk." },
        { text: "Signs on Ledger device, broadcasts via MonolythiumProvider." },
      ],
      execute: async () => {
        // Enumerate the device the drawer already negotiated, then
        // build a real ethers Signer over our HID bridge.
        const devices = await enumerateDevices();
        const device = devices[0];
        if (!device) {
          throw new Error("Ledger detached between auth and execute — reconnect and retry");
        }
        const hdPath = "m/44'/60'/0'/0/0";
        const address = await ledgerGetAddress(device.deviceId, hdPath);
        const signer = makeLedgerSigner({
          deviceId: device.deviceId,
          hdPath,
          address: address.toLowerCase(),
        });
        const result = await sendLyth(signer, {
          from: address,
          to: SEND_DEMO.to,
          amountLyth: SEND_DEMO.amountLyth,
        });
        return {
          headline: `Broadcast ${SEND_DEMO.amountLyth} LYTH`,
          detail: result.txHash,
        };
      },
    });
  };

  const openNativeSend = () => {
    ops.open({
      title: `Send ${SEND_DEMO.amountLyth} LYTH`,
      subtitle: "Native ML-DSA encrypted Sprintnet send",
      auth: "keychain",
      diff: [
        { k: "From",      v: "Unlocked vault address" },
        { k: "To",        v: formatAddress(SEND_DEMO.to) },
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
      diff: [{ k: "Address", v: formatAddress(IDENTITY.address) }],
      effects: [{ text: "No on-chain action — copy and share with the sender." }],
      execute: () => Promise.resolve({
        headline: "Address ready to share",
        detail: formatAddress(IDENTITY.address),
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
        { k: "Address",  v: formatAddress(IDENTITY.address) },
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
          <PublicHeroAmount chain={chain} />
        ) : (
          <div className="w-hero__amount" style={{ color: "var(--w-text-2)" }}>
            — <span className="tok" style={{ fontStyle: "italic" }}>amount hidden by design</span>
          </div>
        )}

        <div className="w-hero__meta">
          {isPub ? (
            <>
              <span>Available <b>{fmt(bal.stakable, 0)} LYTH</b> <span className="w-mock-tag" title="Fixture preview — replaced in Phase 2 (Stake reads)">[mock]</span></span>
              <span>Staked <b>{fmt(bal.staked, 0)} LYTH</b> <span className="w-mock-tag" title="Fixture preview — replaced in Phase 2 (Stake reads)">[mock]</span></span>
              <span>Earning <b className="up">{bal.apr.toFixed(2)}%</b> APR <span className="w-mock-tag" title="Fixture preview — replaced in Phase 2 (Stake reads)">[mock]</span></span>
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
          <button className="w-hbtn" onClick={openNativeSend}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20" />
              <path d="m17 5-5-3-5 3" />
              <path d="m17 19-5 3-5-3" />
            </svg>
            <span>Native</span>
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
              {/* Mock badge appears only when we're falling back to the
                  fixture list — once `lyth_tokenBalances` returns rows
                  this disappears. Phase 5 replaces the fallback with a
                  proper ERC-20/721/1155 reader. */}
              {liveTokens?.tokenBalances.ok && liveTokens.tokenBalances.value && liveTokens.tokenBalances.value.length > 0
                ? null
                : <span className="w-mock-tag" title="Fixture preview — replaced in Phase 5 (NFT + token reads)">[mock]</span>}
              <div className="w-card__head__spacer" />
              <button className="btn btn--sm btn--ghost" onClick={() => goto("tokens")}>View all</button>
            </div>
            <div className="w-card__body">
              {liveTokens?.tokenBalances.ok && liveTokens.tokenBalances.value && liveTokens.tokenBalances.value.length > 0 ? (
                <div className="w-live-list">
                  {liveTokens.tokenBalances.value.slice(0, 4).map((row) => (
                    <div className="w-live-row" key={row.tokenId}>
                      <div>
                        <div className="row-label mono" title={row.tokenId}>
                          {formatAddressShort(row.tokenId)}
                        </div>
                        <div className="row-help">updated at block {row.updatedAtBlock.toString()}</div>
                      </div>
                      <div className="w-live-right mono">{row.balance}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div data-mock="true">
                  {TOKENS.slice(0, 4).map((t) => <TokenRow key={t.sym} token={t} />)}
                </div>
              )}
            </div>
          </div>

          <div className="w-card">
            <div className="w-card__head">
              <h3>Recent activity</h3>
              {/* Mock badge until the indexer returns rows for this address. */}
              {liveActivity?.ok && liveActivity.value && liveActivity.value.length > 0
                ? null
                : <span className="w-mock-tag" title="Fixture preview — replaced once the activity indexer returns rows">[mock]</span>}
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
                <div data-mock="true">
                  {TXS_PUBLIC.slice(0, 4).map((tx) => <TxRow key={tx.id} tx={tx} />)}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="w-card">
          <div className="w-card__head">
            <h3>Recent activity</h3>
            <span className="w-mock-tag" title="Fixture preview — private-envelope reads are Phase 12">[mock]</span>
            <div className="w-card__head__spacer" />
            <button className="btn btn--sm btn--ghost" onClick={() => goto("activity")}>View all</button>
          </div>
          <div className="w-card__body">
            <div data-mock="true">
              {TXS_PRIVATE.slice(0, 4).map((tx) => <TxRow key={tx.id} tx={tx} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatLiveActivity(row: LiveAddressActivityRow): string {
  const kind = row.subKind ? `${row.kind} · ${row.subKind}` : row.kind;
  // Counterparties on chain come back as 0x-shape addresses (the
  // indexer hands them through verbatim); render them as mono1
  // shortform so the activity feed matches the rest of the wallet's
  // §22.7 display contract.
  if (row.counterparty) return `${kind} · ${formatAddressShort(row.counterparty)}`;
  if (row.cluster !== null) return `${kind} · C-${String(row.cluster + 1).padStart(3, "0")}`;
  return kind;
}

function formatLiveAmount(row: LiveAddressActivityRow): string {
  if (row.amount) return `${row.direction === "out" ? "-" : "+"}${row.amount}`;
  if (row.weightBps !== null) return `${row.weightBps} bps`;
  return "indexed";
}

/**
 * Public-denomination hero amount. Renders three states off the chain
 * snapshot: loading (querying RPC), ready (real LYTH balance), error
 * (offline — show "—" and let the ChainStatusLine carry the detail).
 *
 * The number on screen is `chain.snapshot.balanceLyth`, derived from
 * `eth_getBalance` via the SDK provider. USD-equivalent is intentionally
 * not shown here — there is no price oracle wired in Phase 1, and
 * fabricating a USD number from a fixture price table would mislead the
 * user about what's real.
 */
function PublicHeroAmount({ chain }: { chain: ReturnType<typeof useChainSnapshot> }) {
  if (chain.status === "loading") {
    return (
      <div className="w-hero__amount" style={{ color: "var(--w-text-2)" }}>
        — <span className="tok" style={{ fontStyle: "italic" }}>loading…</span>
      </div>
    );
  }
  if (chain.status === "error" || !chain.snapshot) {
    return (
      <div className="w-hero__amount" style={{ color: "var(--w-text-2)" }}>
        — <span className="tok" style={{ fontStyle: "italic" }}>offline</span>
      </div>
    );
  }
  const lyth = chain.snapshot.balanceLyth;
  // LYTH amounts span many orders of magnitude (a dust balance is ~0.001;
  // a treasury holding is ~millions). Use 4 fraction digits for small
  // values so users can see micropayments, 2 for everything else.
  const fracDigits = lyth < 100 ? 4 : 2;
  return (
    <div className="w-hero__amount">
      {fmt(lyth, fracDigits)}
      <span className="tok">LYTH</span>
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
