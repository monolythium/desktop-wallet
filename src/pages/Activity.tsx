// Activity page — denom-segregated tx list + on-chain token transfers.
//
// Phase 4 adds the token-transfer feed: Transfer / TransferSingle /
// TransferBatch logs decoded into a uniform row shape and rendered
// alongside the LYTH activity rows. Per-kind filter chips let the
// user scope the view: All / LYTH / Tokens / NFTs.

import { useEffect, useMemo, useState } from "react";
import { TXS_PRIVATE, TXS_PUBLIC } from "../data/fixtures";
import { IDENTITY } from "../data/fixtures";
import type { Denom } from "../data/fixtures";
import { Identity } from "../components/Identity";
import { TxRow } from "../components/TxRow";
import { formatAddress } from "../components/format";
import { getProvider } from "../sdk/client";
import { formatTokenAmount } from "../sdk/erc20";
import {
  capture,
  loadLiveAddressActivity,
  type LiveAddressActivityRow,
  type RpcOutcome,
} from "../sdk/live";
import {
  loadTokenActivity,
  type TokenActivityKind,
  type TokenActivityRow,
} from "../sdk/token-activity";
import { listTokens, type TrackedToken } from "../sdk/token-list";

type FilterChip = "all" | "lyth" | "tokens" | "nfts";

interface Props {
  denom: Denom;
}

