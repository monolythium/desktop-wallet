// Operator inspection round — the data the Operators screen shows.
//
// For each catalogue operator it runs, in PARALLEL: a fresh trust verdict
// (lyth_chainStats via a transient client — never the shared seam, so the round
// works while the wallet is fail-closed), a reachability/latency/height probe, a
// capabilities read, and an indexer-status read. Every sub-probe is raced
// against a per-operator deadline and folds to its honest absence on expiry, so
// the whole round is bounded regardless of any one operator wedging. Nothing
// here is persisted, and none of it touches getProvider() — this screen's whole
// job is to be usable precisely when the trusted read path is refusing.

import { RpcClient, getChainInfo } from "@monolythium/core-sdk";
import { rpcClientOptions } from "./http";
import { withDeadline } from "./with-deadline";
import { probePeer, type Peer, type ProbeResult } from "./peers";
import { activeFleet } from "./fleet";
import { probeOperator, unreachableVerdict, NETWORK_SLUG, type OperatorVerdict } from "./chain-trust";
import { runtimeBlockFromProvenance, type RuntimeBlock } from "./about";
import type { OperatorRiskInput } from "./operator-risk";

/** Per-operator wall-clock deadline (ms). Every sub-probe races it; on expiry the
 *  missing results fold to their honest absences. Probes run concurrently across
 *  AND within operators, so the round is bounded at ~this regardless of the SDK
 *  client's internal timeouts. */
export const OPERATOR_INSPECT_DEADLINE_MS = 6_000;

export interface OperatorInspectRow {
  peer: Peer;
  verdict: OperatorVerdict;
  probe: ProbeResult;
  /** lyth_operatorCapabilities surfaces, or null when the probe returned nothing. */
  capabilities: Record<string, { status: string }> | null;
  /** Indexer ingested height, or null when disabled/absent. */
  indexerCurrentHeight: number | null;
  /** Indexer observed chain head, or null. */
  indexerLatestHeight: number | null;
}

/** Injectable I/O for tests; production uses the real probes. */
export interface InspectDeps {
  peers: () => Peer[];
  verdict: (url: string, pinChain: number, pinGenesis: string) => Promise<OperatorVerdict>;
  reach: (url: string) => Promise<ProbeResult>;
  caps: (url: string) => Promise<Record<string, { status: string }> | null>;
  indexer: (url: string) => Promise<{ current: number | null; latest: number | null }>;
  deadlineMs: number;
}

function timedOutProbe(url: string, ms: number): ProbeResult {
  return { url, reachable: false, latencyMs: ms, chainIdOk: false, error: "timeout" };
}

async function readCapabilities(url: string): Promise<Record<string, { status: string }> | null> {
  try {
    const res = await new RpcClient(url, rpcClientOptions()).lythOperatorCapabilities();
    return res.surfaces as Record<string, { status: string }>;
  } catch {
    return null;
  }
}

/** Per-operator runtime provenance via a transient client (lazy, on expand —
 *  never part of the round). Null on any failure — the caller renders nothing. */
export async function readOperatorProvenance(url: string): Promise<RuntimeBlock | null> {
  try {
    return runtimeBlockFromProvenance(
      await new RpcClient(url, rpcClientOptions()).lythRuntimeProvenance(),
    );
  } catch {
    return null;
  }
}

async function readIndexer(url: string): Promise<{ current: number | null; latest: number | null }> {
  try {
    const res = await new RpcClient(url, rpcClientOptions()).lythIndexerStatus();
    if (res === null) return { current: null, latest: null };
    return {
      current: Number(res.currentHeight),
      latest: res.latestHeight != null ? Number(res.latestHeight) : null,
    };
  } catch {
    return { current: null, latest: null };
  }
}

function defaults(over: Partial<InspectDeps>): InspectDeps {
  return {
    peers: over.peers ?? activeFleet,
    verdict: over.verdict ?? probeOperator,
    reach: over.reach ?? ((url) => probePeer(url)),
    caps: over.caps ?? readCapabilities,
    indexer: over.indexer ?? readIndexer,
    deadlineMs: over.deadlineMs ?? OPERATOR_INSPECT_DEADLINE_MS,
  };
}

