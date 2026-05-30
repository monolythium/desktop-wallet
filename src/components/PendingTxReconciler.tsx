// App-level tracked-tx reconcile poller.
//
// A single headless effect that drives `reconcilePendingOnce` on an interval
// while there is ≥1 durable tracked tx. This is the ONE reconcile path: it
// replaces the OperationsDrawer's bounded fire-and-forget poll, so a tx the
// wallet broadcast is followed to a real terminal state (confirmed OR failed)
// even after the drawer closes — the notification fires from here, not the
// drawer.
//
// Lifecycle:
//   - Mounted from App.tsx ONLY when the experimental flag is on (flag off ⇒
//     not mounted ⇒ zero behavior change vs. the pre-poller wallet).
//   - Subscribes to the tracked-tx store so an enqueue (from a fresh broadcast)
//     wakes the loop immediately, and the loop self-idles the moment the set
//     empties (no busy-poll when there's nothing to track).
//   - Each non-empty tick reconciles, then schedules the next at the base
//     cadence; a tick that records nothing terminal AND leaves work
//     outstanding backs the cadence off (a few seconds → capped) so a stuck /
//     unreachable tx doesn't hammer the RPC. The window-expiry backstop in
//     `reconcilePendingOnce` eventually drops a tx that never resolves.

import { useEffect } from "react";
import { reconcilePendingOnce } from "../sdk/reconcile";
import { hasPendingTxs, subscribePendingTxs } from "../sdk/pending-tx-store";

/** Base cadence between reconcile ticks while txs are outstanding. */
const RECONCILE_BASE_MS = 4_000;
/** Back-off ceiling — a run of ticks that resolve nothing lengthens the gap up
 *  to here so a stuck tx doesn't hammer the RPC. Stays well under the 5-min
 *  tracking window so a recoverable tx still gets repeated probes. */
const RECONCILE_MAX_MS = 30_000;

export function PendingTxReconciler() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = RECONCILE_BASE_MS;

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (ms: number) => {
      clear();
      if (cancelled) return;
      timer = setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (cancelled) return;
      const before = await hasPendingTxs();
      if (!before) {
        // Nothing tracked — go fully idle. A future enqueue re-arms via the
        // store subscription below.
        delay = RECONCILE_BASE_MS;
        clear();
        return;
      }
      const { remaining, recorded } = await reconcilePendingOnce();
      if (cancelled) return;
      if (remaining === 0) {
        // Set drained this tick (terminal or expired) — idle until the next
        // enqueue.
        delay = RECONCILE_BASE_MS;
        clear();
        return;
      }
      // Work still outstanding. Reset the cadence whenever a tick made
      // progress (recorded a terminal); otherwise back off so a stuck /
      // unreachable tx is probed less aggressively over time.
      delay =
        recorded > 0
          ? RECONCILE_BASE_MS
          : Math.min(delay * 2, RECONCILE_MAX_MS);
      schedule(delay);
    };

    // Wake the loop on any tracked-set mutation. An enqueue from a fresh
    // broadcast arrives here even while the loop sits idle, so a newly-tracked
    // tx is probed within the base cadence rather than waiting on a timer that
    // was never set.
    const unsubscribe = subscribePendingTxs(() => {
      if (cancelled) return;
      delay = RECONCILE_BASE_MS;
      // Probe shortly after the enqueue lands (small beat so the broadcast's
      // receipt has a chance to exist), without piling ticks if several
      // enqueue in quick succession.
      if (timer === null) schedule(RECONCILE_BASE_MS);
    });

    // Re-arm at mount for any tx left tracked across an app restart.
    void (async () => {
      if (cancelled) return;
      if (await hasPendingTxs()) schedule(RECONCILE_BASE_MS);
    })();

    return () => {
      cancelled = true;
      clear();
      unsubscribe();
    };
  }, []);

  return null;
}
