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
//    route gets its SDK-computed risk tier (chromatic halo), derived from the
//    disclosure itself. Still no write surface; the wallet exposes no live
//    bridge send (blocked at the SDK boundary). It does NOT join the live
//    drain / health reads — see the note on BridgesRiskView for why that join
//    can never resolve.
//
// When the flag is off the page is byte-for-byte the stable table, so the
// risk-panel preview is fully opt-in.

import { useEffect, useState } from "react";
import type { BridgeRouteDisclosure } from "@monolythium/core-sdk";
import { getProvider } from "../sdk/client";
import { formatAtomic1e18 } from "../sdk/lyth-display";
import { BridgeRiskPanel } from "../components/BridgeRiskPanel";
import { DevModeStub } from "../components/DevModeStub";
import { RefreshButton } from "../components/RefreshButton";
import { useDeveloperMode } from "../sdk/developer-mode";
import type { Route } from "../components/types";
import { assessRoute, fetchBridgeRoutes } from "../sdk/bridge";

interface BridgesProps {
  /** When true, render the per-route risk panel preview; otherwise the stable table. */
  experimentalEnabled?: boolean;
  /** Navigate — the developer-mode stub links to the pages hosting the toggle. */
  goto: (r: Route) => void;
}

/**
 * GATED — the precompile is retired; the ROUTE CATALOGUE is what survives.
 *
 * An earlier note here read the bridge slot's `kind: "gateable"` as proof the
 * chain was holding the capability open. That inference does not hold, and the
 * reason is worth keeping: `kind` is DERIVED, and `gateable` is tested before
 * `retired-rejecting`, so a slot that stays gateable can never report itself
 * retired however retired it is. The absence of that label carries no
 * information, and no future reading of it will either.
 *
 * What the chain does say, in the slot's own revert: the in-tree bridge was
 * removed in favour of an external interop integration and the slot CANNOT BE
 * RE-ACTIVATED. A node refuses at boot any milestone that would activate it, at
 * any height. So `enabled: true` is not a trigger — it is unreachable, and any
 * note waiting on it would wait forever.
 *
 * The surface is kept because the removal deliberately KEPT the third-party
 * route disclosure catalogue — `lyth_bridgeRoutes`, which is what this page
 * reads. Bridging moves from chain-operated to third-party-disclosed, and
 * publishing those disclosures is this wallet's part in it. The registry is
 * empty until external providers' routes are imported, and an ungated entry
 * leading to an empty screen is a promise the wallet cannot keep.
 *
 * UNGATE WHEN: the route read returns a non-empty catalogue (`routeCount > 0`).
 * That is the condition this page exists to serve, and unlike the slot's gate
 * it is something the read itself reports.
 */
export function Bridges({ experimentalEnabled, goto }: BridgesProps) {
  const devMode = useDeveloperMode();
  // Gated at the dispatcher, so NEITHER view mounts and neither one's read
  // fires — the zero-network law a stubbed page must satisfy. The page keeps
  // its own header so the user still sees where they are.
  if (!devMode) {
    return (
      <div className="w-page">
        <div className="w-page__header">
          <h1>Bridges</h1>
          <div className="sub">
            Trusted bridge route disclosures. Read-only registry with per-route
            risk assessment — the wallet exposes no live bridge send.
          </div>
        </div>
        <DevModeStub
          body="This chain does not run its own bridge. It publishes the routes of third-party bridges so they can be checked before use, and no such route has been published yet — so this registry is empty for everyone. It stays available to developers until that changes."
          goto={goto}
        />
      </div>
    );
  }
  return experimentalEnabled ? <BridgesRiskView /> : <BridgesStableView />;
}

// ---------------------------------------------------------------------------
// Stable view — the pre-preview route table (matches the non-experimental
// surface). Read-only registry, no risk-tier scoring.
// ---------------------------------------------------------------------------

