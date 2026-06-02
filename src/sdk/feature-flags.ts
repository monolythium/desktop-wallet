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

// Experimental surfaces preview flag — DEFAULT OFF.
//
// Single switch for the not-yet-stable wallet surfaces: the Agents
// (agent commerce / spending-policy sub-accounts) page, the bridge
// per-route risk panel, and the Stake autovote planner. When off, every
// one of those entry points is hidden / not mounted and the wallet's
// visible behavior matches the pre-preview surface. Absence of the key
// reads as off, so the default for every install is off.
export const EXPERIMENTAL_ENABLED_KEY = "wallet.experimentalEnabled";

export function readExperimentalEnabled(): boolean {
  try {
    return localStorage.getItem(EXPERIMENTAL_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeExperimentalEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(EXPERIMENTAL_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}

// Incoming-transfer OS-toast flag — DEFAULT ON, fail-open.
//
// Gates ONLY the OS toast raised when LYTH arrives. The in-app notification
// record is always written and always counts toward the bell badge regardless
// of this flag. Absence of the key reads as ON, and any storage error fails
// open, so the toast is on unless the user explicitly turned it off.
export const INCOMING_ENABLED_KEY = "wallet.incomingTransfersEnabled";

export function readIncomingEnabled(): boolean {
  try {
    return localStorage.getItem(INCOMING_ENABLED_KEY) !== "false";
  } catch {
    return true; // fail-open
  }
}

export function writeIncomingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(INCOMING_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}