export function Activity({ denom }: Props) {
  const list = denom === "public" ? TXS_PUBLIC : TXS_PRIVATE;
  const [pending, setPending] = useState<RpcOutcome<Array<{ txHash: string; nonce: bigint; class: number; wireBytesLen: number; ready: boolean }>> | null>(null);
  const [activity, setActivity] = useState<RpcOutcome<LiveAddressActivityRow[]> | null>(null);
  const [tokenActivity, setTokenActivity] = useState<RpcOutcome<TokenActivityRow[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<FilterChip>("all");
  const [limit, setLimit] = useState(50);

  // Build a (contract → tracked metadata) lookup for symbol/decimals
  // formatting on token-activity rows.
  const tokenIndex = useMemo(() => {
    const m = new Map<string, TrackedToken>();
    for (const t of listTokens()) m.set(t.contract, t);
    return m;
  }, []);

  const refresh = async () => {
    setBusy(true);
    try {
      const [pendingRows, activityRows, tokenRows] = await Promise.all([
        capture(() => getProvider().rpcClient.lythMempoolPending(IDENTITY.address)),
        loadLiveAddressActivity(IDENTITY.address),
        loadTokenActivity(IDENTITY.address, { limit }),
      ]);
      setPending(pendingRows);
      setActivity(activityRows);
      setTokenActivity(tokenRows);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const tokenRows = tokenActivity?.ok ? tokenActivity.value ?? [] : [];

  const filteredTokenRows = tokenRows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "lyth") return false; // LYTH rows are surfaced separately
    if (filter === "tokens") return row.kind === "erc20";
    if (filter === "nfts") return row.kind === "erc721" || row.kind === "erc1155";
    return true;
  });

  const showLythRows = filter === "all" || filter === "lyth";

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Activity</h1>
        <div className="sub">
          {denom === "public"
            ? "Public transactions, LYTH + token transfers."
            : "Private envelopes — counterparties and amounts are protocol-hidden."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live pending activity</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {pending === null ? <div className="row-help">Loading lyth_mempoolPending…</div> : null}
          {pending?.ok === false ? <div className="w-live-error">{pending.error}</div> : null}
          {pending?.ok && pending.value?.length === 0 ? <div className="row-help">No pending transactions for <span className="mono" title={IDENTITY.address}>{formatAddress(IDENTITY.address)}</span>.</div> : null}
          {pending?.ok && pending.value && pending.value.length > 0 ? (
            <div className="w-live-list">
              {pending.value.map((tx) => (
                <div className="w-live-row" key={tx.txHash}>
                  <div>
                    <div className="row-label mono">{tx.txHash}</div>
                    <div className="row-help">nonce {tx.nonce.toString()} · class {tx.class} · {tx.wireBytesLen} bytes</div>
                  </div>
                  <span className={`w-live-pill ${tx.ready ? "" : "is-muted"}`}>{tx.ready ? "ready" : "pending"}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {denom === "public" ? (
        <div className="w-card">
          <div
            className="w-card__head"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <h3>Token transfers</h3>
            <div
              role="tablist"
              aria-label="Filter token activity"
              style={{ display: "flex", gap: 6, marginLeft: 8 }}
            >
              {(["all", "lyth", "tokens", "nfts"] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={filter === k}
                  className={`btn btn--sm ${filter === k ? "btn--primary" : "btn--ghost"}`}
                  onClick={() => setFilter(k)}
                >
                  {filterLabel(k)}
                </button>
              ))}
            </div>
          </div>
          <div className="w-card__body" style={{ padding: 0 }}>
            {tokenActivity === null ? (
              <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
                Loading token transfers…
              </div>
            ) : tokenActivity.ok === false ? (
              <div className="w-banner error" style={{ margin: 12 }}>
                {tokenActivity.error}
              </div>
            ) : filteredTokenRows.length === 0 ? (
              <div style={{ padding: 16, color: "var(--w-text-3)", fontSize: 12.5 }}>
                No token transfers in the scan window.
              </div>
            ) : (
              filteredTokenRows.map((row) => (
                <TokenActivityRowView
                  key={`${row.txHash}-${row.logIndex}`}
                  row={row}
                  token={tokenIndex.get(row.contract)}
                />
              ))
            )}
            {tokenRows.length >= limit ? (
              <div style={{ padding: 12, textAlign: "center" }}>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => setLimit((n) => n + 50)}
                  disabled={busy}
                >
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="w-card">
        <div className="w-card__head">
          <h3>{activity?.ok && activity.value && activity.value.length > 0 ? "Live indexed activity" : denom === "public" ? "Recent" : "Private envelopes"}</h3>
        </div>
        <div className="w-card__body">
          {activity?.ok === false ? <div className="w-live-error">address activity: {activity.error}</div> : null}
          {activity?.ok && activity.value && activity.value.length > 0 && showLythRows ? (
            <div className="w-live-list">
              {activity.value.map((row) => (
                <div className="w-live-row" key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}>
                  <div>
                    <div className="row-label mono">{formatActivityTitle(row)}</div>
                    <div className="row-help">
                      block {row.blockHeight.toString()} · tx {row.txIndex} · log {row.logIndex}
                    </div>
                  </div>
                  <span className="w-live-pill">{formatActivityAmount(row)}</span>
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            <div style={{ padding: "16px 0", color: "var(--w-text-3)", fontSize: 13 }}>No activity yet.</div>
          ) : (
            list.map((tx) => <TxRow key={tx.id} tx={tx} />)
          )}
        </div>
      </div>
    </div>
  );
}

function TokenActivityRowView({
  row,
  token,
}: {
  row: TokenActivityRow;
  token?: TrackedToken;
}) {
  const kindLabel = kindBadge(row.kind);
  let amountStr: string;
  if (row.kind === "erc20") {
    const decimals = token?.decimals ?? 18;
    const formatted = formatTokenAmount(row.amount, decimals);
    amountStr = `${row.direction === "out" ? "−" : "+"}${formatted.toLocaleString(undefined, {
      maximumFractionDigits: 6,
    })} ${token?.symbol ?? ""}`;
  } else if (row.kind === "erc721") {
    amountStr = `${row.direction === "out" ? "−" : "+"}#${row.tokenId?.toString() ?? "?"}`;
  } else {
    // ERC-1155: show "amount × #tokenId"
    amountStr = `${row.direction === "out" ? "−" : "+"}${row.amount.toString()} × #${row.tokenId?.toString() ?? "?"}`;
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid var(--w-border)",
      }}
    >
      <span
        className="cap"
        style={{
          padding: "2px 8px",
          borderRadius: 10,
          border: "1px solid var(--w-border)",
          color: "var(--w-text-2)",
        }}
      >
        {kindLabel}
      </span>
      <div>
        <div style={{ fontSize: 12.5 }}>
          {row.direction === "out" ? "To " : row.direction === "in" ? "From " : "Self · "}
          <Identity addr={row.counterparty} />
        </div>
        <div className="cap" style={{ marginTop: 2 }}>
          block {row.blockNumber.toString()} ·{" "}
          <a
            href={`https://monoscan.io/tx/${row.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono"
            style={{ color: "var(--w-text-2)" }}
          >
            {row.txHash.slice(0, 10)}…
          </a>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 12.5, textAlign: "right" }}>
        {amountStr}
      </div>
      <span className="cap" style={{ color: "var(--w-text-3)" }}>
        <Identity addr={row.contract} />
      </span>
    </div>
  );
}

function kindBadge(kind: TokenActivityKind): string {
  if (kind === "erc20") return "ERC-20";
  if (kind === "erc721") return "ERC-721";
  return "ERC-1155";
}

function filterLabel(k: FilterChip): string {
  if (k === "all") return "All";
  if (k === "lyth") return "LYTH";
  if (k === "tokens") return "Tokens";
  return "NFTs";
}

function formatActivityTitle(row: LiveAddressActivityRow): string {
  const kind = row.subKind ? `${row.kind} · ${row.subKind}` : row.kind;
  if (row.counterparty) return `${kind} · ${row.counterparty.slice(0, 12)}…`;
  if (row.cluster !== null) return `${kind} · C-${String(row.cluster + 1).padStart(3, "0")}`;
  return kind;
}

function formatActivityAmount(row: LiveAddressActivityRow): string {
  if (row.amount) return `${row.direction === "out" ? "-" : "+"}${row.amount}`;
  if (row.weightBps !== null) return `${row.weightBps} bps`;
  return "indexed";
}
