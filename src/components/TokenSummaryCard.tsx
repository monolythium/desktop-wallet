// TokenSummaryCard — compact Home-page card showing the top-3 ERC-20
// holdings + counts of NFT collections.
//
// Reads the persisted token list (Phase 4 Commit 6); for ERC-20s it
// fires a fresh balanceOf per row. NFTs are summarised as a count
// per ERC-721 / ERC-1155 collection — the full gallery view lives on
// the Tokens page.
//
// Hides itself entirely when the list is empty so first-time users
// don't see a stale empty card.

import { useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { formatTokenAmount, getTokenBalance } from "../sdk/erc20";
import { listVisibleTokens, type TrackedToken } from "../sdk/token-list";
import type { Route } from "./types";

interface Props {
  goto: (r: Route) => void;
}

interface Erc20Snapshot {
  token: TrackedToken;
  balance: bigint;
}

type State =
  | { kind: "loading" }
  | { kind: "empty" }
  | {
      kind: "ready";
      top: Erc20Snapshot[];
      erc721Count: number;
      erc1155Count: number;
    };

const TOP_N = 3;

export function TokenSummaryCard({ goto }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tracked = listVisibleTokens();
      if (tracked.length === 0) {
        if (!cancelled) setState({ kind: "empty" });
        return;
      }
      const erc721Count = tracked.filter((t) => t.kind === "erc721").length;
      const erc1155Count = tracked.filter((t) => t.kind === "erc1155").length;
      const erc20s = tracked.filter((t) => t.kind === "erc20");
      const balances = await Promise.all(
        erc20s.map(async (token) => {
          const out = await getTokenBalance(token.contract, IDENTITY.address);
          const balance = out.ok && typeof out.value === "bigint" ? out.value : 0n;
          return { token, balance };
        }),
      );
      if (cancelled) return;
      // Sort by raw balance desc (no USD oracle yet — see Phase 4 GAP #D13).
      balances.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
      // Drop zero balances unless they're pinned.
      const top = balances
        .filter((row) => row.balance > 0n || row.token.pinned)
        .slice(0, TOP_N);
      setState({
        kind: "ready",
        top,
        erc721Count,
        erc1155Count,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "empty") return null;
  if (state.kind === "loading") {
    return (
      <div className="w-card" style={{ marginBottom: 16 }}>
        <div className="w-card__body" style={{ fontSize: 12, color: "var(--w-text-3)" }}>
          Loading other tokens…
        </div>
      </div>
    );
  }

  if (
    state.top.length === 0 &&
    state.erc721Count === 0 &&
    state.erc1155Count === 0
  ) {
    return null;
  }

  return (
    <div className="w-card" style={{ marginBottom: 16 }}>
      <div className="w-card__head">
        <h3>Other tokens</h3>
        <span className="w-card__head__spacer" />
        <button className="btn btn--sm btn--ghost" onClick={() => goto("tokens")}>
          View all
        </button>
      </div>
      <div className="w-card__body" style={{ padding: 0 }}>
        {state.top.length === 0 ? (
          <div style={{ padding: "12px 14px", color: "var(--w-text-3)", fontSize: 12.5 }}>
            No ERC-20 holdings.
          </div>
        ) : (
          state.top.map((row) => {
            const decimals = row.token.decimals ?? 18;
            const formatted = formatTokenAmount(row.balance, decimals);
            return (
              <div
                key={row.token.contract}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--w-border)",
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: "rgba(var(--gold-glow), 0.18)",
                    color: "var(--gold-hi)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {(row.token.symbol || "?").slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {row.token.symbol || "?"}
                  </div>
                  {row.token.name ? (
                    <div className="cap" style={{ marginTop: 1 }}>
                      {row.token.name}
                    </div>
                  ) : null}
                </div>
                <div className="mono" style={{ fontSize: 12, textAlign: "right" }}>
                  {formatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
              </div>
            );
          })
        )}
        {state.erc721Count > 0 || state.erc1155Count > 0 ? (
          <div
            style={{
              padding: "8px 14px",
              fontSize: 12,
              color: "var(--w-text-2)",
              display: "flex",
              gap: 12,
            }}
          >
            {state.erc721Count > 0 ? (
              <span>
                {state.erc721Count} ERC-721 {state.erc721Count === 1 ? "collection" : "collections"}
              </span>
            ) : null}
            {state.erc1155Count > 0 ? (
              <span>
                {state.erc1155Count} ERC-1155 {state.erc1155Count === 1 ? "collection" : "collections"}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
