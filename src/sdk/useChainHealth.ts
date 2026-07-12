// React hook: the wallet's chain-health heartbeat.
//
// Replaces the one-shot connection read for the status surface with a fixed 5 s
// head poll (status specification §B/§D — the precondition for stall detection).
// Each tick reads the chain head through the shared SDK client seam
// (`loadChainHead` → `lyth_chainStats`; no second RPC path) and folds the
// outcome through the pure decision core (`reduceHealth`), yielding one of
// loading / live / stalled / offline. The trust/quarantine kinds are
// unreachable here — a single failed read is `unreachable` → offline; their
// real reads (fleet + genesis) are wired in a later pass.
//
// Lifecycle follows the desktop's self-rescheduling-setTimeout convention (see
// PendingTxReconciler): one timer, cleared on unmount; the read is skipped while
// the window is hidden and refreshed immediately on becoming visible (status
// specification §D.2 visibility gate); the machine restarts fresh when the
// active endpoint changes, so a stall baseline is never carried across nodes.

import { useEffect, useState } from "react";
import { loadChainHead, subscribeEndpoint } from "./client";
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
        const read = await loadChainHead();
        if (cancelled) return;
        const obs: Observation = read.ok
          ? { ok: true, height: read.height!, headId: read.headId!, chainId: read.chainId! }
          : { ok: false, cause: "unreachable", reason: read.error?.message };
        state = reduceHealth(state, obs, Date.now());
        setView((prev) => ({
          health: state.health,
          chainId: read.ok ? read.chainId! : prev.chainId,
          endpoint: read.endpoint,
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
