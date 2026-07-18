// Operator risk classifier — pure, no I/O.
//
// Turns the signals collected for one operator (trust verdict + reachability +
// capabilities + indexer + latency) into the risk chips shown on its row, and
// backs the legend card and the connect-flow pre-probe block. The chips and the
// legend share ONE data source (OPERATOR_RISK_LEGEND) so they can never drift,
// and operatorConnectBlockReason returns the SAME legend body a blocking chip
// decodes to — the user reads one sentence in both places, by construction.

/** The full risk-kind set. `pending-change` is dormant scaffolding this phase
 *  (its input is pinned null) — the kind exists so the taxonomy is complete and
 *  a future reader lands without a schema change. */
export type OperatorRiskKind =
  | "untrusted-genesis"
  | "quarantined"
  | "transport-error"
  | "indexer-stale"
  | "indexer-disabled"
  | "missing-capabilities"
  | "high-latency"
  | "pending-change";

export type RiskSeverity = "err" | "warn" | "info";

export interface OperatorRiskBadge {
  kind: OperatorRiskKind;
  /** Short chip label (lowercase). */
  label: string;
  /** Chip tooltip (the row-level, signal-specific sentence). */
  tooltip: string;
  severity: RiskSeverity;
}

// ── Constants (exact) ────────────────────────────────────────────────────────

/** Probe round-trip at/above this (ms) flags high-latency. The probe budget is
 *  4000 ms, so the band 3000–3999 is observable; threshold is `>=`. */
export const HIGH_LATENCY_MS = 3000;

/** Indexer lag (blocks behind head) STRICTLY above this flags indexer-stale —
 *  a lag of exactly 10 does NOT flag. */
export const INDEXER_STALE_LAG = 10;

/** Capability surfaces the wallet expects every healthy operator to serve. */
export const EXPECTED_CAPABILITY_SURFACES = ["indexer_history"];

export interface OperatorRiskInput {
  /** The reachability probe answered (eth_chainId succeeded). */
  ok: boolean;
  /** Operator answered a -32047 quarantine rejection. */
  quarantined: boolean;
  /** Genesis + chain id verified against the pin. */
  trustedGenesis: boolean;
  /** lyth_operatorCapabilities surfaces, or null when the probe returned nothing. */
  capabilities: Record<string, { status: string }> | null;
  /** Indexer ingested height, or null when the indexer is disabled/absent. */
  indexerHeight: number | null;
  /** Indexer observed chain head, or null. */
  indexerLatest: number | null;
  /** Probe round-trip (ms), or null when the latency probe failed. */
  latencyMs: number | null;
  /** A chain-supplied pending config/key/cluster change. ALWAYS null this phase
   *  (no typed SDK reader) — the chip is dormant scaffolding. */
  pendingChange: { summary: string; severity: RiskSeverity } | null;
}

/**
 * Classify one operator's signals into its risk chips (pure). Emission order is
 * the chip order in the row strip. A dead transport short-circuits (nothing else
 * is diagnosable through it); quarantine suppresses the misleading
 * untrusted-genesis chip. warn/info chips (latency, lag, caps) never block a
 * switch — only the err chips do (see operatorConnectBlockReason).
 */
