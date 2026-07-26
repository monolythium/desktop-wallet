// Pure chain-health decision core for the wallet's connection-status machine.
//
// Dependency-free (no I/O, no React): this module owns the 8-kind state union,
// the timing constants, the degraded-cause precedence resolver, the stall
// predicate, and the per-tick reducer that maps one observation + the prior
// state to the next state. The observation layer (a fixed 5 s poll) and the UI
// live elsewhere; this file is the single source of truth for the
// LIVE / STALLED / OFFLINE / CONNECTING logic and is exhaustively unit-tested.
//
// Behavior follows the status specification: §A (state list), §B (constants),
// §D.2/§D.3/§D.4 (ordered precedence), §E (stall math), §F.7 (degraded-cause
// precedence). Constants adapted for this wallet by the gap-check are noted
// inline against the specification's value.
//
// No-mock discipline: the union models all 8 kinds, but the trust / quarantine
// causes (untrusted, regenesis, quarantined) are only reachable once their real
// reads are wired (a later pass). This pass's observation layer can only ever
// emit `ok` or the `unreachable` cause, so it can only ever produce
// loading / live / stalled / offline — never a synthesized trust state.

/**
 * The eight connection-status kinds (status specification §A). `height` is the
 * chain head height from `lyth_chainStats.latestHeight` (a number).
 *   loading      → CONNECTING…
 *   reconnecting → LAST SEEN #N        (warm-start; a later pass)
 *   live         → LIVE
 *   stalled      → STALLED
 *   untrusted    → UNTRUSTED OPERATOR  (trust enforcement; a later pass)
 *   regenesis    → ALL OPERATORS UNTRUSTED (a later pass)
 *   quarantined  → OPERATOR QUARANTINED    (a later pass)
 *   offline      → OFFLINE
 */
export type ChainHealth =
  | { kind: "loading" }
  | { kind: "reconnecting"; height: number }
  | { kind: "live"; height: number }
  | { kind: "stalled"; height: number }
  | { kind: "untrusted" }
  | { kind: "regenesis" }
  | { kind: "quarantined" }
  | { kind: "offline"; reason: string };

export type ChainHealthKind = ChainHealth["kind"];

// ── Constants (status specification §B, adapted per the gap-check) ──────────

/** Health-poll cadence. The gap-check adopted the specification's 5000 ms (not
 *  a legacy 8000 ms) as the fixed head-poll heartbeat — the precondition for
 *  stall detection. */
export const HEALTH_TICK_MS = 5_000;

/** Head-unchanged duration before a STALLED verdict (status specification §B).
 *  Inclusive at the threshold — see {@link chainHealthStallVerdict}. */
export const STALL_THRESHOLD_MS = 15_000;

/** Worst-case STALLED detection latency, in ticks: the predicate is evaluated
 *  once per poll, so detection is floored by poll granularity (status
 *  specification §E): ceil(15000 / 5000) = 3 ticks = 15000 ms. */
export const STALL_WORST_CASE_TICKS = Math.ceil(STALL_THRESHOLD_MS / HEALTH_TICK_MS);

// ── Degraded-cause precedence (status specification §D.3 / §F.7) ────────────

/** The four mutually-exclusive degraded causes, highest precedence first
 *  (status specification §F.7). This pass can only observe `unreachable`; the
 *  three trust/quarantine causes are wired in a later pass and must never be
 *  synthesized before their real reads exist. */
export type DegradedCause = "regenesis" | "untrusted" | "quarantined" | "unreachable";

/**
 * Per-tick observation fed to {@link reduceHealth}: either a successful head
 * read (with the head identity used to detect advancement) or a failure with
 * its classified cause. Success and failure are mutually exclusive per tick
 * (status specification §A: "mutually exclusive per tick").
 */
export type Observation =
  | { ok: true; height: number; headId: string; chainId: number }
  | { ok: false; cause: DegradedCause; reason?: string };

/** Signals over the currently-active operator set, consumed by
 *  {@link classifyNoOperatorReason}. Populated by the fleet observation a later
 *  pass introduces; this pass never computes these (it observes one endpoint). */
export interface FleetTrustSignals {
  /** Number of currently-active operators (empty ⇒ never "quarantined"). */
  activeCount: number;
  /** ≥1 active operator returned a definitive genesis mismatch. */
  anyGenesisMismatch: boolean;
  /** ≥1 active operator answered with a different chain id. */
  anyWrongChainId: boolean;
  /** Every active operator self-quarantined (unanimous). */
  allQuarantined: boolean;
}

/**
 * Resolve the single degraded cause from the active-fleet signals, with the
 * exact precedence of the status specification §F.7:
 *   regenesis > untrusted > quarantined(unanimous) > unreachable.
 * An empty fleet can never be "quarantined". A wrong-chain operator is not
 * quarantined, and untrusted outranks quarantined regardless, so a wrong-chain
 * operator always demotes an otherwise-unanimous quarantine.
 *
 * NOTE: only reachable once the fleet observation is wired (a later pass). This
 * pass's single-endpoint failure is always `unreachable`; the resolver is
 * defined and tested here so the precedence is locked, but is not yet called
 * from the observation layer.
 */
