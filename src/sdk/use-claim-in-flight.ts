// React binding for the in-flight claim guard.
//
// Reads the durable tracked-tx store, so the guard survives an app restart: a
// claim broadcast and then quit still guards on relaunch until the reconciler
// resolves it. Scoped to the active (address, chain) — another vault's
// outstanding claim must never disable this wallet's button.

import { useMemo } from "react";
import { hasInFlightClaim } from "./claim-in-flight";
import { usePendingTxs } from "./use-pending-tx";

/** True while THIS scope has a claim that might still land. */
export function useInFlightClaim(addressLower: string, chainIdHex: string): boolean {
  const rows = usePendingTxs();
  return useMemo(
    () => hasInFlightClaim(rows, addressLower, chainIdHex),
    [rows, addressLower, chainIdHex],
  );
}
