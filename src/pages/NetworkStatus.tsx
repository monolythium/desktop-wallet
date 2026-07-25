// Network status — is the chain alright?
//
// The page has one job and answers it in three sentences before showing
// anything technical: is the network up, is it advancing, is my history
// current. That ordering is the design. A row of big-number tiles is the
// obvious shape for a status page and the wrong one here, because two of the
// three questions are not numbers — "is it advancing" is not answered by a
// height, and "is my history current" is not answered by a struct. So the top
// of the page is prose, and the telemetry lives below it, gated.
//
// TWO THINGS THIS PAGE DELIBERATELY DOES NOT DO.
//
// It does not describe a second connection vocabulary. The reachability line
// borrows `chainHealthPresentation`, the same source the status chip and the
// degraded banner use, so the three can never come to disagree.
//
// It does not explain what a degraded state MEANS. The banner owns that, and a
// page that also explained it would eventually contradict it. This page states
// what is true of the network; the banner states what it means for the user.
//
// NOT SHOWN, deliberately: the age of the last block. `chainStats.latestTimestamp`
// exists and looks like the obvious way to answer "is it advancing", but it is
// not wall-clock comparable — sampled against the deployed chain it advanced
// four seconds per twelve seconds of real time while sitting ~15 days behind the
// local clock. Rendering "last block N ago" from it would have printed a fortnight
// for a chain producing blocks every few seconds. Advancement is taken from the
// chain-health state instead, which observes progress directly.

import { useEffect, useState } from "react";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { RefreshButton } from "../components/RefreshButton";
import { useChainHealthView } from "../sdk/ChainHealthProvider";
import { chainAdvancementLine, chainHealthPresentation } from "../sdk/chain-health-presentation";
import { useDeveloperMode } from "../sdk/developer-mode";
import { formatOutcome, loadLiveNetworkStatus, type LiveNetworkStatus } from "../sdk/live";
import { loadRecentNetworkEvents } from "../sdk/news";
import {
  describeIndexerStatus,
  describeMempool,
  describeSyncStatus,
  parseIndexerStatus,
  parseMempool,
  parseSyncStatus,
} from "../sdk/network-prose";
import type { NativeReceiptEvent } from "@monolythium/core-sdk";

const num = (n: number | bigint) => Number(n).toLocaleString("en-US");

