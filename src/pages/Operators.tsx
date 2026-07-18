// Operators — the user-facing inspection surface over the landed chain-health
// engine. Every row is a real probe result or an honest absence; the screen
// works while the wallet is fail-closed (all reads use transient clients). Dev
// mode reveals raw telemetry rows; the plain status pill + trust verdict stay
// visible to everyone. This phase renders the summary, active strip, and the
// operator rows; the connect flow, legend, telemetry, consensus, and chain-
// identity cards land in later commits.

import { useCallback, useEffect, useRef, useState } from "react";
import { getChainInfo } from "@monolythium/core-sdk";
import { useDeveloperMode } from "../sdk/developer-mode";
import { useChainHealthView } from "../sdk/ChainHealthProvider";
import { RiskBadgeChip } from "../components/RiskBadgeChip";
import { ConnectFlowModal } from "../components/ConnectFlowModal";
import { truncMiddle } from "../components/_detailModalParts";
import { currentEndpoint, setEndpoint, subscribeEndpoint } from "../sdk/client";
import { activeFleet } from "../sdk/fleet";
import type { Route } from "../components/types";
import { fetchLiveTestnetRegistry } from "../sdk/live-registry";
import { probeOperator, NETWORK_SLUG } from "../sdk/chain-trust";
import {
  computeGenesisDrift,
  readChainIdentity,
  readSdkVersion,
} from "../sdk/about";
import {
  classifyOperatorRisk,
  operatorConnectBlockReason,
  OPERATOR_RISK_LEGEND,
  type OperatorRiskKind,
} from "../sdk/operator-risk";
import {
  aggregateCapabilities,
  inspectOperators,
  inspectSummary,
  readOperatorProvenance,
  sortInspectRows,
  toRiskInput,
  type OperatorInspectRow,
} from "../sdk/operator-inspect";
import type { RuntimeBlock } from "../sdk/about";
import {
  bpsPct,
  deriveOperatorRiskTier,
  loadOperatorRisk,
  loadSigningActivity,
  loadUpcomingDuties,
  signingPill,
} from "../sdk/operator-consensus";
import type {
  ChainInfo,
  OperatorRiskResponse,
  OperatorSigningActivityResponse,
  UpcomingDutiesResponse,
} from "@monolythium/core-sdk";

