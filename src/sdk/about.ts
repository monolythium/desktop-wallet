// About-page data helpers — pure, testable derivations from the wallet's real
// runtime state. No fabricated values: every field the About page renders is
// either a live read or an honest chain-level constant. The page composes these.

import { getVersion } from "@tauri-apps/api/app";
import {
  readExperimentalEnabled,
  readIncomingEnabled,
  readNotificationDetails,
  readNotificationsEnabled,
  readNotifyWhileLocked,
  readSteleEnabled,
} from "./feature-flags";
import { readDeveloperMode } from "./studio-host";
import { TESTNET_CHAIN_ID, type ProbeResult } from "./peers";

/** Product identity — a plain self-description, no comparison to any other
 *  wallet, no "reference implementation" claim. */
export const WALLET_TITLE = "Monolythium Wallet";
export const WALLET_TAGLINE =
  "A sovereign post-quantum wallet for the Monolythium chain.";

/** True iff running inside Tauri (the same probe App/updater use). getVersion()
 *  round-trips through Tauri IPC and rejects in the browser preview. */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The running wallet version. Prefers Tauri's getVersion() (the packaged app
 *  version); falls back to the build-time package.json version baked in via the
 *  __APP_VERSION__ define for the browser preview. Never fabricated. */
export async function readWalletVersion(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      return await getVersion();
    } catch {
      // fall through to the build-time constant
    }
  }
  return __APP_VERSION__;
}

/** The user-toggleable flags surfaced as "Active features". */
export interface FeatureFlagState {
  experimental: boolean;
  stele: boolean;
  developer: boolean;
  incoming: boolean;
  notifications: boolean;
  notificationDetails: boolean;
  notifyWhileLocked: boolean;
}

/** Snapshot the current feature-flag state from its persisted sources. */
export function readFeatureFlagState(): FeatureFlagState {
  return {
    experimental: readExperimentalEnabled(),
    stele: readSteleEnabled(),
    developer: readDeveloperMode(),
    incoming: readIncomingEnabled(),
    notifications: readNotificationsEnabled(),
    notificationDetails: readNotificationDetails(),
    notifyWhileLocked: readNotifyWhileLocked(),
  };
}

export interface FeatureChip {
  id: keyof FeatureFlagState;
  label: string;
}

// The flag → label map, in a stable display order. No central registry exists
// for these, so About owns the labels.
const FEATURE_CHIPS: FeatureChip[] = [
  { id: "experimental", label: "Experimental surfaces" },
  { id: "stele", label: "Stele governance" },
  { id: "developer", label: "Developer mode" },
  { id: "incoming", label: "Incoming-transfer alerts" },
  { id: "notifications", label: "System notifications" },
  { id: "notificationDetails", label: "Details in alerts" },
  { id: "notifyWhileLocked", label: "Alerts while locked" },
];

/** The enabled feature flags as display chips, in a stable order. Pure. */
export function activeFeatureChips(state: FeatureFlagState): FeatureChip[] {
  return FEATURE_CHIPS.filter((chip) => state[chip.id]);
}

export interface OperatorsSummary {
  /** Endpoints reachable AND reporting the testnet chain id. */
  live: number;
  /** Total endpoints in the switchable catalogue. */
  total: number;
  /** Honest one-line label. */
  label: string;
}

/** Summarize peer-probe results into an honest "N of M endpoints live on chain
 *  X" figure. NOTE: probePeer verifies chain id only (never genesis), so this
 *  is a reachability / chain-match metric — NOT a genesis-"trusted" count.
 *  Pure. */
export function operatorsSummary(
  results: readonly ProbeResult[],
  total: number,
): OperatorsSummary {
  const live = results.filter((r) => r.reachable && r.chainIdOk).length;
  return {
    live,
    total,
    label: `${live} of ${total} endpoints live on chain ${TESTNET_CHAIN_ID}`,
  };
}
