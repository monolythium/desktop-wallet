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
//   - Always mounted from App.tsx. It costs nothing while idle: with no tracked
//     txs the loop holds no timer at all and re-arms from the store
//     subscription below.
//   - Subscribes to the tracked-tx store so an enqueue (from a fresh broadcast)
//     wakes the loop immediately, and the loop self-idles the moment the set
//     empties (no busy-poll when there's nothing to track).
//   - Each non-empty tick reconciles, then schedules the next at the base
//     cadence; a tick that records nothing terminal AND leaves work
//     outstanding backs the cadence off (a few seconds → capped) so a stuck /
//     unreachable tx doesn't hammer the RPC. The window-expiry backstop in
//     `reconcilePendingOnce` eventually drops a tx that never resolves.

import { useEffect } from "react";
import { subscribeActiveChain } from "../sdk/chains";
import { reconcilePendingOnce } from "../sdk/reconcile";
import { hasPendingTxs, subscribePendingTxs } from "../sdk/pending-tx-store";
import { useChainHealthView } from "../sdk/ChainHealthProvider";

/** Base cadence between reconcile ticks while txs are outstanding. Exported so
 *  the gate matrix can be driven on the real cadence, as IncomingPoller does. */
export const RECONCILE_BASE_MS = 4_000;
/** Back-off ceiling — a run of ticks that resolve nothing lengthens the gap up
 *  to here so a stuck tx doesn't hammer the RPC. Well under the 45-minute
 *  absolute cap (and the 60-minute terminal retain that follows it), so a
 *  recoverable tx still gets many probes before it is ever given up on. */
const RECONCILE_MAX_MS = 30_000;

export function PendingTxReconciler() {
  const chainKind = useChainHealthView().health.kind;

  useEffect(() => {
    // Genesis-scoped pending state can only be opened after the active endpoint
    // passes the chain/genesis trust probe. Re-running on kind transitions means
    // an offline cold start automatically hydrates and resumes once live.
    if (chainKind !== "live") return;

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
      // Hidden window: skip the read, keep the loop armed (the visibility
      // listener below ticks immediately on return) — the same gate the other
      // pollers use. This is the one poller that used to keep dispatching
      // through the trust seam while the verdict it consults was, by design,
      // not being re-proven.
      //
      // Deferral cannot become a miss: `reconcilePendingOnce` asks the chain
      // what happened rather than watching a stream, so the answer is the same
      // whenever it is asked, and it probes for a terminal verdict BEFORE any
      // retention removal — so even a row that aged out while the window was
      // hidden is still recorded on the catch-up tick.
      //
      // The delay is carried unchanged rather than backed off: a skipped tick
      // made no progress because it did no work, and being away is not a stuck
      // transaction.
      if (document.visibilityState !== "visible") {
        schedule(delay);
        return;
      }
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

    // Re-arm on a chain switch. reconcilePendingOnce only probes the ACTIVE
    // chain's rows against the active RPC, so switching chains brings a
    // different set into scope (and takes the previous chain's out). Wake the
    // loop so the newly-active chain's tracked txs reconcile against their own
    // chain rather than waiting on the next enqueue or app restart.
    const unsubscribeChain = subscribeActiveChain(() => {
      if (cancelled) return;
      delay = RECONCILE_BASE_MS;
      if (timer === null) schedule(RECONCILE_BASE_MS);
    });

    // Catch up the instant the window is visible again, rather than waiting out
    // the remainder of a timer that has been ticking past skipped work. Only
    // when the loop was actually armed — an idle reconciler (nothing tracked)
    // stays idle, and its next enqueue wakes it through the store subscription.
    const onVisible = () => {
      if (cancelled || timer === null) return;
      if (document.visibilityState !== "visible") return;
      delay = RECONCILE_BASE_MS;
      clear();
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Re-arm at mount for any tx left tracked across an app restart.
    void (async () => {
      if (cancelled) return;
      if (await hasPendingTxs()) schedule(RECONCILE_BASE_MS);
    })();

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
      unsubscribeChain();
    };
  }, [chainKind]);

  return null;
}
