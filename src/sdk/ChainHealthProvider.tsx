// Shared chain-health provider.
//
// Holds ONE heartbeat instance (useChainHealth) and shares its view via context,
// so the topbar chip, the degraded banner, and the balance/activity gating read
// the same live state without each opening its own 5 s poll. The provider
// re-renders on a health change, but its `children` prop is stable, so only the
// context consumers re-render — not the whole app tree.

import { createContext, useContext, type ReactNode } from "react";
import { useActiveWallet } from "./active-wallet";
import { useChainHealth, type ChainHealthView } from "./useChainHealth";

const IDLE_VIEW: ChainHealthView = { health: { kind: "loading" }, chainId: null, endpoint: null };

const ChainHealthContext = createContext<ChainHealthView>(IDLE_VIEW);

export function ChainHealthProvider({ children }: { children: ReactNode }) {
  const wallet = useActiveWallet();
  const address = wallet.status === "ready" ? wallet.address : null;
  const view = useChainHealth(address);
  return <ChainHealthContext.Provider value={view}>{children}</ChainHealthContext.Provider>;
}

/** Read the shared chain-health view. */
export function useChainHealthView(): ChainHealthView {
  return useContext(ChainHealthContext);
}
