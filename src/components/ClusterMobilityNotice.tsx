// ClusterMobilityNotice — informational banner for the Stake / Operators
// page surfacing recent operator joins / leaves on clusters the user
// has stake on.
//
// §14 cluster-marketplace context: mobility is a feature, not a bug.
// The notice copy is informational ("operator X joined cluster Y"),
// never alarming.
//
// Detection: walks the cluster detail history (operator state changes
// in the last 7 days). The v2 testnet doesn't yet emit a dedicated
// `lyth_clusterMembershipHistory(clusterId, sinceHeight)` RPC; until
// then this component renders only when the synthesised data has at
// least one event. See GAP #D12 in the Phase 3 final report.

import { useEffect, useState } from "react";
import { getClusterDetail, type ClusterDetail } from "../sdk/staking";

interface Props {
  /** Cluster ids the user cares about (their staked clusters, or the
   *  detail-panel's current focus). */
  clusterIds: ReadonlyArray<number>;
  /** Optional title override. Defaults to "Recent membership changes". */
  title?: string;
}

interface MobilityEvent {
  clusterId: number;
  clusterName: string;
  kind: "joined" | "left";
  operatorId: string;
  // Optional metadata fields surfaced when the chain ships the history.
  round: bigint | null;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; events: MobilityEvent[] }
  | { kind: "error"; message: string };

/** Detect a synthetic mobility-history signal from the cluster detail.
 *  Until the chain emits a real history, we surface zero events from
 *  the v2 testnet — but the wiring is in place so the moment the
 *  chain ships, the notice lights up. */
function deriveMobilityEvents(detail: ClusterDetail): MobilityEvent[] {
  // The chain will eventually expose join/leave events; for now we
  // detect them via `operator.state` transitions (state === "joining"
  // or "leaving") if the chain happens to mark them that way.
  const out: MobilityEvent[] = [];
  for (const op of detail.operators) {
    if (op.state === "joining") {
      out.push({
        clusterId: detail.summary.clusterId,
        clusterName: detail.summary.name,
        kind: "joined",
        operatorId: op.operatorId,
        round: null,
      });
    } else if (op.state === "leaving") {
      out.push({
        clusterId: detail.summary.clusterId,
        clusterName: detail.summary.name,
        kind: "left",
        operatorId: op.operatorId,
        round: null,
      });
    }
  }
  return out;
}

export function ClusterMobilityNotice({ clusterIds, title }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (clusterIds.length === 0) {
        setState({ kind: "ready", events: [] });
        return;
      }
      const results = await Promise.all(
        clusterIds.map((cid) => getClusterDetail(cid)),
      );
      if (cancelled) return;
      const events: MobilityEvent[] = [];
      for (const r of results) {
        if (r.ok && r.value) events.push(...deriveMobilityEvents(r.value));
      }
      setState({ kind: "ready", events });
    })();
    return () => {
      cancelled = true;
    };
  }, [clusterIds]);

  if (state.kind === "loading") return null;
  if (state.kind === "error") return null;
  if (state.events.length === 0) return null;

  return (
    <div className="w-card" style={{ marginTop: 12 }}>
      <div className="w-card__head">
        <h3>{title ?? "Recent membership changes"}</h3>
      </div>
      <div className="w-card__body" style={{ fontSize: 12.5 }}>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          {state.events.map((ev, i) => (
            <li key={`${ev.clusterId}-${ev.operatorId}-${i}`}>
              Operator <span className="mono">{ev.operatorId}</span>{" "}
              {ev.kind === "joined" ? "joined" : "left"}{" "}
              <span className="mono">{ev.clusterName}</span>
              {ev.round !== null ? (
                <span className="cap" style={{ marginLeft: 6 }}>
                  round #{ev.round.toString()}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="row-help" style={{ marginTop: 8 }}>
          §14 cluster marketplace: operator mobility is normal — clusters
          are free to add or shed members within their bond rules.
        </div>
      </div>
    </div>
  );
}