const hostOf = (url: string) => url.replace(/^https?:\/\//, "");

export function Operators({ goto }: { goto: (r: Route) => void }) {
  const devMode = useDeveloperMode();
  const health = useChainHealthView().health;
  const [rows, setRows] = useState<OperatorInspectRow[] | null>(null);
  const [probing, setProbing] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeEndpoint, setActiveEndpoint] = useState(() => currentEndpoint());
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const runId = useRef(0);

  const runRound = useCallback(() => {
    const id = ++runId.current;
    setProbing(true);
    void inspectOperators().then((result) => {
      if (id !== runId.current) return; // superseded or unmounted
      setRows(result);
      setProbing(false);
    });
  }, []);

  useEffect(() => {
    runRound();
    return () => {
      runId.current++; // invalidate any in-flight round on unmount
    };
  }, [runRound]);

  useEffect(() => subscribeEndpoint(setActiveEndpoint), []);

  const summary = rows ? inspectSummary(rows) : null;
  const sorted = rows ? sortInspectRows(rows) : [];
  // Resolve the active endpoint's label from the EFFECTIVE fleet (override-aware),
  // not the raw catalogue — a user-configured operator (custom override or custom
  // chain) is a legitimate dial target. Only a genuine build-time override
  // (VITE_MONO_RPC_URL, not in any fleet) falls through to the override copy.
  const activeInFleet = activeFleet().find((p) => p.url === activeEndpoint) ?? null;
  const activeName = activeInFleet ? activeInFleet.label : hostOf(activeEndpoint);

  // The connect flow's three gates (§12): a UI pre-probe block over the current
  // row state, then a FRESH trust probe, then — only on a trusted verdict —
  // setEndpoint. A failed probe changes nothing. The health tick keeps failing
  // over automatically afterwards; this never re-forces the selection.
  const runConnect = useCallback(async (row: OperatorInspectRow) => {
    const name = row.peer.label;
    const block = operatorConnectBlockReason(toRiskInput(row));
    if (block) {
      setConnect({ phase: "result", row, ok: false, message: `Can't connect to ${name} — ${block} Your operator was left unchanged.` });
      return;
    }
    setConnect({ phase: "checking", row });
    const info = getChainInfo(NETWORK_SLUG);
    const verdict = await probeOperator(row.peer.url, info.chain_id, info.genesis_hash);
    if (!verdict.trusted) {
      setConnect({ phase: "result", row, ok: false, message: `Couldn't connect to ${name} — it's unreachable, on a different chain, or quarantined. Your operator was left unchanged.` });
      return;
    }
    setEndpoint(row.peer.url);
    setConnect({ phase: "result", row, ok: true, message: `Connected to ${name}.` });
  }, []);

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Operators</h1>
        <div className="sub">The operators the wallet reads from, and their trust status.</div>
      </div>

      <div className="w-op-summary">
        {probing && !summary
          ? "Probing Monolythium Testnet operators…"
          : summary
            ? `${summary.total} operator(s) · ${summary.live} reachable · ${summary.verified} verified`
            : ""}
      </div>

      {health.kind === "regenesis" ? <ReGenesisExplainer /> : null}

      <div className="w-op-strip">
        <div className="w-op-strip__head">
          {activeInFleet ? (
            <>Connected to {activeInFleet.label} · <span className="w-op-strip__host">{hostOf(activeEndpoint)}</span></>
          ) : (
            <>Connected to <span className="w-op-strip__host">{hostOf(activeEndpoint)}</span></>
          )}
        </div>
        <div className="row-help" style={{ marginTop: 4 }}>
          {activeInFleet
            ? "The wallet reads from one operator at a time. If this one degrades, the health probe switches to the first trusted operator automatically on the next tick."
            : "Build-time override — not in the registry catalogue."}
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Operators</h3>
          <div className="w-card__head__spacer" />
          <button
            type="button"
            className="w-chip"
            disabled={probing}
            onClick={runRound}
          >
            {probing ? "Probing…" : "Refresh"}
          </button>
        </div>
        <div className="w-card__body">
          {sorted.length === 0 && !probing ? (
            <div className="row-help">No operators in the build catalogue.</div>
          ) : (
            sorted.map((row) => (
              <OperatorRow
                key={row.peer.url}
                row={row}
                devMode={devMode}
                inUse={row.peer.url === activeEndpoint}
                onUse={() => setConnect({ phase: "confirm", row })}
                expanded={expanded === row.peer.url}
                onToggle={() =>
                  setExpanded((cur) => (cur === row.peer.url ? null : row.peer.url))
                }
              />
            ))
          )}
        </div>
      </div>

      <RiskLegendCard rows={rows ?? []} devMode={devMode} />

      {devMode ? <ReportedAttributesCard rows={rows ?? []} /> : null}

      {devMode ? <ConsensusCards /> : null}

      <ChainIdentityCard devMode={devMode} />

      <div className="w-card">
        <div className="w-card__body">
          <button
            type="button"
            className="w-live-row"
            style={{ background: "none", border: "none", width: "100%", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
            onClick={() => goto("operator-management")}
          >
            <div className="row-label">
              Manage operators <span className="w-tag" style={{ marginLeft: 6 }}>dev</span>
            </div>
            <span className="row-help">Override the operator RPC list with your own nodes.</span>
          </button>
        </div>
      </div>

      {connect ? (
        <ConnectFlowModal
          name={connect.row.peer.label}
          phase={
            connect.phase === "result"
              ? { phase: "result", ok: connect.ok, message: connect.message }
              : { phase: connect.phase }
          }
          confirmLead={`You're on ${activeName}. `}
          onConfirm={() => void runConnect(connect.row)}
          onClose={() => setConnect(null)}
        />
      ) : null}
    </div>
  );
}

type ConnectState =
  | { phase: "confirm"; row: OperatorInspectRow }
  | { phase: "checking"; row: OperatorInspectRow }
  | { phase: "result"; row: OperatorInspectRow; ok: boolean; message: string };

/** Which rows currently exhibit each risk kind — computed from the SAME
 *  classifier that renders the row chips, so the buckets can't drift. */
function affectedByKind(rows: readonly OperatorInspectRow[]): Map<OperatorRiskKind, OperatorInspectRow[]> {
  const map = new Map<OperatorRiskKind, OperatorInspectRow[]>();
  for (const row of rows) {
    const kinds = new Set(classifyOperatorRisk(toRiskInput(row)).map((b) => b.kind));
    for (const kind of kinds) {
      const list = map.get(kind) ?? [];
      list.push(row);
      map.set(kind, list);
    }
  }
  return map;
}

function RiskLegendCard({ rows, devMode }: { rows: readonly OperatorInspectRow[]; devMode: boolean }) {
  const [open, setOpen] = useState<OperatorRiskKind | null>(null);
  const affected = affectedByKind(rows);
  const entries = OPERATOR_RISK_LEGEND.filter((e) => devMode || !e.devOnly);

  return (
    <div className="w-card">
      <div className="w-card__head"><h3>Risk legend</h3></div>
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 12 }}>
          Each chip on an operator row decodes a signal the wallet collected from its probe
          round-trip. Most are advisory — the wallet's health failover already routes around
          offline / untrusted operators.
        </div>
        {entries.map((entry) => {
          const hit = affected.get(entry.kind) ?? [];
          const isOpen = open === entry.kind;
          return (
            <div key={entry.kind} className="w-legend-entry">
              <div className="w-legend-entry__head">
                <span className="w-legend-entry__label">{entry.label}</span>
                {hit.length > 0 ? (
                  <button
                    type="button"
                    className="w-legend-affected"
                    onClick={() => setOpen(isOpen ? null : entry.kind)}
                  >
                    {hit.length} affected
                  </button>
                ) : null}
              </div>
              <div className="row-help" style={{ marginTop: 2 }}>{entry.body}</div>
              {isOpen ? (
                <div className="w-legend-list">
                  {hit.map((row) => (
                    <div key={row.peer.url} className="w-legend-list__row">
                      <span className="w-op-row__name">{row.peer.label}</span>
                      <span className="w-op-row__region">
                        {[row.peer.region, devMode ? hostOf(row.peer.url) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Shown at the top only while the health machine reports re-genesis. All-user
 *  copy; there is deliberately no "trust it anyway" affordance. */
function ReGenesisExplainer() {
  return (
    <div className="w-card" style={{ borderColor: "var(--err)" }}>
      <div className="w-card__head"><h3>Network re-genesis</h3></div>
      <div className="w-card__body">
        <div className="row-help">
          Every operator is on chain ID 69420 but reports a different genesis than this build
          expects. The wallet has paused balances and signing — trusting an unverified chain
          automatically would defeat its genesis check. Your keys are unaffected. The wallet
          reconnects automatically if the operators return to the pinned genesis; if the network
          re-genesised, a wallet update pins the new one.
        </div>
        <div className="row-help" style={{ marginTop: 8, fontStyle: "italic" }}>
          Public Monolythium testnet. Testnet state may reset without notice; do not store value on
          this network.
        </div>
      </div>
    </div>
  );
}

/** Genesis pin display + registry-drift banner (§11). The pinned value is read
 *  through getChainInfo (the symbol), never a hash literal, so a future re-pin
 *  auto-tracks. Drift detection reuses Phase 01's computeGenesisDrift — one
 *  derivation, two surfaces. */
function ChainIdentityCard({ devMode }: { devMode: boolean }) {
  const chain = readChainIdentity();
  const info = getChainInfo(NETWORK_SLUG);
  const sdkVersion = readSdkVersion();
  const [live, setLive] = useState<ChainInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLiveTestnetRegistry().then((r) => !cancelled && setLive(r));
    return () => {
      cancelled = true;
    };
  }, []);
  const drift = computeGenesisDrift(chain, live);
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Chain identity</h3>
        <span className="w-live-pill is-muted">registry</span>
      </div>
      <div className="w-card__body">
        <DetailRow k="Network">{info.display_name ?? "testnet-69420"}</DetailRow>
        <DetailRow k="Chain ID">{String(chain.chainId)}</DetailRow>
        <DetailRow k="Pinned genesis">
          <span title={chain.genesisHash}>{truncMiddle(chain.genesisHash, 10, 8)}</span>
        </DetailRow>
        {devMode ? (
          <>
            <div className="w-genesis-full">
              <div className="row-help" style={{ marginBottom: 4 }}>Pinned genesis (full)</div>
              <code className="w-genesis-full__hash">{chain.genesisHash}</code>
            </div>
            <DetailRow k="Registry genesis (live)">
              {live ? truncMiddle(live.genesis_hash, 10, 8) : "registry unreachable"}
            </DetailRow>
            <DetailRow k="Binary sha">{live ? live.binary_sha : "registry unreachable"}</DetailRow>
            <DetailRow k="SDK version">{sdkVersion ? `v${sdkVersion}` : "—"}</DetailRow>
          </>
        ) : null}
        {drift ? (
          <div className="w-drift-banner" role="status" title={drift.liveGenesisHash} style={{ marginTop: 12 }}>
            The live chain registry reports genesis {truncMiddle(drift.liveGenesisHash, 10, 8)} —
            different from this build's pin. The network may have re-genesised; this build keeps
            trusting its pinned genesis and will pause reads if the fleet no longer matches it.
            Update the wallet when a new release is available.
          </div>
        ) : null}
        <div className="row-help" style={{ marginTop: 12 }}>
          The wallet's pinned trust anchors stay compile-time; this card is informational.
        </div>
      </div>
    </div>
  );
}

/** Fleet-wide capability aggregate (dev-gated). Display-only telemetry —
 *  nothing in the dial/trust path keys on capabilities. */
function ReportedAttributesCard({ rows }: { rows: readonly OperatorInspectRow[] }) {
  const agg = aggregateCapabilities(rows);
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Reported attributes</h3>
        <div className="w-card__head__spacer" />
        <span className="w-live-pill is-muted">{agg.length} surfaces</span>
      </div>
      <div className="w-card__body">
        <div className="row-help" style={{ marginBottom: 10 }}>
          Capability surfaces operators report via <code>lyth_operatorCapabilities</code> — e.g.
          cluster_directory, cluster_status, indexer_history. The count is how many operators
          currently serve each surface.
        </div>
        {agg.length === 0 ? (
          <div className="row-help">No operator reported capability surfaces.</div>
        ) : (
          agg.map((s) => {
            const color =
              s.available === s.total ? "var(--ok)" : s.available === 0 ? "var(--fg-500)" : "var(--fg-300)";
            return (
              <div key={s.surface} className="w-op-detail__row">
                <span className="w-op-detail__k">{s.surface}</span>
                <span className="w-op-detail__v" style={{ color }}>{s.available}/{s.total}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** The three developer-gated consensus cards (§10). Each reads through the
 *  trusted provider and HIDES on any failure — while the wallet is fail-closed
 *  they simply do not load. Keyed on the consensus authority slot, not a row. */
function ConsensusCards() {
  const [signing, setSigning] = useState<OperatorSigningActivityResponse | null>(null);
  const [risk, setRisk] = useState<OperatorRiskResponse | null>(null);
  const [duties, setDuties] = useState<UpcomingDutiesResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadSigningActivity().then((r) => !cancelled && setSigning(r));
    void loadOperatorRisk().then((r) => !cancelled && setRisk(r));
    void loadUpcomingDuties().then((r) => !cancelled && setDuties(r));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <>
      {signing ? <SigningCard data={signing} /> : null}
      {risk ? <AuthorityRiskCard data={risk} /> : null}
      {duties ? <UpcomingDutiesCard data={duties} /> : null}
    </>
  );
}

function ConsensusPillView({ pill }: { pill: { label: string; color: string } }) {
  return (
    <span className="w-op-pill" style={{ color: pill.color }}>
      <span className="w-op-pill__dot" style={{ background: pill.color }} />
      {pill.label}
    </span>
  );
}

function SigningCard({ data }: { data: OperatorSigningActivityResponse }) {
  const highest = data.entries.length
    ? data.entries.reduce((a, b) => (b.round > a.round ? b : a))
    : null;
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Chain signing — authority {data.authorityIndex} · round {String(data.currentRound)}</h3>
        <div className="w-card__head__spacer" />
        <span className="w-live-pill is-muted">{data.entries.length}/{data.limit}</span>
      </div>
      <div className="w-card__body">
        {highest ? <ConsensusPillView pill={signingPill(highest.status)} /> : <div className="row-help">No signing history.</div>}
      </div>
    </div>
  );
}

function AuthorityRiskCard({ data }: { data: OperatorRiskResponse }) {
  const tier = deriveOperatorRiskTier(data);
  const badge =
    tier === "ok" ? { label: "Healthy", color: "var(--ok)" }
    : tier === "warn" ? { label: "Near threshold", color: "var(--warn)" }
    : { label: "At risk", color: "var(--err)" };
  const jail = data.jailStatus;
  const jailLine =
    "jailed" in jail
      ? jail.tombstoned
        ? "Tombstoned — equivocation slash, permanently barred."
        : jail.jailed
          ? `Jailed until height ${String(jail.jailedUntilHeight)} (${String(jail.unjailCount)} prior unjails).`
          : null
      : null;
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Authority risk — authority {data.authorityIndex} · height {String(data.dataHeight)}</h3>
        <div className="w-card__head__spacer" />
        <ConsensusPillView pill={badge} />
      </div>
      <div className="w-card__body">
        <div className="row-help">
          miss {bpsPct(data.missRateBps)}% / headroom {bpsPct(data.remainingHeadroomBps)}% (slash {data.thresholdBps / 100}%)
        </div>
        {jailLine ? <div className="row-help" style={{ color: "var(--err)", marginTop: 4 }}>{jailLine}</div> : null}
        {data.reasons.length > 0 ? <div className="row-help" style={{ marginTop: 4 }}>Reasons: {data.reasons.join(", ")}</div> : null}
        <div className="row-help" style={{ marginTop: 4 }}>
          Sampled over {data.windowRounds} rounds · {data.observedRounds} observed
        </div>
      </div>
    </div>
  );
}

function UpcomingDutiesCard({ data }: { data: UpcomingDutiesResponse }) {
  const d = data.duties;
  const keyRotation =
    "nextRound" in d.keyRotation
      ? `next round ${String(d.keyRotation.nextRound)} · epoch ${String(d.keyRotation.epochLengthRounds)} rounds`
      : `not scheduled: ${d.keyRotation.reason}`;
  return (
    <div className="w-card">
      <div className="w-card__head">
        <h3>Upcoming duties — authority {data.authorityIndex} · round {String(data.currentRound)}</h3>
      </div>
      <div className="w-card__body">
        <DutyRow k="Attestation" v={`rounds ${String(d.attestation.startRound)}–${String(d.attestation.endRound)} · ${d.attestation.kind}`} scheduled />
        <DutyRow k="Key rotation" v={keyRotation} scheduled={"nextRound" in d.keyRotation} />
        <DutyRow k="Block production" v={d.blockProduction.reason} />
        <DutyRow k="Sync" v={d.sync.reason} />
      </div>
    </div>
  );
}

function DutyRow({ k, v, scheduled = false }: { k: string; v: string; scheduled?: boolean }) {
  return (
    <div className="w-op-detail__row">
      <span className="w-op-detail__k">
        <span className="w-op-pill__dot" style={{ background: scheduled ? "var(--ok)" : "var(--fg-500)", display: "inline-block", marginRight: 6 }} />
        {k}
      </span>
      <span className="w-op-detail__v">{v}</span>
    </div>
  );
}

interface Pill {
  label: string;
  color: string;
}

/** Plain-language status pill (§5) — first match wins. */
function statusPill(row: OperatorInspectRow): Pill {
  const { verdict, probe } = row;
  if (verdict.quarantined) return { label: "Quarantined", color: "var(--warn)" };
  if (verdict.trusted && probe.reachable) return { label: `Live · ${probe.latencyMs} ms`, color: "var(--ok)" };
  if (verdict.trusted) return { label: "Live", color: "var(--ok)" };
  if (verdict.wrongChainId || verdict.genesisMismatch) return { label: "Untrusted", color: "var(--err)" };
  return { label: "Offline", color: "var(--err)" };
}

const USE_TITLE =
  "Probe this operator; if it's reachable and verified on the pinned chain, the wallet switches to it. The health probe keeps failing over automatically if it later degrades.";

function OperatorRow({
  row,
  devMode,
  inUse,
  onUse,
  expanded,
  onToggle,
}: {
  row: OperatorInspectRow;
  devMode: boolean;
  inUse: boolean;
  onUse: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { peer, verdict, probe } = row;
  const bad = !verdict.trusted || !probe.reachable;
  const pill = statusPill(row);
  const chips = classifyOperatorRisk(toRiskInput(row));
  const canUse = verdict.trusted && probe.reachable && !inUse;

  const devSegments: string[] = [hostOf(peer.url)];
  if (probe.reachable) {
    devSegments.push(`${probe.latencyMs}ms`);
    if (probe.blockHeight !== undefined) devSegments.push(`#${probe.blockHeight}`);
    if (row.indexerCurrentHeight !== null) devSegments.push(`idx #${row.indexerCurrentHeight}`);
  } else if (probe.error) {
    devSegments.push(probe.error);
  }

  return (
    <div>
      <div className="w-op-row" onClick={onToggle} role="button" tabIndex={0}>
        <span className={`w-op-row__dot ${bad ? "w-op-row__dot--bad" : "w-op-row__dot--ok"}`} />
        <div className="w-op-row__main">
          <div>
            <span className="w-op-row__name">{peer.label}</span>
            {peer.region ? <span className="w-op-row__region">{peer.region}</span> : null}
          </div>
          <div className="w-op-pill" style={{ color: pill.color, marginTop: 2 }}>
            <span className="w-op-pill__dot" style={{ background: pill.color }} />
            {pill.label}
          </div>
          {chips.length > 0 ? (
            <div className="w-op-row__chips">
              {chips.map((c) => (
                <RiskBadgeChip key={c.kind} label={c.label} tooltip={c.tooltip} severity={c.severity} />
              ))}
            </div>
          ) : null}
          {devMode ? (
            <div className="w-op-row__dev" title={peer.url}>{devSegments.join(" · ")}</div>
          ) : null}
          {expanded ? <OperatorDetail row={row} devMode={devMode} /> : null}
        </div>
        <div className="w-op-row__action" onClick={(e) => e.stopPropagation()}>
          {inUse ? (
            <span style={{ color: "var(--ok)", fontSize: "var(--fs-11)" }}>→ In use</span>
          ) : canUse ? (
            <button type="button" className="w-chip" title={USE_TITLE} onClick={onUse}>
              Use this operator
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OperatorDetail({ row, devMode }: { row: OperatorInspectRow; devMode: boolean }) {
  const { verdict, probe, capabilities } = row;
  const chainTitle = devMode
    ? verdict.observedGenesis ?? "operator did not return chain-genesis metadata"
    : undefined;

  // Runtime provenance is fetched LAZILY on expand (one transient-client read per
  // operator), and rendered only on success — absent rows on failure, never an
  // error card.
  const [provenance, setProvenance] = useState<RuntimeBlock | null>(null);
  useEffect(() => {
    if (!devMode) return;
    let cancelled = false;
    void readOperatorProvenance(row.peer.url).then((block) => {
      if (!cancelled) setProvenance(block);
    });
    return () => {
      cancelled = true;
    };
  }, [devMode, row.peer.url]);
  return (
    <div className="w-op-detail" onClick={(e) => e.stopPropagation()}>
      <DetailRow k="Chain">
        {verdict.trusted ? (
          <span style={{ color: "var(--ok)" }} title={chainTitle}>Verified</span>
        ) : (
          <span style={{ color: "var(--err)" }} title={chainTitle}>
            Not verified — the wallet won't trust this operator
          </span>
        )}
      </DetailRow>
      {devMode ? (
        <>
          <DetailRow k="Endpoint">{row.peer.url}</DetailRow>
          <DetailRow k="Chain id">{verdict.observedChainId ?? "—"}</DetailRow>
          <DetailRow k="Latency">
            {probe.reachable ? (
              `${probe.latencyMs} ms`
            ) : (
              <span style={{ color: "var(--err)" }}>{probe.error ?? "unreachable"}</span>
            )}
          </DetailRow>
          <DetailRow k="Reported surfaces">
            {capabilities === null ? (
              "Operator did not report capability surfaces (may be a pre-uplift binary)."
            ) : (
              <span>
                {Object.entries(capabilities).map(([surface, cap]) => (
                  <span key={surface} style={{ display: "block", color: cap.status === "available" ? "var(--ok)" : "var(--w-text-3)" }}>
                    {surface} · {cap.status}
                  </span>
                ))}
                {Object.keys(capabilities).length === 0 ? "—" : null}
              </span>
            )}
          </DetailRow>
          <DetailRow k="Indexer">
            {row.indexerCurrentHeight === null
              ? "disabled"
              : row.indexerLatestHeight !== null && row.indexerLatestHeight - row.indexerCurrentHeight > 0
                ? `#${row.indexerCurrentHeight} (${row.indexerLatestHeight - row.indexerCurrentHeight} behind)`
                : `#${row.indexerCurrentHeight}`}
          </DetailRow>
          {provenance ? (
            <>
              <DetailRow k="Client">{`${provenance.clientName} v${provenance.version}`}</DetailRow>
              <DetailRow k="Commit">
                <span title={provenance.gitCommit}>
                  {provenance.gitCommit.slice(0, 12)}
                  {provenance.gitDirty ? "-dirty" : ""}
                </span>
              </DetailRow>
              {provenance.p2pProtocolVersion !== null ? (
                <DetailRow k="P2P">{`v${provenance.p2pProtocolVersion}`}</DetailRow>
              ) : null}
              {provenance.latestHeight !== null ? (
                <DetailRow k="Tip">{`#${provenance.latestHeight}`}</DetailRow>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DetailRow({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="w-op-detail__row">
      <span className="w-op-detail__k">{k}</span>
      <span className="w-op-detail__v">{children}</span>
    </div>
  );
}
