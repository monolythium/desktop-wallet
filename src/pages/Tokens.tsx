// Tokens page — full portfolio view.
//
// Sections:
//   1. ERC-20 holdings — name, balance, per-row Send / Hide / Monoscan
//   2. ERC-721 collections — gallery render via NftGallery (Commit 10)
//   3. ERC-1155 collections — gallery render via NftGallery (Commit 10)
//
// Token list is the union of the user's persistent tracked-token
// list (Commit 6) and the latest discovery scan (Commit 5). Discovery
// auto-populates on first mount; the user can manually "Refresh" to
// rescan. Custom-token add flow (Commit 8) wires here.
//
// Phase 4 chain-gap: no on-chain USD oracle yet — the USD column
// renders [mock]. See GAP #D13 in the Phase 4 final report.

import { useCallback, useEffect, useState } from "react";
import { IDENTITY } from "../data/fixtures";
import { AddCustomToken } from "../components/AddCustomToken";
import { Identity } from "../components/Identity";
import { NftCollectionPanel } from "../components/NftCollectionPanel";
import { SendErc20Form } from "../components/SendErc20Form";
import {
  formatTokenAmount,
  getTokenBalance,
  getTokenMetadata,
} from "../sdk/erc20";
import { discoverTokens, type DiscoveredToken } from "../sdk/token-discovery";
import {
  addToken,
  hideToken,
  listVisibleTokens,
  type TrackedToken,
} from "../sdk/token-list";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

interface Erc20Row {
  token: TrackedToken;
  balance: bigint | null;
}

export function Tokens() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [tracked, setTracked] = useState<TrackedToken[]>([]);
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [addOpen, setAddOpen] = useState(false);

  const refresh = useCallback(async (forceRescan = false) => {
    setState({ kind: "loading" });
    // 1. Discovery scan — pulls every contract the holder has touched.
    const discovery = await discoverTokens(IDENTITY.address, {
      useCache: !forceRescan,
    });
    if (discovery.ok && discovery.value) {
      for (const t of discovery.value) {
        await mergeDiscovered(t);
      }
    }
    // 2. Re-read the persisted list (now includes anything new from #1).
    const visible = listVisibleTokens();
    setTracked(visible);
    // 3. Fetch balances for ERC-20 rows in parallel.
    const erc20s = visible.filter((t) => t.kind === "erc20");
    const balanceResults = await Promise.all(
      erc20s.map(async (t) => {
        const out = await getTokenBalance(t.contract, IDENTITY.address);
        return [t.contract, out.ok && typeof out.value === "bigint" ? out.value : 0n] as const;
      }),
    );
    setBalances(new Map(balanceResults));
    setState({ kind: "ready" });
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const erc20Rows: Erc20Row[] = tracked
    .filter((t) => t.kind === "erc20")
    .map((token) => ({ token, balance: balances.get(token.contract) ?? null }));

  const erc721Rows = tracked.filter((t) => t.kind === "erc721");
  const erc1155Rows = tracked.filter((t) => t.kind === "erc1155");

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Tokens</h1>
        <div className="sub">
          Your portfolio across LYTH + ERC-20 + ERC-721 + ERC-1155.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          className="btn btn--sm btn--primary"
          onClick={() => void refresh(true)}
          disabled={state.kind === "loading"}
        >
          {state.kind === "loading" ? "Scanning…" : "Refresh"}
        </button>
        <button
          className="btn btn--sm btn--ghost"
          onClick={() => setAddOpen((v) => !v)}
        >
          {addOpen ? "Cancel add" : "+ Add custom token"}
        </button>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          Auto-detects from on-chain Transfer events; add a custom token
          if you hold something this scan missed.
        </span>
      </div>

      {addOpen ? (
        <AddCustomToken
          onAdded={() => {
            setAddOpen(false);
            void refresh(false);
          }}
          onCancel={() => setAddOpen(false)}
        />
      ) : null}

      {state.kind === "error" ? (
        <div className="w-banner error">{state.message}</div>
      ) : null}

      <Erc20Section rows={erc20Rows} onChanged={() => void refresh(false)} />
      <NftSection
        title="ERC-721 collections"
        tokens={erc721Rows}
        onChanged={() => void refresh(false)}
      />
      <NftSection
        title="ERC-1155 collections"
        tokens={erc1155Rows}
        onChanged={() => void refresh(false)}
      />

      {erc20Rows.length === 0 &&
      erc721Rows.length === 0 &&
      erc1155Rows.length === 0 &&
      state.kind === "ready" ? (
        <div className="w-card" style={{ marginTop: 12 }}>
          <div className="w-card__body" style={{ color: "var(--w-text-3)", fontSize: 13 }}>
            No tokens detected. Add a custom token if you hold tokens the
            scan missed.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Erc20Section({
  rows,
  onChanged,
}: {
  rows: Erc20Row[];
  onChanged: () => void;
}) {
  const [sendOpen, setSendOpen] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <div className="w-card" style={{ marginBottom: 12 }}>
      <div className="w-card__head">
        <h3>ERC-20 holdings</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {rows.length} {rows.length === 1 ? "token" : "tokens"}
        </span>
      </div>
      <div className="w-card__body" style={{ padding: 0 }}>
        {rows.map((row) => (
          <Erc20TokenRow
            key={row.token.contract}
            row={row}
            onChanged={onChanged}
            sendOpen={sendOpen === row.token.contract}
            onOpenSend={() => setSendOpen(row.token.contract)}
            onCloseSend={() => setSendOpen(null)}
          />
        ))}
      </div>
    </div>
  );
}

function Erc20TokenRow({
  row,
  onChanged,
  sendOpen,
  onOpenSend,
  onCloseSend,
}: {
  row: Erc20Row;
  onChanged: () => void;
  sendOpen: boolean;
  onOpenSend: () => void;
  onCloseSend: () => void;
}) {
  const decimals = row.token.decimals ?? 18;
  const formatted = row.balance === null ? "—" : formatTokenAmount(row.balance, decimals);
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto auto auto",
          gap: 12,
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid var(--w-border)",
        }}
      >
        <TokenLogo symbol={row.token.symbol} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {row.token.symbol || "?"}{" "}
            {row.token.name ? (
              <span className="cap" style={{ marginLeft: 6, fontWeight: 400 }}>
                {row.token.name}
              </span>
            ) : null}
          </div>
          <div className="cap" style={{ marginTop: 2 }}>
            <Identity addr={row.token.contract} />
          </div>
        </div>
        <div className="mono" style={{ fontSize: 13, textAlign: "right" }}>
          {typeof formatted === "number" ? formatted.toLocaleString(undefined, {
            maximumFractionDigits: 6,
          }) : formatted}
          <div className="cap" style={{ marginTop: 2 }}>
            <span className="w-mock-tag" title="No on-chain oracle yet">
              [mock] USD
            </span>
          </div>
        </div>
        <button
          className="btn btn--sm btn--primary"
          onClick={onOpenSend}
          disabled={row.balance === null || row.balance === 0n}
        >
          Send
        </button>
        <RowActions
          contract={row.token.contract}
          onChanged={onChanged}
        />
      </div>
      {sendOpen && row.balance !== null ? (
        <SendErc20Form
          token={row.token}
          balance={row.balance}
          onClose={onCloseSend}
          onSubmitted={onChanged}
        />
      ) : null}
    </>
  );
}

