// React binding for the durable tracked-tx store.
//
// `useSyncExternalStore` subscribes a component to the store cache so a
// freshly-enqueued tx — and its later removal once the reconcile loop carries
// it to a terminal state — re-renders any view that shows outstanding txs (the
// Activity "Pending" section). Mirrors the Topbar's notifications-store
// subscription, but as a hook: the snapshot starts empty and is hydrated by
// `hydratePendingTxs()` on first mount, so the first paint matches a build
// with no in-flight txs.

import { useEffect, useSyncExternalStore } from "react";
import {
  hydratePendingTxs,
  pendingTxsSnapshot,
  subscribePendingTxs,
} from "./pending-tx-store";
import type { PendingTx } from "./pending-tx";

/** Subscribe to the durable tracked-tx store. Triggers a one-time disk
 *  hydration on first mount; returns an empty array until hydration resolves
 *  and whenever no tx is outstanding. The array reference is stable between
 *  renders while the set is unchanged. */
export function usePendingTxs(): ReadonlyArray<PendingTx> {
  useEffect(() => {
    void hydratePendingTxs();
  }, []);
  return useSyncExternalStore(
    subscribePendingTxs,
    pendingTxsSnapshot,
    pendingTxsSnapshot,
  );
}
