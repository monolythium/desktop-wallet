// Indexer lag / schema drift, and the quiet defaults that keep it from crying
// wolf.
//
// This surface can only ever be advisory: it tells the user the feed may be
// incomplete. So EVERY failure mode — method missing, indexer disabled,
// malformed response, transport error — resolves to "no banner" rather than to
// an alarm. A wallet that warned about its own inability to ask would train
// users to ignore the warning that matters.

import { getProvider } from "./client";

/** The indexer schema this build understands. Bumped deliberately with a
 *  release; tests assert against the symbol, never a literal. */
export const WALLET_KNOWN_INDEXER_SCHEMA_VERSION = 7;

/** Lag beyond this many blocks reads as stale. */
export const INDEXER_LAG_STALE_THRESHOLD = 10;

/** Poll cadence while the Activity page is mounted AND the document is visible. */
export const INDEXER_STATUS_POLL_MS = 30_000;

export interface IndexerStatusView {
  stale: boolean;
  drift: boolean;
  /** Chain-authored redirect copy, rendered verbatim — the wallet deliberately
   *  does not own that wording. */
  archiveRedirect: string | null;
  lagBlocks: number;
}

/** The quiet shape every defensive default returns. */
export const QUIET_INDEXER_STATUS: IndexerStatusView = {
  stale: false,
  drift: false,
  archiveRedirect: null,
  lagBlocks: 0,
};

function intOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * Fold a raw `lyth_indexerStatus` answer into the view.
 *
 * `latestHeight` absent → lag 0 (we cannot compute a lag, so we do not claim
 * one). Drift is STRICTLY greater than the known schema — equal is never drift.
 * Pure; a malformed input yields the quiet shape.
 */
export function indexerStatusView(raw: unknown): IndexerStatusView {
  if (!raw || typeof raw !== "object") return QUIET_INDEXER_STATUS;
  const r = raw as Record<string, unknown>;

  const currentHeight = intOrNull(r.currentHeight);
  const latestHeight = intOrNull(r.latestHeight);
  const schemaVersion = intOrNull(r.schemaVersion) ?? 0;

  const lagBlocks =
    latestHeight === null || currentHeight === null ? 0 : Math.max(0, latestHeight - currentHeight);

  const retention = r.retention;
  const redirectRaw =
    retention && typeof retention === "object"
      ? (retention as Record<string, unknown>).archiveRedirect
      : null;
  const archiveRedirect =
    typeof redirectRaw === "string" && redirectRaw.trim() !== "" ? redirectRaw.trim() : null;

  return {
    stale: lagBlocks > INDEXER_LAG_STALE_THRESHOLD,
    drift: schemaVersion > WALLET_KNOWN_INDEXER_SCHEMA_VERSION,
    archiveRedirect,
    lagBlocks,
  };
}

// ── Session method gate ─────────────────────────────────────────────────────
// A node that does not serve the method should not be asked again this session.
// Deliberately IN-MEMORY and scope-keyed: the fleet churns, and a persisted
// gate would keep a recovered indexer muted across launches.

const gatedScopes = new Set<string>();

export function isIndexerStatusGated(scopeKey: string): boolean {
  return gatedScopes.has(scopeKey);
}

export function __resetIndexerStatusGateForTest(): void {
  gatedScopes.clear();
}

/** JSON-RPC codes that mean "this node will not answer": method not found, and
 *  indexer disabled. */
function isPermanentRefusal(cause: unknown): boolean {
  const code = (cause as { code?: unknown } | null)?.code;
  if (code === -32601 || code === -32045) return true;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /-32601|-32045|method not found/i.test(message);
}

/**
 * Read the indexer's status for a scope. Never throws, never alarms.
 *
 * A permanent refusal gates the scope for the session; any later success clears
 * it, so an indexer that comes back is heard again within the same run.
 */
export async function loadIndexerStatus(scopeKey: string): Promise<IndexerStatusView> {
  if (gatedScopes.has(scopeKey)) return QUIET_INDEXER_STATUS;
  try {
    const raw = (await getProvider().rpcClient.lythIndexerStatus()) as unknown;
    if (raw === null || raw === undefined) {
      // An explicit null is an indexer-disabled answer, not a malfunction.
      gatedScopes.add(scopeKey);
      return QUIET_INDEXER_STATUS;
    }
    gatedScopes.delete(scopeKey); // recovered
    return indexerStatusView(raw);
  } catch (cause) {
    if (isPermanentRefusal(cause)) gatedScopes.add(scopeKey);
    return QUIET_INDEXER_STATUS;
  }
}

// ── Banner copy ─────────────────────────────────────────────────────────────

export type IndexerBannerClass = "stale" | "drift" | "archive";

export const INDEXER_BANNER_TEXT: Record<"stale" | "drift", string> = {
  stale: "Indexer lagging — most recent activity may be missing.",
  drift: "Wallet update available — indexer is reporting a newer schema.",
};

export const INDEXER_BANNER_DISMISS_LABEL: Record<IndexerBannerClass, string> = {
  stale: "Dismiss indexer-stale banner for this session",
  drift: "Dismiss schema-drift hint for this session",
  archive: "Dismiss archive-redirect hint for this session",
};

/** Which classes are active, in render order. Pure. */
export function activeBannerClasses(view: IndexerStatusView): IndexerBannerClass[] {
  const out: IndexerBannerClass[] = [];
  if (view.stale) out.push("stale");
  if (view.drift) out.push("drift");
  if (view.archiveRedirect !== null) out.push("archive");
  return out;
}
