// App-level home for the delegation-rejection signal.
//
// It lives above the router precisely because the Delegate page is where a
// rejection happens and NOT where the user necessarily is a moment later. State
// held by that page would die with it; state held here survives the navigation
// that is the whole reason the signal exists.
//
// It does not survive a scope change. The rejection is raised with the
// `${addressLower}:${chainIdHex}` it happened under, and a change to either
// clears it — showing "delegation rejected" against a wallet or chain it never
// concerned is a false alarm, and the same class of leak this project has fixed
// repeatedly elsewhere.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { scopeChainKey } from "./chains";
import { useActiveWallet } from "./active-wallet";
import {
  rejectionStillInScope,
  type DelegationRejection,
} from "./delegation-rejection";

interface RaiseInput {
  clusterId: number;
  clusterName: string | null;
  kind: "delegate" | "redelegate";
  message: string;
}

interface DelegationRejectionApi {
  /** The rejection to render, or null. */
  rejection: DelegationRejection | null;
  /** Raise (or replace) the signal for the active scope. */
  raise: (input: RaiseInput) => void;
  /** Clear it — a successful delegation-family submit, or the user dismissing. */
  clear: () => void;
}

const Ctx = createContext<DelegationRejectionApi | null>(null);

/** Read the signal. Returns an inert API outside the provider so a component
 *  rendered in isolation (a test, a stub route) never throws. */
export function useDelegationRejection(): DelegationRejectionApi {
  return (
    useContext(Ctx) ?? {
      rejection: null,
      raise: () => {},
      clear: () => {},
    }
  );
}

export function DelegationRejectionProvider({ children }: { children: ReactNode }) {
  const wallet = useActiveWallet();
  const address = wallet.status === "ready" ? wallet.address.toLowerCase() : "";
  const scope = `${address}:${scopeChainKey()}`;

  const [held, setHeld] = useState<
    { rejection: DelegationRejection; scope: string } | null
  >(null);

  // A scope change retires the signal. Comparing rather than clearing blindly
  // keeps a rejection raised moments ago visible across an unrelated re-render.
  useEffect(() => {
    setHeld((cur) =>
      cur === null || rejectionStillInScope(cur.scope, scope) ? cur : null,
    );
  }, [scope]);

  const raise = useCallback(
    (input: RaiseInput) => {
      setHeld({
        rejection: { ...input, atMs: Date.now() },
        scope,
      });
    },
    [scope],
  );

  const clear = useCallback(() => setHeld(null), []);

  const value = useMemo<DelegationRejectionApi>(() => {
    const inScope =
      held !== null && rejectionStillInScope(held.scope, scope) ? held.rejection : null;
    return { rejection: inScope, raise, clear };
  }, [held, scope, raise, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
