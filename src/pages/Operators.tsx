// Operators — the user-facing inspection surface over the landed chain-health
// engine. Every row is a real probe result or an honest absence; the screen
// works while the wallet is fail-closed (all reads use transient clients). Dev
// mode reveals raw telemetry rows; the plain status pill + trust verdict stay
// visible to everyone. This phase renders the summary, active strip, and the
// operator rows; the connect flow, legend, telemetry, consensus, and chain-
// identity cards land in later commits.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDeveloperMode } from "../sdk/developer-mode";
import { RiskBadgeChip } from "../components/RiskBadgeChip";
import { currentEndpoint, subscribeEndpoint } from "../sdk/client";
import { listPeers } from "../sdk/peers";
import { classifyOperatorRisk } from "../sdk/operator-risk";
import {
  inspectOperators,
  inspectSummary,
  sortInspectRows,
  toRiskInput,
  type OperatorInspectRow,
} from "../sdk/operator-inspect";

const hostOf = (url: string) => url.replace(/^https?:\/\//, "");

export function Operators() {
  const devMode = useDeveloperMode();
  const [rows, setRows] = useState<OperatorInspectRow[] | null>(null);
  const [probing, setProbing] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeEndpoint, setActiveEndpoint] = useState(() => currentEndpoint());
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
  const activeInCatalogue = listPeers().find((p) => p.url === activeEndpoint) ?? null;

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

      <div className="w-op-strip">
        <div className="w-op-strip__head">
          {activeInCatalogue ? (
            <>Connected to {activeInCatalogue.label} · <span className="w-op-strip__host">{hostOf(activeEndpoint)}</span></>
          ) : (
            <>Connected to <span className="w-op-strip__host">{hostOf(activeEndpoint)}</span></>
          )}
        </div>
        <div className="row-help" style={{ marginTop: 4 }}>
          {activeInCatalogue
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
                expanded={expanded === row.peer.url}
                onToggle={() =>
                  setExpanded((cur) => (cur === row.peer.url ? null : row.peer.url))
                }
              />
            ))
          )}
        </div>
      </div>
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

function OperatorRow({
  row,
  devMode,
  expanded,
  onToggle,
}: {
  row: OperatorInspectRow;
  devMode: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { peer, verdict, probe } = row;
  const bad = !verdict.trusted || !probe.reachable;
  const pill = statusPill(row);
  const chips = classifyOperatorRisk(toRiskInput(row));

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
      </div>
    </div>
  );
}

function OperatorDetail({ row, devMode }: { row: OperatorInspectRow; devMode: boolean }) {
  const { verdict, probe, capabilities } = row;
  const chainTitle = devMode
    ? verdict.observedGenesis ?? "operator did not return chain-genesis metadata"
    : undefined;
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
