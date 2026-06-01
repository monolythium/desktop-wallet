// Tokens page — full asset list. Public denom only.
//
// The list is live: the native LYTH balance plus any indexed MRC-20 rows
// from `loadLiveTokenStatus`. There is no price oracle and no token-name
// registry on-chain, so price / USD value / 24h change render as an em-dash
// ("—") rather than a fabricated figure (see `liveTokenStatusToRows`).

import { useEffect, useState } from "react";
import { TokenRow } from "../components/TokenRow";
import { useActiveWallet } from "../sdk/active-wallet";
import { errorMessage, loadLiveTokenStatus, type LiveTokenStatus } from "../sdk/live";
import { liveTokenStatusToRows } from "../sdk/token-rows";

export function Tokens() {
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
              {rows.map((token) => (
                <TokenRow key={token.primary ? "native" : token.sym} token={token} />
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
