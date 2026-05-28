// Bridges page — Chainlink CCIP route disclosure read-only view.
//
// Loads `lyth_bridgeRoutes` from the connected node and renders the
// route table with the disclosure fields (drain cap, finality, fee
// token, verifier model, circuit breaker, insurance). No write
// surface — wallet routes funds *through* signed bridge calls
// elsewhere; this page is the transparent registry of who's trusted.

import { useEffect, useState } from "react";
import { getProvider } from "../sdk/client";

interface RouteRow {
  routeId?: string;
  bridgeId?: string;
  bridge?: string;
  asset?: string;
  feeToken?: string;
  sourceChain?: string;
  destinationChain?: string;
  drainCapAtomic?: string;
  finalityBlocks?: number;
  cooldownSeconds?: number;
  adminControl?: string;
  circuitBreaker?: string;
  insuranceAtomic?: string;
  updatedAtBlock?: number;
  lastIncidentDate?: string | null;
  verifier?: { model?: string; participantCount?: number; threshold?: number };
}

function formatAtomic(value: string | undefined): string {
  if (!value) return "—";
  try {
    const n = BigInt(value);
    if (n === 0n) return "0";
    if (n >= 10n ** 18n) {
      return `${(Number(n) / 1e18).toFixed(2)} (1e18 atoms)`;
    }
    return n.toString();
  } catch {
    return value;
  }
}

export function Bridges() {
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = getProvider();
      const res: { routes?: RouteRow[] } = await provider.rpcClient.call("lyth_bridgeRoutes", [{ limit: 25 }]);
      setRows(res.routes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <h1>Bridges</h1>
        <div className="sub">
          Trusted Chainlink CCIP route disclosures. Read-only registry — wallet bridges through signed calls elsewhere.
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Disclosed routes</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button className="btn btn--sm" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {error ? <div className="w-live-error">{error}</div> : null}
          {!error && rows.length === 0 ? (
            <div className="row-help">No bridge route disclosures returned. Either the indexer is still catching up or no routes have been seeded for this network.</div>
          ) : null}
          {rows.map((row) => (
            <div key={row.routeId} style={{ display: "grid", gap: 4, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h4 style={{ margin: 0 }}>
                  {row.asset ?? "?"} via {row.bridge ?? "?"}
                </h4>
                <code className="mono" style={{ fontSize: 12 }}>{row.routeId}</code>
              </div>
              <div className="w-kv"><span className="k">Route</span><span className="v">{row.sourceChain} → {row.destinationChain}</span></div>
              <div className="w-kv"><span className="k">Fee token</span><span className="v">{row.feeToken ?? "—"}</span></div>
              <div className="w-kv"><span className="k">Drain cap</span><span className="v">{formatAtomic(row.drainCapAtomic)}</span></div>
              <div className="w-kv"><span className="k">Insurance pool</span><span className="v">{formatAtomic(row.insuranceAtomic)}</span></div>
              <div className="w-kv"><span className="k">Finality</span><span className="v">{row.finalityBlocks ?? "—"} blocks · cooldown {row.cooldownSeconds ?? "—"}s</span></div>
              <div className="w-kv"><span className="k">Verifier</span><span className="v">{row.verifier?.model ?? "—"} ({row.verifier?.threshold ?? "?"}/{row.verifier?.participantCount ?? "?"})</span></div>
              <div className="w-kv"><span className="k">Admin control</span><span className="v">{row.adminControl ?? "—"}</span></div>
              <div className="w-kv"><span className="k">Circuit breaker</span><span className="v">{row.circuitBreaker ?? "—"}</span></div>
              <div className="w-kv"><span className="k">Bridge id</span><span className="v mono" style={{ fontSize: 11 }}>{row.bridgeId}</span></div>
              <div className="w-kv"><span className="k">Last incident</span><span className="v">{row.lastIncidentDate ?? "none on record"}</span></div>
              <div className="w-kv"><span className="k">Updated at block</span><span className="v">{row.updatedAtBlock ?? "—"}</span></div>
            </div>
          ))}
          {rows.length > 0 ? (
            <div className="row-help">
              These disclosures come from the chain's trusted-routes registry. They publish the foundation-curated CCIP routes, their fee token (LINK), drain caps, finality, and verifier model so users can verify before signing a bridge call.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