/** Run one inspection round over the whole catalogue. Fully parallel; each
 *  operator's four sub-probes race the deadline and fold to honest absences. */
export async function inspectOperators(over: Partial<InspectDeps> = {}): Promise<OperatorInspectRow[]> {
  const d = defaults(over);
  const info = getChainInfo(NETWORK_SLUG);
  const pinChain = info.chain_id;
  const pinGenesis = info.genesis_hash;

  return Promise.all(
    d.peers().map(async (peer) => {
      const url = peer.url;
      const [verdict, probe, capabilities, idx] = await Promise.all([
        withDeadline(d.verdict(url, pinChain, pinGenesis), d.deadlineMs, unreachableVerdict(url)),
        withDeadline(d.reach(url), d.deadlineMs, timedOutProbe(url, d.deadlineMs)),
        withDeadline(d.caps(url), d.deadlineMs, null),
        withDeadline(d.indexer(url), d.deadlineMs, { current: null, latest: null }),
      ]);
      return {
        peer,
        verdict,
        probe,
        capabilities,
        indexerCurrentHeight: idx.current,
        indexerLatestHeight: idx.latest,
      };
    }),
  );
}

export interface InspectSummary {
  total: number;
  live: number;
  verified: number;
}

/** Fleet totals (pure). `live` = reachable AND on the right chain; `verified` =
 *  a trusted genesis. A quarantined-but-reachable operator counts live, not
 *  verified. */
export function inspectSummary(rows: readonly OperatorInspectRow[]): InspectSummary {
  return {
    total: rows.length,
    live: rows.filter((r) => r.probe.reachable && r.probe.chainIdOk).length,
    verified: rows.filter((r) => r.verdict.trusted).length,
  };
}

/** Display order (pure): verified+reachable first by latency ascending (ties keep
 *  catalogue order), then every degraded row in catalogue order. Never affects
 *  which endpoint the wallet dials. */
export function sortInspectRows(rows: readonly OperatorInspectRow[]): OperatorInspectRow[] {
  const catalogue = new Map(rows.map((r, i) => [r.peer.url, i]));
  const top = (r: OperatorInspectRow) => r.verdict.trusted && r.probe.reachable;
  const order = (r: OperatorInspectRow) => catalogue.get(r.peer.url) ?? 0;
  return [...rows].sort((a, b) => {
    const at = top(a);
    const bt = top(b);
    if (at !== bt) return at ? -1 : 1;
    if (at && bt && a.probe.latencyMs !== b.probe.latencyMs) {
      return a.probe.latencyMs - b.probe.latencyMs;
    }
    return order(a) - order(b);
  });
}

export interface CapabilityAggregate {
  surface: string;
  /** Operators reporting this surface as available. */
  available: number;
  /** Operators whose capabilities probe returned non-null (the denominator —
   *  a pre-uplift operator that answered nothing never drags it). */
  total: number;
}

/** Fleet-wide capability aggregation (pure). Lists only surfaces seen on at
 *  least one operator; the denominator is the count of operators that reported
 *  any capabilities at all. */
export function aggregateCapabilities(rows: readonly OperatorInspectRow[]): CapabilityAggregate[] {
  const reporting = rows.filter((r) => r.capabilities !== null);
  const total = reporting.length;
  const surfaces = new Set<string>();
  for (const r of reporting) for (const s of Object.keys(r.capabilities!)) surfaces.add(s);
  return [...surfaces].sort().map((surface) => ({
    surface,
    available: reporting.filter((r) => r.capabilities![surface]?.status === "available").length,
    total,
  }));
}

/** Adapt an inspect row to the risk classifier's input (pure). `pendingChange`
 *  is always null this phase (no typed SDK reader). */
export function toRiskInput(row: OperatorInspectRow): OperatorRiskInput {
  return {
    ok: row.probe.reachable,
    quarantined: row.verdict.quarantined,
    trustedGenesis: row.verdict.trusted,
    capabilities: row.capabilities,
    indexerHeight: row.indexerCurrentHeight,
    indexerLatest: row.indexerLatestHeight,
    latencyMs: row.probe.reachable ? row.probe.latencyMs : null,
    pendingChange: null,
  };
}
