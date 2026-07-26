// Developer-mode gate — the single source of truth every gated surface reads.
//
// App owns the lifted developer-mode state (initialised from readDeveloperMode)
// and supplies this context; consumers read `useDeveloperMode()` for the boolean
// gate and the toggle uses `useDeveloperModeControl()` for the guarded flip. No
// page re-reads storage at render time, so one flip re-renders every gated
// surface at once with no remount.
//
// The default value is fail-closed (OFF, no-op control) so a provider-less
// render — a preview or an isolated test — hides gated surfaces rather than
// crashing. The app always supplies a real value.

import { createContext, useContext } from "react";

export interface DeveloperModeControl {
  enabled: boolean;
  /**
   * Flip developer mode. Resolves `true` when the requested state is in effect.
   * Enabling persists first and resolves `false` WITHOUT flipping if the write
   * fails (so the UI can surface the failure). Disabling flips immediately and
   * persists best-effort, always resolving `true` — turning it off is never
   * blocked on storage.
   */
  setEnabled: (enabled: boolean) => Promise<boolean>;
}

const DEFAULT: DeveloperModeControl = {
  enabled: false,
  setEnabled: async () => false,
};

const DeveloperModeContext = createContext<DeveloperModeControl>(DEFAULT);

export const DeveloperModeProvider = DeveloperModeContext.Provider;

/** The developer-mode gate boolean. The one sanctioned read for gated surfaces. */
export function useDeveloperMode(): boolean {
  return useContext(DeveloperModeContext).enabled;
}

/** The full control — for the toggle only (everything else reads the boolean). */
export function useDeveloperModeControl(): DeveloperModeControl {
  return useContext(DeveloperModeContext);
}
