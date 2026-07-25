// The network page's payloads, said in sentences.
//
// These three values used to render as a bare `JSON.stringify` — legible to
// whoever wrote the schema and to nobody else. A status page whose entire
// subject is the state of something external owes the reader plain words.
//
// Two rules hold throughout, and they are the same rule twice:
//
//   • Each renderer states only what its payload actually carries. A field the
//     chain did not send shortens the sentence; it is never filled in.
//   • An unreadable payload returns null, and the surface omits the line. It
//     does not print "unknown" dressed as a value.
//
// The chain arrives as `unknown` here on purpose — these are the boundary, so
// every field is checked rather than asserted. Pure: no client, no DOM.

/** Grouping that matches the rest of the wallet's block numbers. */
function num(n: number): string {
  return n.toLocaleString("en-US");
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

// ── Indexer ─────────────────────────────────────────────────────────────────

export interface IndexerFacts {
  backend: string | null;
  currentHeight: number | null;
  latestHeight: number | null;
  schemaVersion: number | null;
  earliestRetained: number | null;
  retentionBlocks: number | null;
  archive: boolean;
}

export function parseIndexerStatus(raw: unknown): IndexerFacts | null {
  const r = asRecord(raw);
  if (!r) return null;
  const backend = typeof r.backend === "string" ? r.backend : null;
  const currentHeight = readNumber(r, "currentHeight");
  const latestHeight = readNumber(r, "latestHeight");
  // Nothing readable at all ⇒ not an indexer payload. Better to omit the line
  // than to render a shell of one.
  if (backend === null && currentHeight === null && latestHeight === null) return null;
  const retention = asRecord(r.retention);
  return {
    backend,
    currentHeight,
    latestHeight,
    schemaVersion: readNumber(r, "schemaVersion"),
    earliestRetained: retention ? readNumber(retention, "earliestRetained") : null,
    retentionBlocks: retention ? readNumber(retention, "retentionBlocks") : null,
    archive: retention?.archive === true,
  };
}

/**
 * Answers "is my history current?".
 *
 * The lag is given in BLOCKS rather than as a bare "behind", because "behind"
 * alone does not tell anyone whether to worry — three blocks and three thousand
 * are different facts and want different reactions.
 */
export function describeIndexerStatus(facts: IndexerFacts | null): string | null {
  if (!facts) return null;
  const { currentHeight, latestHeight } = facts;
  if (currentHeight === null || latestHeight === null) {
    return currentHeight !== null ? `Indexed to block ${num(currentHeight)}.` : null;
  }
  const behind = latestHeight - currentHeight;
  if (behind <= 0) return `In sync at block ${num(currentHeight)}.`;
  return `${num(behind)} blocks behind — indexed to ${num(currentHeight)} of ${num(latestHeight)}.`;
}

// ── DAG sync ────────────────────────────────────────────────────────────────

export interface SyncFacts {
  state: string | null;
  lag: number | null;
  localRound: number | null;
  peerMaxRound: number | null;
}

export function parseSyncStatus(raw: unknown): SyncFacts | null {
  const r = asRecord(raw);
  if (!r) return null;
  const state = typeof r.state === "string" ? r.state : null;
  const lag = readNumber(r, "lag");
  const localRound = readNumber(r, "localRound");
  if (state === null && lag === null && localRound === null) return null;
  return { state, lag, localRound, peerMaxRound: readNumber(r, "peerMaxRound") };
}

export function describeSyncStatus(facts: SyncFacts | null): string | null {
  if (!facts) return null;
  const parts: string[] = [];
  if (facts.state !== null) parts.push(facts.state);
  if (facts.lag !== null) {
    parts.push(facts.lag === 0 ? "no lag" : `${num(facts.lag)} round${facts.lag === 1 ? "" : "s"} behind`);
  }
  if (facts.localRound !== null) parts.push(`at round ${num(facts.localRound)}`);
  return parts.length > 0 ? `${parts.join(", ")}.` : null;
}

// ── Mempool ─────────────────────────────────────────────────────────────────

export interface MempoolFacts {
  pending: number | null;
  ready: number | null;
  mailboxDepth: number | null;
}

/**
 * Reads the mempool block.
 *
 * Sourced from `lyth_chainStats`, not `lyth_mempoolStatus`: the dedicated method
 * is declined by the default operator, while chainStats carries the same three
 * fields and is served. Same numbers, one fewer way to fail.
 */
export function parseMempool(raw: unknown): MempoolFacts | null {
  const r = asRecord(raw);
  if (!r) return null;
  const pending = readNumber(r, "pending");
  const ready = readNumber(r, "ready");
  const mailboxDepth = readNumber(r, "mailboxDepth");
  if (pending === null && ready === null && mailboxDepth === null) return null;
  return { pending, ready, mailboxDepth };
}

export function describeMempool(facts: MempoolFacts | null): string | null {
  if (!facts) return null;
  const parts: string[] = [];
  if (facts.pending !== null) parts.push(`${num(facts.pending)} pending`);
  if (facts.ready !== null) parts.push(`${num(facts.ready)} ready`);
  return parts.length > 0 ? `${parts.join(", ")}.` : null;
}
