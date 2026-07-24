// React hook: the wallet's chain-health heartbeat.
//
// Replaces the one-shot connection read for the status surface with a fixed 5 s
// head poll (status specification §B/§D — the precondition for stall detection).
// Each tick resolves a trusted head across the operator fleet (verifying chain
// id + genesis against the pin), reading through the shared SDK client seam (no
// second RPC path), and folds the outcome through the pure decision core
// (`reduceHealth`) to yield live / stalled (trusted head) or offline / untrusted
// / regenesis / quarantined (the degraded cause from F1's resolver). When the
// active operator is untrusted but another fleet operator qualifies, the read
// path fails over to it (`setEndpoint`) so the health verdict always reflects
// the operator the wallet actually reads from. Each tick marks the seam's trust
// state so an untrusted operator serves no reads and signs nothing (fail-closed).
//
// Warm-start (§I): the last-seen head is persisted per (address, chain) to the
// durable store on every advance. On a true reopen the machine restores it to
// show RECONNECTING (never LIVE) while the first poll is in flight, and seeds
// the stall math so an already-stalled chain verdicts STALLED immediately. An
// in-session remount (lock→unlock) instead shows the prior kind from a module
// snapshot — no CONNECTING/RECONNECTING flash.
//
// Lifecycle follows the desktop's self-rescheduling-setTimeout convention (see
// PendingTxReconciler): one timer, cleared on unmount; the read is skipped while
// the window is hidden and refreshed immediately on becoming visible (status
// specification §D.2 visibility gate); the machine restarts fresh when the
// active endpoint changes (a failover) or the address changes (a new scope).

import { useEffect, useState } from "react";
import {
  currentEndpoint,
  markActiveOperatorTrusted,
  markActiveOperatorUntrusted,
  setEndpoint,
  subscribeEndpoint,
} from "./client";
import { resolveTrustedHead } from "./chain-trust";
import { loadWarmStartHead, saveWarmStartHead } from "./chain-health-store";
import { scopeChainKey, subscribeActiveChain } from "./chains";
import {
  HEALTH_TICK_MS,
  INITIAL_HEALTH_STATE,
  reconnectingSeed,
  reduceHealth,
  type ChainHealth,
  type Observation,
} from "./chain-health";

export interface ChainHealthView {
  /** The current status kind. */
  health: ChainHealth;
  /** Last observed chain id, for the status label; null until the first ok tick. */
  chainId: number | null;
  /** The endpoint the heartbeat is polling; null until the first read resolves. */
  endpoint: string | null;
}

const IDLE_VIEW: ChainHealthView = { health: { kind: "loading" }, chainId: null, endpoint: null };

// Module-scope snapshot of the last health kind (§I). Survives an in-session
// remount (lock→unlock) so the chip shows the prior kind instantly; re-inits to
// null on a true reopen (a fresh module load), where the durable warm-start
// cache instead drives RECONNECTING.
let lastKnownHealth: ChainHealth | null = null;

/** Test-only — clear the module snapshot so each test opens cold. */
export function __resetChainHealthModuleForTests(): void {
  lastKnownHealth = null;
}

/**
 * Poll the chain head every {@link HEALTH_TICK_MS} while `address` is set,
 * driving the pure health machine. Passing `null`/empty (no active wallet) idles
 * the poll and resets the view to CONNECTING…. The head read is chain-wide; the
 * address scopes only the warm-start cache (per address + chain), so one vault's
 * cached head can never surface under another.
 */
export function useChainHealth(address: string | null): ChainHealthView {
  const scope = address && address.length > 0 ? address.toLowerCase() : null;
  const [view, setView] = useState<ChainHealthView>(() =>
    lastKnownHealth ? { health: lastKnownHealth, chainId: null, endpoint: null } : IDLE_VIEW,
  );
  // Bumped on every endpoint switch so the poll effect re-runs against the new
  // node with a fresh stall baseline.
  const [endpointBump, setEndpointBump] = useState(0);

  useEffect(() => subscribeEndpoint(() => setEndpointBump((n) => n + 1)), []);
  // Re-run the poll effect on an active-chain switch even when the endpoint URL
  // is unchanged (two chains can share one RPC host), so the machine always
  // restarts under the new chain's scope with a fresh stall baseline.
  useEffect(
    () =>
      subscribeActiveChain(() => {
        setEndpointBump((n) => n + 1);
        // A chain switch invalidates the previous chain's health verdict. The
        // poll effect resets its LOCAL machine, but the PUBLISHED view would keep
        // the prior chain's kind (a stale LIVE) until the first new-chain tick —
        // and the chainKindNotLive gate would trust it for that round-trip. Drop
        // to loading now; boot() re-seeds RECONNECTING and the tick resolves it.
        setView((prev) => (prev.health.kind === "loading" ? prev : IDLE_VIEW));
      }),
    [],
  );

  useEffect(() => {
    if (scope === null) {
      setView(IDLE_VIEW);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let state = INITIAL_HEALTH_STATE;
    let lastChainId: number | null = null;

    const publish = (v: ChainHealthView) => {
      lastKnownHealth = v.health; // module snapshot for the next in-session remount
      setView(v);
    };

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const schedule = (ms: number) => {
      clear();
      if (!cancelled) timer = setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (cancelled) return;
      // Visibility gate: skip the RPC read while hidden, but keep the heartbeat
      // scheduled so it resumes cleanly on the next visible tick.
      if (document.visibilityState !== "hidden") {
        const res = await resolveTrustedHead();
        if (cancelled) return;
        if (res.ok) {
          // Fail over the read path so health tracks the operator we read from.
          if (res.url !== currentEndpoint()) setEndpoint(res.url);
          markActiveOperatorTrusted();
          lastChainId = res.chainId;
        } else {
          // Fail-closed: an untrusted fleet serves no reads.
          markActiveOperatorUntrusted(res.cause);
        }
        const obs: Observation = res.ok
          ? { ok: true, height: res.height, headId: res.headId, chainId: res.chainId }
          : { ok: false, cause: res.cause, reason: res.reason };
        const prevHeadId = state.lastHeadId;
        state = reduceHealth(state, obs, Date.now());
        // Persist the last-seen head on a genuine advance, so a reopen can
        // RECONNECT and verdict a persisted stall (§I). Best-effort, fire-and-forget.
        if (
          state.health.kind === "live" &&
          state.lastHeadId !== null &&
          state.lastHeadId !== prevHeadId &&
          state.lastAdvancedAtMs !== null
        ) {
          void saveWarmStartHead(scope, scopeChainKey(), {
            height: state.health.height,
            headId: state.lastHeadId,
            advancedAtMs: state.lastAdvancedAtMs,
          });
        }
        publish({
          health: state.health,
          chainId: lastChainId,
          endpoint: res.ok ? res.url : currentEndpoint(),
        });
      }
      schedule(HEALTH_TICK_MS);
    };

    const boot = async () => {
      // §I step 2: seed RECONNECTING from the durable cache before the first
      // poll. Replaces ONLY a still-loading view (an in-session remount keeps its
      // prior kind); a cached head is NEVER shown as LIVE.
      const cached = await loadWarmStartHead(scope, scopeChainKey());
      if (cancelled) return;
      if (cached) {
        state = reconnectingSeed(cached);
        setView((prev) =>
          prev.health.kind === "loading"
            ? { health: state.health, chainId: prev.chainId, endpoint: currentEndpoint() }
            : prev,
        );
      }
      // §I step 3: the first poll resolves the real state.
      void tick();
    };

    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") {
        clear();
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    void boot();

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scope, endpointBump]);

  return view;
}
