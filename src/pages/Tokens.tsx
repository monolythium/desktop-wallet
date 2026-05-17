// Tokens page — full asset list. Public denom only.

import { useEffect, useState } from "react";
import { TOKENS } from "../data/fixtures";
import { TokenRow } from "../components/TokenRow";
import { IDENTITY } from "../data/fixtures";
import { formatAddressShort } from "../components/format";
import { errorMessage, loadLiveTokenStatus, type LiveTokenStatus } from "../sdk/live";

export function Tokens() {
  const [live, setLive] = useState<LiveTokenStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setLive(await loadLiveTokenStatus(IDENTITY.address));
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
  }, []);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Tokens</h1>
        <div className="sub">All assets held by this wallet on the Monolythium chain.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live native asset</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          <LiveLine k="Endpoint" v={live?.endpoint ?? "loading"} mono />
          <LiveLine k="LYTH balance" v={live?.nativeBalance.ok ? `${live.nativeBalance.value ?? "0"} LYTH` : live?.nativeBalance.error ?? "loading"} mono />
          <LiveLine k="Indexed assets" v={live?.tokenBalances.ok ? `${live.tokenBalances.value?.length ?? 0}` : live?.tokenBalances.error ?? "loading"} mono />
          <LiveLine
            k="Address label"
            v={live?.addressLabel.ok
              ? live.addressLabel.value
                ? `${live.addressLabel.value.category}${live.addressLabel.value.displayName ? ` · ${live.addressLabel.value.displayName}` : ""}`
                : "unlabeled"
              : live?.addressLabel.error ?? "loading"}
          />
          <LiveLine
            k="LYTH policy"
            v={live?.assetPolicy.ok ? `${String(live.assetPolicy.value?.mode ?? "unknown")} · explicit ${String(live.assetPolicy.value?.explicit ?? false)}` : live?.assetPolicy.error ?? "loading"}
          />
          {live?.tokenBalances.ok && live.tokenBalances.value && live.tokenBalances.value.length > 0 ? (
            <div className="w-live-list">
              {live.tokenBalances.value.map((row) => (
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
          ) : null}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Holdings</h3>
        </div>
        <div className="w-card__body">
          {TOKENS.map((t) => <TokenRow key={t.sym} token={t} />)}
        </div>
      </div>
    </div>
  );
}

function LiveLine({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="w-kv">
      <span className="k">{k}</span>
      <span className={`v ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}
