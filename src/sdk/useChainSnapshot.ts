// React hook for the chain-snapshot SDK call.
// Caller passes the address it wants a balance for; the hook reads native
// height plus the current compatibility balance envelope.

import { useEffect, useState } from "react";
import { loadChainSnapshot } from "./client";
import type { ChainSnapshot } from "./client";

type State =
  | { status: "loading"; snapshot: null }
  | { status: "ok"; snapshot: ChainSnapshot }
  | { status: "error"; snapshot: ChainSnapshot };

export function useChainSnapshot(address: string): State {
  const [state, setState] = useState<State>({ status: "loading", snapshot: null });

  useEffect(() => {
    let cancelled = false;
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
  }, [address]);

  return state;
}
