// Wallet reset — the single destructive "erase this device's wallet data"
// routine, shared by Settings → Reset and the lock-screen recovery escape hatch
// so both go through one audited path.
//
// It deletes every vault: each encrypted keychain blob first, then its catalog
// entry (a keychain failure aborts before a catalog row is orphaned). It does
// NOT touch on-chain state — only the recovery phrase restores the wallet. The
// final reload re-runs the boot probe, which finds no vault and routes to
// onboarding (the fresh-install state). Callable while locked: it never
// decrypts a vault, so the lock screen can offer it as a forgot-password path.

import { deleteAccount } from "./keychain";
import { loadCatalog, removeVaultFromCatalog } from "./vaultCatalog";

/** The word the user must type to confirm a destructive wallet reset. */
export const RESET_CONFIRM_WORD = "RESET";

/** True when `input` matches the reset confirm word, ignoring surrounding
 *  whitespace and case. */
export function resetConfirmMatches(input: string): boolean {
  return input.trim().toUpperCase() === RESET_CONFIRM_WORD;
}

/** Erase every vault from this device, then reload so the boot probe re-runs and
 *  routes to onboarding. On-chain funds are untouched. */
export async function resetWalletOnThisDevice(): Promise<void> {
  const catalog = await loadCatalog().catch(() => null);
  const slots = catalog ? Object.keys(catalog.vaults) : [];
  for (const slot of slots) {
    // Wipe the encrypted blob first, then drop the catalog entry — a keychain
    // failure aborts before we orphan a row.
    await deleteAccount(slot);
    await removeVaultFromCatalog(slot);
  }
  // Reload so the boot probe re-runs: with no vault left it routes to onboarding
  // (the fresh-install state).
  window.location.reload();
}
