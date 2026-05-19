// React hook for the chain-snapshot SDK call.
// Caller passes the address it wants a balance for; the hook does the
// `eth_chainId` + `eth_blockNumber` + `eth_getBalance` round trip via
// `MonolythiumProvider`.
//
// Phase 2 refresh affordances (Commit 14):
//   - `refresh()` returned alongside the snapshot — callers wire a
//     manual button to it.
//   - Auto-refresh every 30 seconds by default (suppressed if the
//     tab is hidden — `document.hidden`).
//   - Re-fetches on window-focus so reopening the app shows current
//     state without the user clicking anything.
//   - `lastUpdated` timestamp surfaced so the UI can render a "last
//     refreshed N seconds ago" hint.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadChainSnapshot } from "./client";
import type { ChainSnapshot } from "./client";

type Status = "loading" | "ok" | "error";

export interface UseChainSnapshotState {
  status: Status;
  snapshot: ChainSnapshot | null;
  /** Wall-clock timestamp (ms) of the most recent successful fetch. */
  lastUpdated: number | null;
  /** Manual refresh — re-runs `loadChainSnapshot`. */
  refresh: () => void;
}

export interface UseChainSnapshotOptions {
  /**
   * Milliseconds between auto-refreshes. `0` disables the interval.
   * Defaults to 30 seconds.
   */
  autoIntervalMs?: number;
  /**
   * When true, re-fetch on `window.focus`. Defaults to true.
   */
  refreshOnFocus?: boolean;
}

const DEFAULT_AUTO_INTERVAL_MS = 30_000;

export function useChainSnapshot(
  address: string,
  options: UseChainSnapshotOptions = {},
): UseChainSnapshotState {
  const autoIntervalMs = options.autoIntervalMs ?? DEFAULT_AUTO_INTERVAL_MS;
  const refreshOnFocus = options.refreshOnFocus ?? true;

  const [status, setStatus] = useState<Status>("loading");
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // `cancelledRef` lets a stale in-flight fetch be ignored when its
  // request finishes after a newer one has already updated state.
  const inFlight = useRef(0);

  const refresh = useCallback(() => {
    const ticket = ++inFlight.current;
    setStatus((prev) => (prev === "ok" ? "ok" : "loading"));
    void loadChainSnapshot(address).then((snap) => {
      // Drop the result if a newer fetch superseded us.
      if (ticket !== inFlight.current) return;
      setSnapshot(snap);
      if (snap.error) {
        setStatus("error");
      } else {
        setStatus("ok");
        setLastUpdated(Date.now());
      }
    });
  }, [address]);

  // First fetch on mount + on address change.
  useEffect(() => {
    setSnapshot(null);
    setStatus("loading");
    setLastUpdated(null);
    refresh();
  }, [address, refresh]);

  // Auto-refresh interval. Suppressed while the document is hidden so
  // we don't burn cycles on a background tab.
  useEffect(() => {
    if (autoIntervalMs <= 0) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      refresh();
    };
    const id = setInterval(tick, autoIntervalMs);
    return () => clearInterval(id);
  }, [autoIntervalMs, refresh]);

  // Focus listener — fires when the window regains focus.
  useEffect(() => {
    if (!refreshOnFocus) return;
    if (typeof window === "undefined") return;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshOnFocus, refresh]);

  return { status, snapshot, lastUpdated, refresh };
}
