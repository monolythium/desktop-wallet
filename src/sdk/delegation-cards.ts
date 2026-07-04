// Pure mapping/truncation for the Delegate page's cluster cards + the
// per-cluster "More details" expansion. No chain lookup, no DOM.

/** Cluster APR label from the raw `aprBps` read (`lyth_clusterApr.aprBps`,
 *  basis points). A REAL `0` renders "0.00%" (no reward accrued in the window);
 *  only an unavailable read — `null` / `undefined` / non-finite — renders "—".
 *  Never fabricates a rate. Pure. */
export function aprLabelFromBps(aprBps: number | null | undefined): string {
  if (aprBps === null || aprBps === undefined || !Number.isFinite(aprBps)) {
    return "—";
  }
  return `${(aprBps / 100).toFixed(2)}%`;
}

/** Filter a wallet's delegation history to the events that touch one cluster —
 *  a delegate/undelegate on it, or a redelegate into or out of it (either the
 *  source `cluster` or the destination `toCluster` matches). Pure. */
export function clusterActivity<
  T extends { cluster: number; toCluster: number | null },
>(history: ReadonlyArray<T>, clusterId: number): T[] {
  return history.filter(
    (r) => r.cluster === clusterId || r.toCluster === clusterId,
  );
}

/** Truncate a list to the first `n`, reporting how many more remain (the
 *  "+N more events" count). `n <= 0` shows nothing; `n >= length` shows all with
 *  `more: 0`. Pure. */
export function truncateWithMore<T>(
  items: ReadonlyArray<T>,
  n: number,
): { shown: T[]; more: number } {
  const shown = items.slice(0, Math.max(0, n));
  return { shown, more: Math.max(0, items.length - shown.length) };
}
