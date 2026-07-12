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
// Lifecycle follows the desktop's self-rescheduling-setTimeout convention (see
// PendingTxReconciler): one timer, cleared on unmount; the read is skipped while
// the window is hidden and refreshed immediately on becoming visible (status
// specification §D.2 visibility gate); the machine restarts fresh when the
// active endpoint changes (a failover), so a stall baseline is never carried
// across nodes.

import { useEffect, useState } from "react";
import {
  currentEndpoint,
  markActiveOperatorTrusted,
  markActiveOperatorUntrusted,
  setEndpoint,
  subscribeEndpoint,
} from "./client";
import { resolveTrustedHead } from "./chain-trust";
import {
  HEALTH_TICK_MS,
  INITIAL_HEALTH_STATE,
  reduceHealth,
  type ChainHealth,
  type Observation,
} from "./chain-health";

export interface ChainHealthView {
  /** The current status kind (loading / live / stalled / offline this pass). */
  health: ChainHealth;
  /** Last observed chain id, for the status label; null until the first ok tick. */
  chainId: number | null;
  /** The endpoint the heartbeat is polling; null until the first read resolves. */
  endpoint: string | null;
}

const IDLE_VIEW: ChainHealthView = { health: { kind: "loading" }, chainId: null, endpoint: null };

/**
 * Poll the chain head every {@link HEALTH_TICK_MS} while `enabled`, driving the
 * pure health machine. When disabled (e.g. no active wallet) the poll idles and
 * the view resets to CONNECTING…. The head read is chain-wide, so the hook takes
 * no address.
 */
export function useChainHealth(enabled: boolean): ChainHealthView {
  const [view, setView] = useState<ChainHealthView>(IDLE_VIEW);
  // Bumped on every endpoint switch so the poll effect re-runs against the new
  // node with a fresh stall baseline.
  const [endpointBump, setEndpointBump] = useState(0);

  useEffect(() => subscribeEndpoint(() => setEndpointBump((n) => n + 1)), []);

  useEffect(() => {
    if (!enabled) {
      setView(IDLE_VIEW);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let state = INITIAL_HEALTH_STATE;

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
        } else {
          // Fail-closed: an untrusted fleet serves no reads.
          markActiveOperatorUntrusted(res.cause);
        }
        const obs: Observation = res.ok
          ? { ok: true, height: res.height, headId: res.headId, chainId: res.chainId }
          : { ok: false, cause: res.cause, reason: res.reason };
        state = reduceHealth(state, obs, Date.now());
        setView((prev) => ({
          health: state.health,
          chainId: res.ok ? res.chainId : prev.chainId,
          endpoint: res.ok ? res.url : currentEndpoint(),
        }));
      }
      schedule(HEALTH_TICK_MS);
    };

    const onVisible = () => {
      if (!cancelled && document.visibilityState === "visible") {
        clear();
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    void tick();

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, endpointBump]);

  return view;
}