function NftSection({
  title,
  tokens,
  onChanged,
}: {
  title: string;
  tokens: TrackedToken[];
  onChanged: () => void;
}) {
  if (tokens.length === 0) return null;
  return (
    <div className="w-card" style={{ marginBottom: 12 }}>
      <div className="w-card__head">
        <h3>{title}</h3>
        <span className="cap" style={{ color: "var(--w-text-3)" }}>
          {tokens.length} {tokens.length === 1 ? "collection" : "collections"}
        </span>
      </div>
      <div className="w-card__body" style={{ padding: 0 }}>
        {tokens.map((token) => (
          <NftCollectionRow
            key={token.contract}
            token={token}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

function NftCollectionRow({
  token,
  onChanged,
}: {
  token: TrackedToken;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
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
        <TokenLogo symbol={token.symbol || token.kind.toUpperCase()} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {token.symbol || token.kind.toUpperCase()}{" "}
            {token.name ? (
              <span className="cap" style={{ marginLeft: 6, fontWeight: 400 }}>
                {token.name}
              </span>
            ) : null}
          </div>
          <div className="cap" style={{ marginTop: 2 }}>
            <Identity addr={token.contract} />
          </div>
        </div>
        <button
          className="btn btn--sm btn--ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "▾ Hide" : "▸ View"}
        </button>
        <RowActions contract={token.contract} onChanged={onChanged} />
      </div>
      {expanded ? <NftCollectionPanel token={token} /> : null}
    </>
  );
}

function TokenLogo({ symbol }: { symbol: string }) {
  // Placeholder logo — first letter inside a colored circle. Phase 5
  // can wire a real registry (token-list.tokenlists.org parity).
  const initial = (symbol || "?").slice(0, 1).toUpperCase();
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        background: "rgba(var(--gold-glow), 0.18)",
        color: "var(--gold-hi)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {initial}
    </div>
  );
}

function RowActions({
  contract,
  onChanged,
}: {
  contract: string;
  onChanged: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        className="btn btn--sm btn--ghost"
        onClick={() =>
          window.open(
            `https://monoscan.io/address/${contract}`,
            "_blank",
            "noopener,noreferrer",
          )
        }
      >
        Monoscan
      </button>
      <button
        className="btn btn--sm btn--ghost"
        onClick={() => {
          if (window.confirm("Hide this token from your portfolio?")) {
            hideToken(contract);
            onChanged();
          }
        }}
        style={{ color: "var(--w-text-3)" }}
      >
        Hide
      </button>
    </div>
  );
}

/** Merge a discovered token into the persisted list. Pulls metadata
 *  for new entries via the matching reader; existing rows preserve
 *  their pinned/hidden state through `addToken`'s upsert behavior. */
async function mergeDiscovered(disc: DiscoveredToken): Promise<void> {
  // Already-tracked? Re-discovery is a no-op for the persisted state.
  const existing = listVisibleTokens().find(
    (t) => t.contract === disc.contract.toLowerCase(),
  );
  if (existing) return;
  if (disc.kind === "erc20") {
    const metaOut = await getTokenMetadata(disc.contract);
    if (!metaOut.ok || !metaOut.value) return;
    addToken({
      contract: disc.contract,
      kind: "erc20",
      symbol: metaOut.value.symbol,
      name: metaOut.value.name,
      decimals: metaOut.value.decimals,
    });
    return;
  }
  // ERC-721 / ERC-1155: pull just name + symbol via the ERC-20-style
  // helpers (most collections implement them too).
  const metaOut = await getTokenMetadata(disc.contract);
  addToken({
    contract: disc.contract,
    kind: disc.kind,
    symbol: metaOut.ok ? metaOut.value?.symbol ?? "" : "",
    name: metaOut.ok ? metaOut.value?.name ?? "" : "",
  });
}
