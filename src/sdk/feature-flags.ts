// Experimental surfaces preview flag — DEFAULT OFF.
//
// Single switch for the not-yet-stable wallet surfaces: the Agents (agent
// commerce / spending-policy sub-accounts) page, AI Trading, and the bridge
// per-route risk panel. When off, those entry points are hidden / not mounted.
// (The Delegate autovote planner and the notifications + activity system have
// graduated to default-on and no longer sit behind this flag.) Absence of the
// key reads as off, so the default for every install is off.
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

// Notify-while-locked — DEFAULT OFF (opt-in). Now that notifications are a
// default-on wallet feature, the conservative default is to NOT surface tx
// toasts on a locked/unattended screen: when off, OS toasts for txs that
// resolve while the wallet is locked are suppressed; the in-app record is still
// written and surfaces on the next unlock. A user can turn it on in Settings.
export const NOTIFY_WHILE_LOCKED_KEY = "wallet.notifyWhileLocked";

export function readNotifyWhileLocked(): boolean {
  try {
    return localStorage.getItem(NOTIFY_WHILE_LOCKED_KEY) === "true";
  } catch {
    return false; // default off — don't toast on a locked screen unless opted in
  }
}

export function writeNotifyWhileLocked(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFY_WHILE_LOCKED_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage unavailable — fall through.
  }
}

// Developer mode — DEFAULT OFF, device-scoped, fail-closed.
//
// The single switch that reveals the wallet's technical surfaces: raw RPC
// endpoints, chain/genesis hashes, SDK/runtime build details, error codes, the
// RISC-V console, and Mono Studio. It describes the operator of the machine, so
// it is global — it survives lock/unlock and a wallet reset. Anything other than
// the exact string "true" reads as OFF, and a storage exception reads as OFF, so
// the read itself is the fail-closed gate with no async "resolving" window.
export const DEVELOPER_MODE_KEY = "wallet.developerMode";

// Stamped once (epoch-ms) on the FIRST successful enable, never rewritten while
// a valid value exists, never cleared on disable. Reserved for a future
// "new since you enabled this" affordance — nothing consumes it yet.
export const DEVELOPER_MODE_FIRST_SEEN_KEY = "wallet.developerModeFirstSeenAt";

export function readDeveloperMode(): boolean {
  try {
    return localStorage.getItem(DEVELOPER_MODE_KEY) === "true";
  } catch {
    return false; // fail-closed
  }
}

/** Persist the flag and report whether the write landed. The guarded enable
 *  flow awaits this result — a silently-swallowed failure is not acceptable for
 *  the enable path (disable stays best-effort at the call site). */
export function writeDeveloperMode(enabled: boolean): boolean {
  try {
    localStorage.setItem(DEVELOPER_MODE_KEY, enabled ? "true" : "false");
    return true;
  } catch {
    return false;
  }
}

/** The first-enabled timestamp, or null when absent or garbage. A non-finite or
 *  non-positive stored value is treated as absent (and re-stamped next enable). */
export function readDeveloperModeFirstSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(DEVELOPER_MODE_FIRST_SEEN_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Stamp the first-enabled timestamp, but only when none is already recorded, so
 *  an off→on→off→on cycle keeps the original stamp. Best-effort: a stamp failure
 *  never blocks the enable. */
export function stampDeveloperModeFirstSeenAt(now: number): void {
  try {
    if (readDeveloperModeFirstSeenAt() !== null) return;
    localStorage.setItem(DEVELOPER_MODE_FIRST_SEEN_KEY, String(now));
  } catch {
    // localStorage unavailable — fall through.
  }
}