export function classifyNoOperatorReason(signals: FleetTrustSignals): DegradedCause {
  if (signals.anyGenesisMismatch) return "regenesis";
  if (signals.anyWrongChainId) return "untrusted";
  if (signals.activeCount > 0 && signals.allQuarantined) return "quarantined";
  return "unreachable";
}

/**
 * Map a failed-poll cause to a health kind (status specification §D.3).
 * regenesis/untrusted/quarantined map to their like-named kinds; `unreachable`
 * (the only cause this pass produces) becomes `offline` with a reason.
 */
export function chainHealthForFailedPoll(cause: DegradedCause, reason?: string): ChainHealth {
  switch (cause) {
    case "regenesis":
      return { kind: "regenesis" };
    case "untrusted":
      return { kind: "untrusted" };
    case "quarantined":
      return { kind: "quarantined" };
    case "unreachable":
      return { kind: "offline", reason: reason ?? "unreachable" };
  }
}

/**
 * Whether the chain is NOT live enough to trust its balance/activity display
 * (status specification §N, with the §O correction). True for the degraded kinds
 * AND `stalled` — including `quarantined`, which HIDES the balance (a stale
 * in-code comment in the source system claimed otherwise; the shipped, and here
 * authoritative, behavior hides it). False for `live` and the transient
 * `loading` / `reconnecting` (a reopen keeps showing the last figure until the
 * first poll resolves), and for `null` (no active wallet). Pure.
 */
export function chainKindNotLive(kind: ChainHealthKind | null): boolean {
  return (
    kind === "offline" ||
    kind === "quarantined" ||
    kind === "untrusted" ||
    kind === "regenesis" ||
    kind === "stalled"
  );
}

// ── Stall predicate (status specification §E) ───────────────────────────────

/**
 * True when the head has not advanced for at least the threshold. Inclusive at
 * the threshold (status specification §E: `verdict(15000, 0, 15000) === true`,
 * `verdict(14999, 0, 15000) === false`). Pure.
 */
export function chainHealthStallVerdict(
  nowMs: number,
  lastAdvancedAtMs: number,
  thresholdMs: number,
): boolean {
  return nowMs - lastAdvancedAtMs >= thresholdMs;
}

// ── The per-tick reducer (status specification §D.2 + §E) ───────────────────

/** The decision core's carried state: the current health plus the stall-timer
 *  locals (the last observed head identity and when it last advanced). */
export interface HealthState {
  health: ChainHealth;
  /** Identity of the last observed head — a block hash, or the height as a
   *  string when the hash is unavailable (fail-closed). Null before the first
   *  successful tick. */
  lastHeadId: string | null;
  /** Client-clock time (ms) when the head last changed. Null before the first
   *  successful tick. */
  lastAdvancedAtMs: number | null;
}

/** The cold initial state before any tick resolves: CONNECTING…. */
export const INITIAL_HEALTH_STATE: HealthState = {
  health: { kind: "loading" },
  lastHeadId: null,
  lastAdvancedAtMs: null,
};

/**
 * Seed the machine state from a persisted warm-start head (status specification
 * §I steps 2–3): show RECONNECTING now, and carry the head identity + the
 * last-advanced time so the first ok tick verdicts STALLED immediately when the
 * persisted head was already past the threshold — via {@link reduceHealth}'s
 * existing same-head-past-threshold branch, not a separate stall path. A cached
 * head is NEVER surfaced as LIVE (it proves we once saw the chain, not that we
 * are connected now). Pure.
 */
export function reconnectingSeed(head: {
  height: number;
  headId: string;
  advancedAtMs: number;
}): HealthState {
  return {
    health: { kind: "reconnecting", height: head.height },
    lastHeadId: head.headId,
    lastAdvancedAtMs: head.advancedAtMs,
  };
}

/**
 * Fold one observation into the next state (status specification §D.2 + §E).
 *
 * - Failed tick → map the cause to a kind (§D.3); the stall timer is left
 *   untouched (§E: a failed tick never resets `lastAdvancedAt`).
 * - Successful tick, head advanced (or first ever) → `live`, refreshing the
 *   head identity and advance time.
 * - Successful tick, head unchanged → `stalled` when the inclusive stall
 *   predicate fires (§E), else `live`. An `ok` tick always replaces a degraded
 *   state (§D.4: "degraded → live/stalled on a P✓ tick"); if the head is still
 *   the same one seen before the outage and has genuinely not advanced past the
 *   threshold, the honest verdict on recovery is STALLED, not a false LIVE.
 *
 * Pure: `nowMs` is passed in, never read from the clock here.
 */
export function reduceHealth(state: HealthState, obs: Observation, nowMs: number): HealthState {
  if (!obs.ok) {
    return { ...state, health: chainHealthForFailedPoll(obs.cause, obs.reason) };
  }

  const advanced = state.lastHeadId === null || obs.headId !== state.lastHeadId;
  if (advanced) {
    return {
      health: { kind: "live", height: obs.height },
      lastHeadId: obs.headId,
      lastAdvancedAtMs: nowMs,
    };
  }

  const stalled = chainHealthStallVerdict(
    nowMs,
    state.lastAdvancedAtMs ?? nowMs,
    STALL_THRESHOLD_MS,
  );
  return {
    ...state,
    health: stalled
      ? { kind: "stalled", height: obs.height }
      : { kind: "live", height: obs.height },
  };
}
