// Bridges page — trusted-route disclosure read-only view (§20.2 / §25.2).
//
// Loads `lyth_bridgeRoutes` through the typed SDK seam and renders each
// disclosed route with its SDK-computed risk tier (chromatic halo), the
// live drain-cap remaining (lyth_bridgeDrainStatus), and the global
// circuit-breaker posture (lyth_bridgeHealth). No write surface — the
// wallet exposes no live bridge send (blocked at the SDK boundary); this
// page is the transparent registry of who's trusted plus the per-route
// pre-send risk disclosure.

import { useEffect, useState } from "react";
import type { BridgeRouteDisclosure } from "@monolythium/core-sdk";
import { BridgeRiskPanel } from "../components/BridgeRiskPanel";
import {
  assessRoute,
  fetchBridgeHealth,
  fetchBridgeRoutes,
  fetchDrainStatus,
} from "../sdk/bridge";
import type { BridgeDrainStatus } from "../sdk/bridge";

export function Bridges() {
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
