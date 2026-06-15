// Tokens page — full asset list. Public denom only.
//
// The list is live: the native LYTH balance plus any indexed MRC-20 rows
// from `loadLiveTokenStatus`. There is no price oracle and no token-name
// registry on-chain, so price / USD value / 24h change render as an em-dash
// ("—") rather than a fabricated figure (see `liveTokenStatusToRows`).

import { useEffect, useState } from "react";
import { TokenRow } from "../components/TokenRow";
import type { Route } from "../components/types";
import { useActiveWallet } from "../sdk/active-wallet";
import { errorMessage, loadLiveTokenStatus, type LiveTokenStatus } from "../sdk/live";
import { MONOSCAN_GET_LYTH_URL } from "../sdk/monoscan";
import { NATIVE_TOKEN_REF, writeSelectedToken } from "../sdk/selected-token";
import { liveTokenStatusToRows } from "../sdk/token-rows";

interface Props {
  goto: (r: Route) => void;
}

export function Tokens({ goto }: Props) {
  const wallet = useActiveWallet();
  const walletAddress = wallet.status === "ready" ? wallet.address : "";
  const [live, setLive] = useState<LiveTokenStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!walletAddress) {
      setLive(null);
      return;
    }
    setBusy(true);
    try {
      setLive(await loadLiveTokenStatus(walletAddress));
    } catch (cause) {
      setLive({
        endpoint: "unavailable",
        nativeBalance: { ok: false, error: errorMessage(cause) },
        tokenBalances: { ok: false, error: errorMessage(cause) },
        addressLabel: { ok: false, error: errorMessage(cause) },
        assetPolicy: { ok: false, error: errorMessage(cause) },
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [walletAddress]);

  const rows = liveTokenStatusToRows(live);
  // Token references aligned to `rows`: row 0 is native; the rest are the raw
  // MRC-20 token ids in the same indexer order `liveTokenStatusToRows` used.
  // Clicking a row stores its ref and opens the token-detail page.
  const tokenIds = live?.tokenBalances.ok ? live.tokenBalances.value ?? [] : [];
  const refForRow = (index: number): string =>
    index === 0 ? NATIVE_TOKEN_REF : tokenIds[index - 1]?.tokenId ?? NATIVE_TOKEN_REF;
  const openDetail = (index: number) => {
    writeSelectedToken(refForRow(index));
    goto("token-detail");
  };
  // The native row is always present; MRC-20 rows are appended only when the
  // balance query succeeded. A failed native query surfaces as an error line.
  const nativeFailed = live?.nativeBalance.ok === false;
  const tokenFailed = live?.tokenBalances.ok === false;

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Tokens</h1>
        <div className="sub">
          {walletAddress ? `Assets for ${walletAddress}` : "Select or unlock a wallet to load assets."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Holdings</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          {/* No on-ramp primitive exists in the wallet (or the SDK) — Buy opens
              the canonical monoscan sale page externally, the same honest link
              the Home hero and the token-detail action bar use. We never ship a
              fake in-app card/bank/exchange on-ramp. */}
          <a
            className="btn btn--sm"
            href={MONOSCAN_GET_LYTH_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: "none" }}
          >
            Buy
          </a>
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {!walletAddress ? (
            <div className="row-help">No active wallet address.</div>
          ) : live === null ? (
            <div className="row-help">Loading assets…</div>
          ) : (
            <>
              {rows.map((token, index) => (
                <TokenRow
                  key={token.primary ? "native" : `${token.sym}-${index}`}
                  token={token}
                  onClick={() => openDetail(index)}
                />
              ))}
              {nativeFailed ? (
                <div className="w-live-error">LYTH balance: {live.nativeBalance.error}</div>
              ) : null}
              {tokenFailed ? (
                <div className="w-live-error">token balances: {live.tokenBalances.error}</div>
              ) : null}
            </>
          )}
        </div>
        <div className="w-tokens__net">
          <span className="dot" />
          <span>Network</span>
          <span className="mono">{live?.endpoint ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
