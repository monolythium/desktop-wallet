// News page — chain-relevant news feed. Sourced from Foundation
// announcements + opt-in third-party feeds. No on-chain dependency.

import { useEffect, useState } from "react";
import { TodoSection } from "../components/TodoSection";
import { formatOutcome, loadLiveNetworkStatus, type LiveNetworkStatus } from "../sdk/live";

export function News() {
  const [status, setStatus] = useState<LiveNetworkStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      setStatus(await loadLiveNetworkStatus());
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const precompiles = status?.activePrecompiles.ok ? status.activePrecompiles.value ?? [] : [];

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>News</h1>
        <div className="sub">Foundation announcements · network events · ecosystem.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Live network status</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={refresh} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          <div className="w-live-grid">
            <LiveCell label="Chain" value={status ? formatOutcome(status.chainId, String) : "loading"} />
            <LiveCell label="Block" value={status ? formatOutcome(status.blockHeight, String) : "loading"} />
            <LiveCell label="Peers" value={status ? formatOutcome(status.peerCount, String) : "loading"} />
            <LiveCell label="Listening" value={status ? formatOutcome(status.listening, String) : "loading"} />
            <LiveCell label="Round" value={status ? formatOutcome(status.currentRound, (round) => round.height.toString()) : "loading"} />
            <LiveCell label="Precompiles" value={status ? formatOutcome(status.activePrecompiles, (rows) => rows.length.toString()) : "loading"} />
          </div>
          {status ? <div className="row-help">Endpoint: <span className="mono">{status.endpoint}</span></div> : null}
          {status?.clientVersion.ok ? <div className="row-help">Client: <span className="mono">{status.clientVersion.value}</span></div> : null}
          {status?.clientVersion.ok === false ? <div className="w-live-error">clientVersion: {status.clientVersion.error}</div> : null}
          {status?.mempoolStatus.ok ? <div className="row-help">Mempool: <span className="mono">{compact(status.mempoolStatus.value)}</span></div> : null}
          {status?.indexerStatus.ok ? <div className="row-help">Indexer: <span className="mono">{compact(status.indexerStatus.value)}</span></div> : null}
          {status?.syncStatus.ok ? <div className="row-help">DAG sync: <span className="mono">{compact(status.syncStatus.value)}</span></div> : null}
          {precompiles.length > 0 ? (
            <div className="w-live-list">
              {precompiles.slice(0, 8).map((precompile) => (
                <div className="w-live-row" key={`${precompile.address}:${precompile.name}`}>
                  <div>
                    <div className="row-label">{precompile.name}</div>
                    <div className="row-help mono">{precompile.address}</div>
                  </div>
                  <span className={`w-live-pill ${precompile.enabled ? "" : "is-muted"}`}>
                    {precompile.enabled ? "enabled" : precompile.gateable ? "gated" : "disabled"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {status?.activePrecompiles.ok === false ? <div className="w-live-error">activePrecompiles: {status.activePrecompiles.error}</div> : null}
        </div>
      </div>

      <TodoSection
        title="Pinned"
        items={[
          "TODO — current testnet status (chain_id 69420 · live)",
          "TODO — known incidents / planned maintenance",
          "TODO — security advisories",
        ]}
      />

      <TodoSection
        title="Feed"
        items={[
          "TODO — chronological list of headlines + 1-line summary",
          "TODO — tags: Foundation · ecosystem · operator · protocol",
          "TODO — read / unread state per article",
          "TODO — open in webview (Tauri) without leaving wallet",
        ]}
      />

      <TodoSection
        title="Network events"
        items={[
          "TODO — slashing events (24h / 7d / 30d windows)",
          "TODO — upgrade signals (when chain upgrade is staged)",
          "TODO — bridge state changes",
        ]}
      />

      <TodoSection
        title="Subscriptions"
        items={[
          "TODO — manage subscribed sources (default: Foundation only)",
          "TODO — RSS / Atom import",
          "TODO — quiet-hours / digest-only mode",
        ]}
      />
    </div>
  );
}

function LiveCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-live-cell">
      <div className="cap">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return "disabled";
  return JSON.stringify(value, (_key, inner) => (
    typeof inner === "bigint" ? inner.toString() : inner
  ));
}