// Fields of the lyth_bridgeRoutes disclosure envelope (BridgeRouteDisclosure).
// bridgeId / updatedAtBlock are NOT here — they live on the separate catalogue
// route shape, which this read never returns — so the table does not claim them.
interface RouteRow {
  routeId?: string;
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
  lastIncidentDate?: string | null;
  verifier?: { model?: string; participantCount?: number; threshold?: number };
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
        {/* This wallet has no bridge send path — not a blocked one, none at
            all: no encoder, no submit, and the SDK gates quote and submit
            behind blocked-reason constants. An earlier line here said the
            wallet "bridges through signed calls elsewhere", which the other
            two renderings already contradicted. They were right.

            The vendor name is gone too. A protocol is named per ROUTE, by the
            disclosure's own `protocol` field; the registry is what this header
            describes, and naming one bridge over it asserts of the whole set
            what only a row can say — while the set is empty, it describes
            nothing at all. Chain policy constraining which protocols MAY be
            registered is not the same claim, and is not this page's to make. */}
        <div className="sub">
          Trusted route disclosures for third-party bridges. Read-only registry — the
          wallet exposes no live bridge send.
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Disclosed routes</h3>
          <span className="w-live-pill">live</span>
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={() => void refresh()} />
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
              <div className="w-kv"><span className="k">Drain cap</span><span className="v">{formatAtomic1e18(row.drainCapAtomic)}</span></div>
              <div className="w-kv"><span className="k">Insurance pool</span><span className="v">{formatAtomic1e18(row.insuranceAtomic)}</span></div>
              <div className="w-kv"><span className="k">Finality</span><span className="v">{row.finalityBlocks ?? "—"} blocks · cooldown {row.cooldownSeconds ?? "—"}s</span></div>
              <div className="w-kv"><span className="k">Verifier</span><span className="v">{row.verifier?.model ?? "—"} ({row.verifier?.threshold ?? "?"}/{row.verifier?.participantCount ?? "?"})</span></div>
              <div className="w-kv"><span className="k">Admin control</span><span className="v">{row.adminControl ?? "—"}</span></div>
              <div className="w-kv"><span className="k">Circuit breaker</span><span className="v">{row.circuitBreaker ?? "—"}</span></div>
              <div className="w-kv"><span className="k">Last incident</span><span className="v">{row.lastIncidentDate ?? "none on record"}</span></div>
            </div>
          ))}
          {rows.length > 0 ? (
            <div className="row-help">
              These disclosures come from the chain's trusted-routes registry. Each
              route publishes its own fee token, drain cap, finality and verifier
              model — shown above — so a route can be checked before it is used.
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

// NO DRAIN / HEALTH JOIN HERE, and it is not an omission.
//
// Both reads key on a 32-byte `bridgeId`. `BridgeRouteDisclosure` — the shape
// `lyth_bridgeRoutes` actually returns — does not carry one, and does not carry
// `updatedAtBlock` either; those fields live on the separate catalogue-route
// shape this read never returns. The stable table above already says as much.
// So the join key is absent by construction, not merely missing while the
// registry is empty: seeding routes would not produce it.
//
// The reads would also tell us nothing if the key existed. Both address the
// retired `0x1008` namespace, which only the removed precompile could ever have
// written, so every value in it is zero permanently rather than pending.
//
// A join that cannot resolve against state that cannot be non-zero is not a
// best-effort enrichment; it is two round-trips per refresh in exchange for
// nothing. The disclosure's own `circuitBreaker` field still renders.
function BridgesRiskView() {
  const [routes, setRoutes] = useState<BridgeRouteDisclosure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const { routes: fetched } = await fetchBridgeRoutes(undefined, 25);
      setRoutes(fetched);
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
          <RefreshButton busy={busy} onClick={() => void refresh()} />
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
            {routes.map((route) => (
              <div key={route.routeId} style={{ display: "grid", gap: 4 }}>
                <BridgeRiskPanel route={route} assessment={assessRoute(route)} />
                <div
                  className="row-help mono"
                  style={{ fontSize: 11, paddingLeft: 4 }}
                >
                  {route.routeId}
                </div>
              </div>
            ))}
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
