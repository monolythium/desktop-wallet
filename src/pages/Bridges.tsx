// Bridges page — trusted-route disclosure read-only view (§20.2 / §25.2).
//
// Two renderings live here, selected by the experimental-surfaces flag:
//
//  - OFF (default): the stable route table — loads `lyth_bridgeRoutes`
//    from the connected node and renders the disclosure fields (drain
//    cap, finality, fee token, verifier model, circuit breaker,
//    insurance). No write surface — this is the transparent registry of
//    who's trusted.
//
//  - ON: the same registry plus the per-route risk panel — each disclosed
//    route gets its SDK-computed risk tier (chromatic halo), the live
//    drain-cap remaining (lyth_bridgeDrainStatus), and the global
//    circuit-breaker posture (lyth_bridgeHealth). Still no write surface;
//    the wallet exposes no live bridge send (blocked at the SDK boundary).
//
// When the flag is off the page is byte-for-byte the stable table, so the
// risk-panel preview is fully opt-in.

import { useEffect, useState } from "react";
import type { BridgeRouteDisclosure } from "@monolythium/core-sdk";
import { getProvider } from "../sdk/client";
import { BridgeRiskPanel } from "../components/BridgeRiskPanel";
import {
  assessRoute,
  fetchBridgeHealth,
  fetchBridgeRoutes,
  fetchDrainStatus,
} from "../sdk/bridge";
import type { BridgeDrainStatus } from "../sdk/bridge";

interface BridgesProps {
  /** When true, render the per-route risk panel preview; otherwise the stable table. */
  experimentalEnabled?: boolean;
}

export function Bridges({ experimentalEnabled }: BridgesProps) {
  return experimentalEnabled ? <BridgesRiskView /> : <BridgesStableView />;
}

// ---------------------------------------------------------------------------
// Stable view — the pre-preview route table (matches the non-experimental
// surface). Read-only registry, no risk-tier scoring.
// ---------------------------------------------------------------------------

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

function formatAtomic(value: string | undefined | null): string {
  if (value === undefined || value === null) return "—";
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

function BridgesStableView() {
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

// ---------------------------------------------------------------------------
// Risk view — registry + per-route risk panel (experimental preview).
// ---------------------------------------------------------------------------

function BridgesRiskView() {
  const [routes, setRoutes] = useState<BridgeRouteDisclosure[]>([]);
  const [drainByRoute, setDrainByRoute] = useState<
    Map<string, BridgeDrainStatus>
  >(new Map());
  const [breakerById, setBreakerById] = useState<Map<string, string>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const { routes: fetched } = await fetchBridgeRoutes(undefined, 25);
      setRoutes(fetched);

      // Best-effort: page bridge health for circuit-breaker posture keyed
      // by bridgeId. A failure here must not blank the route list.
      const breaker = new Map<string, string>();
      try {
        const health = await fetchBridgeHealth(null, 50);
        for (const rec of health.records) {
          breaker.set(rec.bridgeId, rec.circuitBreaker.paused ? "paused" : rec.status);
        }
      } catch {
        // breaker stays empty — the disclosure's own circuitBreaker field
        // still renders in the panel.
      }
      setBreakerById(breaker);

      // Best-effort live drain bucket per route (bridgeId + wrapped asset).
      const drain = new Map<string, BridgeDrainStatus>();
      await Promise.all(
        fetched.map(async (r) => {
          // The disclosure carries `bridge`/`asset` labels; the live drain
          // read keys on the 32-byte bridgeId + wrapped asset. Only attempt
          // when a route-level bridge id is exposed via the catalogue route.
          const bridgeId = (r as { bridgeId?: string }).bridgeId;
          if (!bridgeId) return;
          try {
            const status = await fetchDrainStatus(bridgeId, r.asset);
            drain.set(r.routeId, status);
          } catch {
            // no per-asset cap or read failure — leave unset.
          }
        }),
      );
      setDrainByRoute(drain);
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
          Trusted bridge route disclosures. Read-only registry with per-route
          risk assessment — the wallet exposes no live bridge send.
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Disclosed routes</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <button
            className="btn btn--sm"
            onClick={() => void refresh()}
            disabled={busy}
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {error ? <div className="w-live-error">{error}</div> : null}
          {!error && routes.length === 0 ? (
            <div className="row-help">
              No bridge route disclosures returned. Either the indexer is still
              catching up or no routes have been seeded for this network.
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 14 }}>
            {routes.map((route) => {
              const assessment = assessRoute(route);
              const breaker = breakerById.get(
                (route as { bridgeId?: string }).bridgeId ?? "",
              );
              return (
                <div key={route.routeId} style={{ display: "grid", gap: 4 }}>
                  <BridgeRiskPanel
                    route={route}
                    assessment={assessment}
                    drainStatus={drainByRoute.get(route.routeId) ?? null}
                  />
                  <div
                    className="row-help mono"
                    style={{ fontSize: 11, paddingLeft: 4 }}
                  >
                    {route.routeId}
                    {breaker ? ` · health: ${breaker}` : ""}
                  </div>
                </div>
              );
            })}
          </div>

          {routes.length > 0 ? (
            <div className="row-help" style={{ marginTop: 14 }}>
              These disclosures come from the chain's trusted-routes registry.
              The risk tier is computed locally by the SDK from each route's
              drain cap, finality, verifier model, circuit-breaker posture, and
              incident history so users can verify before signing any bridge
              call.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