export function classifyOperatorRisk(input: OperatorRiskInput): OperatorRiskBadge[] {
  // 1. Dead transport — short-circuits.
  if (!input.ok) {
    return [
      {
        kind: "transport-error",
        label: "offline",
        tooltip: "Operator probe failed (network or HTTP error).",
        severity: "err",
      },
    ];
  }

  const badges: OperatorRiskBadge[] = [];

  // 2. Trust (mutually exclusive: quarantine suppresses untrusted-genesis).
  if (input.quarantined) {
    badges.push({
      kind: "quarantined",
      label: "quarantined",
      tooltip:
        "Operator self-quarantined (checkpoint state-root mismatch) and refuses RPC. It's on your chain but temporarily can't be trusted, so the wallet won't use it until it recovers.",
      severity: "err",
    });
  } else if (!input.trustedGenesis) {
    badges.push({
      kind: "untrusted-genesis",
      label: "untrusted",
      tooltip:
        "Operator's chain genesis doesn't match the wallet's pinned genesis. The wallet won't read from or switch to this operator.",
      severity: "err",
    });
  }

  // 3. Capabilities.
  if (input.capabilities === null) {
    badges.push({
      kind: "missing-capabilities",
      label: "no caps",
      tooltip:
        "Operator did not respond to lyth_operatorCapabilities — may be running a pre-uplift binary.",
      severity: "warn",
    });
  } else {
    const caps = input.capabilities;
    const missing = EXPECTED_CAPABILITY_SURFACES.filter(
      (s) => !caps[s] || caps[s]!.status !== "available",
    );
    if (missing.length > 0) {
      badges.push({
        kind: "missing-capabilities",
        label: `missing ${missing.length}`,
        tooltip: `Operator missing surfaces: ${missing.join(", ")}.`,
        severity: "warn",
      });
    }
  }

  // 4. Indexer.
  if (input.indexerHeight === null) {
    badges.push({
      kind: "indexer-disabled",
      label: "no indexer",
      tooltip:
        "Operator indexer disabled. Activity history falls back to another operator when available.",
      severity: "info",
    });
  } else if (input.indexerLatest !== null) {
    const lag = input.indexerLatest - input.indexerHeight;
    if (lag > INDEXER_STALE_LAG) {
      badges.push({
        kind: "indexer-stale",
        label: `lag ${lag}`,
        tooltip: `Operator's indexer is ${lag} blocks behind the chain head.`,
        severity: "warn",
      });
    }
  }

  // 5. Latency.
  if (input.latencyMs !== null && input.latencyMs >= HIGH_LATENCY_MS) {
    badges.push({
      kind: "high-latency",
      label: `${(input.latencyMs / 1000).toFixed(1)}s`,
      tooltip: `Operator's probe round-trip took ${input.latencyMs} ms; healthy operators respond in under ${HIGH_LATENCY_MS} ms.`,
      severity: "warn",
    });
  }

  // 6. Pending change (dormant — input pinned null this phase).
  if (input.pendingChange !== null) {
    badges.push({
      kind: "pending-change",
      label: "pending",
      tooltip: input.pendingChange.summary,
      severity: input.pendingChange.severity,
    });
  }

  return badges;
}

export interface OperatorLegendEntry {
  kind: OperatorRiskKind;
  label: string;
  /** The fuller sentence shown in the legend card — and returned verbatim by
   *  operatorConnectBlockReason for the err kinds. */
  body: string;
  /** Gated behind developer mode (only the three err kinds are all-users). */
  devOnly: boolean;
}

/** The legend, shared with the chips. Order = display order in the card. */
export const OPERATOR_RISK_LEGEND: OperatorLegendEntry[] = [
  {
    kind: "untrusted-genesis",
    label: "Untrusted genesis",
    body: "This operator is on a different chain — the wallet won't trust its data and excludes it from every request.",
    devOnly: false,
  },
  {
    kind: "quarantined",
    label: "Quarantined",
    body: "This operator reported a checkpoint state-root mismatch and refuses RPC. It's on your chain but temporarily can't be trusted, so the wallet excludes it until it recovers.",
    devOnly: false,
  },
  {
    kind: "transport-error",
    label: "Offline / unreachable",
    body: "The wallet couldn't reach this operator. It's skipped automatically — nothing for you to do.",
    devOnly: false,
  },
  {
    kind: "indexer-stale",
    label: "Indexer lagging",
    body: "Operator's indexer is more than 10 blocks behind the chain head. Activity history fetched from this operator may miss recent transactions until it catches up.",
    devOnly: true,
  },
  {
    kind: "indexer-disabled",
    label: "No indexer",
    body: "Operator does not serve the indexer endpoint. The activity feed falls back to another operator when one is configured.",
    devOnly: true,
  },
  {
    kind: "missing-capabilities",
    label: "Capability surface gaps",
    body: "Operator is missing capability surfaces the wallet expects (indexer_history, etc.). Often means a pre-uplift binary; not load-bearing for basic sends.",
    devOnly: true,
  },
  {
    kind: "high-latency",
    label: "High latency",
    body: "Operator's probe round-trip exceeded 3 seconds. The wallet tolerates it (failover kicks in on real health failures) but routine reads may feel sluggish.",
    devOnly: true,
  },
  {
    kind: "pending-change",
    label: "Pending operator change",
    body: "Chain registry reports a pending config / key / cluster change for this operator. Severity is chain-supplied; informational only — the wallet does nothing automatic.",
    devOnly: true,
  },
];

const LEGEND_BY_KIND = new Map(OPERATOR_RISK_LEGEND.map((e) => [e.kind, e]));

/** The legend body of the first err-severity chip — the exact sentence shown as
 *  the connect-flow block reason — or null when nothing blocks (warn/info chips
 *  never block a switch). Pure. */
export function operatorConnectBlockReason(input: OperatorRiskInput): string | null {
  const err = classifyOperatorRisk(input).find((b) => b.severity === "err");
  if (!err) return null;
  return LEGEND_BY_KIND.get(err.kind)?.body ?? null;
}
