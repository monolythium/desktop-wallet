// User-toggleable feature flags persisted to localStorage.
//
// Mirrors the read/write pattern in `studio-host.ts` for developer mode.
// Settings owns the UI; App.tsx owns the state + bounce-out when a flag
// flips off while the user is on a gated route.

export const STELE_ENABLED_KEY = "wallet.steleEnabled";

export function readSteleEnabled(): boolean {
  try {
    return localStorage.getItem(STELE_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSteleEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STELE_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}
