// React hook for the chain-snapshot SDK call.
// Caller passes the address it wants a balance for; the hook reads native
// height plus the current compatibility balance envelope.
//
// The snapshot re-fetches whenever the active RPC endpoint changes (the user
// switched peers): the hook subscribes to endpoint changes and bumps an
// internal dependency, so the effect re-runs against the new node.

import { useEffect, useState } from "react";
import { loadChainSnapshot, subscribeEndpoint } from "./client";
import type { ChainSnapshot } from "./client";

type State =
  | { status: "loading"; snapshot: null }
  | { status: "ok"; snapshot: ChainSnapshot }
  | { status: "error"; snapshot: ChainSnapshot };

export function useChainSnapshot(address: string): State {
  const [state, setState] = useState<State>({ status: "loading", snapshot: null });
  // Bumped on every endpoint change to force the fetch effect to re-run.
  const [endpointBump, setEndpointBump] = useState(0);

  useEffect(() => {
    return subscribeEndpoint(() => setEndpointBump((n) => n + 1));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setState({ status: "loading", snapshot: null });
      return () => {
        cancelled = true;
      };
    }
    setState({ status: "loading", snapshot: null });
    void loadChainSnapshot(address).then((snap) => {
      if (cancelled) return;
      setState({
        status: snap.error ? "error" : "ok",
        snapshot: snap,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [address, endpointBump]);

  return state;
}