export function NetworkStatus() {
  const devMode = useDeveloperMode();
  const { health } = useChainHealthView();
  const [status, setStatus] = useState<LiveNetworkStatus | null>(null);
  const [events, setEvents] = useState<NativeReceiptEvent[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setEventsError(null);
    try {
      const [network, eventPage] = await Promise.all([
        loadLiveNetworkStatus(),
        loadRecentNetworkEvents().catch((cause: unknown) => {
          setEventsError((cause as Error)?.message ?? String(cause));
          return null;
        }),
      ]);
      setStatus(network);
      if (eventPage) setEvents(eventPage.events);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const presentation = chainHealthPresentation(health);
  // From the shared vocabulary, not written here — see G2 in the report and the
  // note on `chainAdvancementLine`.
  const advancing = chainAdvancementLine(health.kind);
  const stats = status?.chainStats.ok ? status.chainStats.value : null;
  const indexer = parseIndexerStatus(status?.indexerStatus.ok ? status.indexerStatus.value : null);
  const sync = parseSyncStatus(status?.syncStatus.ok ? status.syncStatus.value : null);
  // From chainStats, not the dedicated method: this operator declines that one
  // and chainStats carries the same three fields.
  const mempool = parseMempool((stats as { mempool?: unknown } | null)?.mempool ?? null);
  const precompiles = status?.activePrecompiles.ok ? status.activePrecompiles.value ?? [] : [];
  const height = status?.blockHeight.ok ? status.blockHeight.value : null;

  return (
    <div className="w-page">
      <div className="w-page__header">
        <h1>Network status</h1>
        <div className="sub">Whether the chain is reachable, advancing, and indexed.</div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Right now</h3>
          <span className="w-card__head__spacer" />
          <RefreshButton busy={busy} onClick={refresh} />
        </div>
        <div className="w-card__body">
          {/* 1 — is it up? The chip's own words, not a second set. */}
          <div className="w-net-answer" data-testid="network-reachable">
            <span className={`w-net-answer__dot ${presentation.dotClass}`} aria-hidden="true" />
            <span className="w-net-answer__label">{presentation.label}</span>
          </div>

          {/* 2 — is it advancing? The height is a fact; whether it is MOVING
              comes from the health state, which observes progress across ticks.
              No block-age figure: see the note at the top of this file. */}
          <div className="row-help" data-testid="network-advancing">
            {height !== null
              ? `Latest block ${num(height as bigint)}.`
              : "The wallet has not read a block height yet."}
            {advancing !== null ? ` ${advancing}` : null}
          </div>

          {/* 3 — is my history current? */}
          <div className="row-help" data-testid="network-history">
            {describeIndexerStatus(indexer) ?? "The wallet could not read the indexer's position."}
          </div>
        </div>
      </div>

      <div className="w-card">
        <div className="w-card__head">
          <h3>Network events</h3>
          <span className="w-live-pill">live</span>
        </div>
        <div className="w-card__body">
          {eventsError ? <div className="w-live-error">{eventsError}</div> : null}
          {events === null && !eventsError ? (
            <div className="row-help">Loading indexed native events…</div>
          ) : null}
          {events?.length === 0 ? (
            <div className="row-help">No indexed native events in the recent block window.</div>
          ) : null}
          {events && events.length > 0 ? (
            <div className="w-live-list">
              {events.map((event) => (
                <div
                  className="w-live-row"
                  key={`${event.blockHeight}:${event.txIndex}:${event.logIndex}`}
                >
                  <div>
                    <div className="row-label">{eventTitle(event)}</div>
                    <div className="row-help mono">
                      block {String(event.blockHeight)} · tx {event.txIndex} · log {event.logIndex}
                    </div>
                  </div>
                  <span className="w-live-pill is-muted">{event.address}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Everything below is developer material: endpoints, hashes, schema
          versions and the precompile catalogue. Gated, collapsed, and using the
          disclosure the other surfaces share. */}
      {devMode ? (
        <>
          <CollapsibleSection title="Connection" value={status?.endpoint}>
            <Row k="Endpoint" v={status?.endpoint ?? "—"} mono />
            <Row k="Chain id" v={status ? formatOutcome(status.chainId, String) : "loading"} />
            <Row k="Peers" v={status ? formatOutcome(status.peerCount, String) : "loading"} />
            <Row k="Listening" v={status ? formatOutcome(status.listening, String) : "loading"} />
            <Row
              k="Client"
              v={status ? formatOutcome(status.clientVersion, String) : "loading"}
              mono
            />
            <Row
              k="Genesis"
              v={stats?.genesisHash ?? (status ? formatOutcome(status.chainStats, () => "—") : "loading")}
              mono
            />
            {stats?.clusters?.total !== undefined ? (
              <Row k="Clusters" v={num(stats.clusters.total)} />
            ) : null}
          </CollapsibleSection>

          <CollapsibleSection
            title="Consensus & sync"
            value={sync?.state ?? undefined}
          >
            <Row k="Round" v={status ? formatOutcome(status.currentRound, (r) => num(r.height)) : "loading"} />
            <div className="w-kv">
              <span className="k">DAG sync</span>
              <span className="v">{describeSyncStatus(sync) ?? "—"}</span>
            </div>
            <div className="w-kv" data-testid="network-mempool">
              <span className="k">Mempool</span>
              <span className="v">{describeMempool(mempool) ?? "—"}</span>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Indexer" value={indexer?.backend ?? undefined}>
            <div className="w-kv">
              <span className="k">Position</span>
              <span className="v">{describeIndexerStatus(indexer) ?? "—"}</span>
            </div>
            {indexer?.schemaVersion !== null && indexer?.schemaVersion !== undefined ? (
              <Row k="Schema" v={String(indexer.schemaVersion)} />
            ) : null}
            {indexer?.retentionBlocks !== null && indexer?.retentionBlocks !== undefined ? (
              <div className="w-kv">
                <span className="k">Retention</span>
                <span className="v">
                  {`${num(indexer.retentionBlocks)} blocks from ${num(indexer.earliestRetained ?? 0)}`}
                  {indexer.archive ? " · archive" : ""}
                </span>
              </div>
            ) : null}
          </CollapsibleSection>

          {/* All of them. The count in the heading is this list's length, so the
              two cannot disagree — the previous card read the whole catalogue,
              reported its true size, and then rendered the first eight. */}
          <CollapsibleSection title="Precompiles" value={`${precompiles.length}`}>
            <div className="w-live-list" data-testid="precompile-rows">
              {precompiles.map((p) => (
                <div className="w-live-row" key={`${p.address}:${p.name}`}>
                  <div>
                    <div className="row-label">{p.name}</div>
                    <div className="row-help mono">{p.address}</div>
                  </div>
                  <span className={`w-live-pill ${p.enabled ? "" : "is-muted"}`}>
                    {p.enabled ? "enabled" : p.gateable ? "gated" : "disabled"}
                  </span>
                </div>
              ))}
            </div>
            {status?.activePrecompiles.ok === false ? (
              <div className="w-live-error">
                precompiles: {formatOutcome(status.activePrecompiles, () => "")}
              </div>
            ) : null}
          </CollapsibleSection>
        </>
      ) : null}
    </div>
  );
}

/** An event's name, from its decoded payload, falling back to the raw topic —
 *  never a fabricated label. Moved here with the events section. */
function eventTitle(event: NativeReceiptEvent): string {
  const decoded = parseDecoded(event);
  const name = decoded?.eventName ?? decoded?.name ?? decoded?.kind;
  return typeof name === "string" && name.length > 0 ? name : event.eventTopic;
}

function parseDecoded(event: NativeReceiptEvent): Record<string, unknown> | null {
  if (event.decoded && typeof event.decoded === "object") {
    return event.decoded as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(event.decodedJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="w-kv">
      <span className="k">{k}</span>
      <span className={`v${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}
