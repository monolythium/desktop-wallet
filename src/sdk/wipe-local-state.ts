// Default-deny local wipe — everything this wallet wrote to this device.
//
// The reset used to delete each vault's keychain blob and catalog entry and
// stop there. That left the device readable: the address book, who this wallet
// had paid, resolved counterparty names, transaction history, the endpoint and
// chain configuration, the feature flags. "The wallet is gone" and "the wallet
// is gone but the next person can read who you paid" are very different
// outcomes, and only the first is what a reset promises.
//
// Two mechanisms, because the two storage kinds behave differently:
//
//   localStorage is ENUMERATED by prefix. Every key this wallet writes begins
//   `wallet.` — including the dynamic families (`wallet.myNames.<owner>`,
//   `wallet.nameNudge.<addr>`) — so sweeping the prefix catches key families
//   added later without anyone remembering to update a list. That is the point:
//   an explicit delete list would silently miss whatever ships next.
//
//   Tauri stores are separate FILES, so no enumeration reaches them. Each one
//   must be named. THE STANDING DISCIPLINE: a new store registers here, in
//   STORE_FILES, or its contents survive a reset. That is not hypothetical —
//   the specification this implements listed four stores when ten existed, and
//   the six it omitted included who the wallet had paid and its transaction
//   history.
//
// Each clear is independently guarded. By the time this runs the vaults are
// already deleted, so a throw partway through would leave the user with no
// wallet AND the residue intact, stranded in a half-torn-down shell. One
// failing store must not stop the others, and must not stop the reload.

import { Store } from "@tauri-apps/plugin-store";
import { STORE_FILE as ACTIVITY_STORE } from "./activity-cache-store";
import { STORE_FILE as ADDRESSBOOK_STORE } from "./addressbook";
import { STORE_FILE as AGENTS_STORE } from "./agent-registry";
import { STORE_FILE as CHAIN_HEALTH_STORE } from "./chain-health-store";
import { STORE_FILE as BALANCE_STORE } from "./last-known-balance";
import { STORE_FILE as NOTIFICATIONS_STORE } from "./notifications-store";
import { STORE_FILE as PENDING_TX_STORE } from "./pending-tx-store";
import { STORE_FILE as NAMES_STORE } from "./reverse-name-cache";
import { STORE_FILE as SENT_RECIPIENTS_STORE } from "./sent-recipients-store";
import { STORE_FILE as VAULTS_STORE } from "./vaultCatalog";

/** The prefix every wallet-owned localStorage key carries. */
export const WALLET_KEY_PREFIX = "wallet.";

/**
 * Keys that deliberately SURVIVE a reset.
 *
 * All five are chosen on the pre-wallet Welcome panel, before any wallet
 * exists, and carry no identity or financial linkage — they describe how the
 * app looks and reads, not who used it.
 *
 * `language` and `displayCurrency` are here for exactly the reason the first
 * three are: they sit beside the theme picker on that same panel. Keeping the
 * palette while silently dropping the language would be an arbitrary split the
 * user would notice only by finding the app back in the wrong language.
 */
export const WIPE_EXCEPT_KEYS: readonly string[] = [
  "wallet.theme",
  "wallet.layout",
  "wallet.sidebarCollapsed",
  "wallet.language",
  "wallet.displayCurrency",
];

/**
 * Every Tauri store file this wallet writes, and what each holds.
 *
 * REGISTER NEW STORES HERE. A store absent from this list survives a reset.
 */
export const STORE_FILES: readonly string[] = [
  VAULTS_STORE, // vault catalog: slots, names, addresses
  ADDRESSBOOK_STORE, // saved contacts
  NOTIFICATIONS_STORE, // notification history, dedupe sets, incoming watermarks
  ACTIVITY_STORE, // cached confirmed activity rows
  CHAIN_HEALTH_STORE, // warm-start chain heads
  SENT_RECIPIENTS_STORE, // who this wallet has paid
  NAMES_STORE, // resolved reverse names for counterparties
  PENDING_TX_STORE, // in-flight and recently-terminal transactions
  BALANCE_STORE, // last-known balance per scope
  AGENTS_STORE, // agent sub-vault registrations
];

/** Wallet-owned localStorage keys currently present, minus the exceptions. */
export function walletKeysToWipe(keys: readonly string[]): string[] {
  return keys.filter(
    (k) => k.startsWith(WALLET_KEY_PREFIX) && !WIPE_EXCEPT_KEYS.includes(k),
  );
}

/** Clear one store file. Never throws — the caller must keep going. */
async function clearStoreFile(file: string): Promise<boolean> {
  try {
    const store = await Store.load(file);
    await store.clear();
    await store.save();
    return true;
  } catch {
    // A store that cannot be opened or written cannot be cleared. Report it and
    // move on; aborting here would leave every later store untouched.
    return false;
  }
}

export interface WipeOutcome {
  /** Store files successfully cleared. */
  storesCleared: number;
  /** Store files that could not be cleared. */
  storesFailed: string[];
  /** localStorage keys removed. */
  keysRemoved: number;
}

/**
 * Remove every wallet-owned local trace: all registered store files, then all
 * `wallet.`-prefixed localStorage keys except the display preferences.
 *
 * Best-effort throughout and never throws. The caller has already deleted the
 * vaults, so the only thing worse than incomplete residue removal is not
 * reaching the reload.
 *
 * HONEST LIMITATION: OS-keychain blobs orphaned by wallet-remove operations in
 * older builds are not enumerable through the OS keyring API, so this cannot
 * reach them. Fixing remove-time blob deletion belongs to the wallet-management
 * work, not here.
 */
export async function wipeAllLocalWalletState(): Promise<WipeOutcome> {
  const storesFailed: string[] = [];
  let storesCleared = 0;

  // Sequential rather than parallel: the plugin opens a file handle per store,
  // and a predictable order makes a partial failure readable in a bug report.
  for (const file of STORE_FILES) {
    if (await clearStoreFile(file)) storesCleared++;
    else storesFailed.push(file);
  }

  let keysRemoved = 0;
  try {
    const present: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) present.push(key);
    }
    // Collect first, then delete — removing during enumeration reindexes.
    for (const key of walletKeysToWipe(present)) {
      try {
        localStorage.removeItem(key);
        keysRemoved++;
      } catch {
        // One unremovable key must not strand the rest.
      }
    }
  } catch {
    // localStorage unavailable entirely — nothing to sweep.
  }

  return { storesCleared, storesFailed, keysRemoved };
}
