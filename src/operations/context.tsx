// Operations context — single drawer root, anyone in the tree can
// `useOperations().open(descriptor)` to route an action through the
// preview → auth → executing → done state machine.

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { OperationsDrawer } from "./OperationsDrawer";
import type { OperationDescriptor } from "./types";
import type { Route } from "../components/types";

interface OperationsApi {
  open: (descriptor: OperationDescriptor) => void;
  close: () => void;
}

const Ctx = createContext<OperationsApi | null>(null);

export function OperationsProvider({
  children,
  onNavigate,
}: {
  children: ReactNode;
  /** Forwarded to the drawer so a classified error's "Operators" mention can
   *  route. Omit ⇒ the mention stays plain text. */
  onNavigate?: (route: Route) => void;
}) {
  const [active, setActive] = useState<OperationDescriptor | null>(null);

  const open = useCallback((descriptor: OperationDescriptor) => {
    setActive(descriptor);
  }, []);
  const close = useCallback(() => setActive(null), []);

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {active ? <OperationsDrawer descriptor={active} onClose={close} onNavigate={onNavigate} /> : null}
    </Ctx.Provider>
  );
}

export function useOperations(): OperationsApi {
  const v = useContext(Ctx);
  if (v === null) {
    throw new Error("useOperations must be used inside <OperationsProvider>");
  }
  return v;
}
