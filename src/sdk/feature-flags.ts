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

// System-notifications master switch — DEFAULT ON, fail-open. Gates ALL OS
// toasts (terminal + incoming); the in-app notification records are always
// written regardless. This is the user-facing master; whether the wider
// notifications system stays behind the experimental flag is unchanged.
export const NOTIFICATIONS_ENABLED_KEY = "wallet.notificationsEnabled";

export function readNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== "false";
  } catch {
    return true; // fail-open
  }
}

export function writeNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}

// Show-transaction-details — DEFAULT ON, fail-open. When off, the OS toast text
// is redacted to the title only ("Transaction confirmed"); the in-app record
// always keeps full detail.
export const NOTIFICATION_DETAILS_KEY = "wallet.notificationDetails";

export function readNotificationDetails(): boolean {
  try {
    return localStorage.getItem(NOTIFICATION_DETAILS_KEY) !== "false";
  } catch {
    return true; // fail-open
  }
}

export function writeNotificationDetails(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFICATION_DETAILS_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}

// Notify-while-locked — DEFAULT ON, fail-open. When off, OS toasts for txs that
// resolve while the wallet is locked are suppressed; the in-app record is still
// written and surfaces on the next unlock.
export const NOTIFY_WHILE_LOCKED_KEY = "wallet.notifyWhileLocked";

export function readNotifyWhileLocked(): boolean {
  try {
    return localStorage.getItem(NOTIFY_WHILE_LOCKED_KEY) !== "false";
  } catch {
    return true; // fail-open
  }
}

export function writeNotifyWhileLocked(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFY_WHILE_LOCKED_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}
