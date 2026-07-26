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

import { deleteAccount, deriveAddressHexFromMnemonic } from "./keychain";
import { loadCatalog, removeVaultFromCatalog } from "./vaultCatalog";
import { wipeAllLocalWalletState } from "./wipe-local-state";

/** The word the user must type to confirm a destructive wallet reset. */
export const RESET_CONFIRM_WORD = "RESET";

/** The fourth clause of the destructive-copy law, rendered on BOTH reset
 *  surfaces. The other three — device-scope permanence, funds stay on-chain,
 *  the phrase is the only way back — are already stated; this one was merely
 *  implied, and it is the part a user is most likely to assume is untrue. */
export const NON_CUSTODIAL_RESET_NOTE =
  "Monolythium is non-custodial: no one — including Monolythium — can recover your wallet, password, or funds for you.";

/** True when `input` matches the reset confirm word, ignoring surrounding
 *  whitespace and case. */
export function resetConfirmMatches(input: string): boolean {
  return input.trim().toUpperCase() === RESET_CONFIRM_WORD;
}

/**
 * Possession proof required (in ADDITION to typing RESET) before the destructive
 * wipe: the user must enter a recovery phrase that proves they can restore
 * afterward, so a user who never backed up their phrase can't erase the only
 * local copy — while a phrase-holding user who forgot the password still can
 * (the wipe never decrypts, so this runs on the lock screen too).
 *
 * When the active vault's address is known, the entered phrase must derive it
 * exactly (this phrase is THIS vault's). When it isn't (a legacy vault never
 * unlocked, so there's no address to compare), a valid BIP-39 phrase is the best
 * proof available. An invalid phrase never passes. Case-insensitive.
 */
export function resetPhraseProofMatches(
  mnemonic: string,
  expectedAddressHex: string | null,
): boolean {
  const derived = deriveAddressHexFromMnemonic(mnemonic);
  if (derived === null) return false;
  return expectedAddressHex ? derived === expectedAddressHex.toLowerCase() : true;
}

/** Erase every vault from this device AND every local trace this wallet wrote,
 *  then reload so the boot probe re-runs and routes to onboarding. On-chain
 *  funds are untouched.
 *
 *  Order matters: vaults first (a keychain failure must abort before a catalog
 *  row is orphaned), then the residue sweep, then the reload. The sweep is
 *  best-effort and never throws — by the time it runs the vaults are gone, so
 *  failing to reach the reload would strand the user in a half-torn-down shell
 *  with no wallet and no way forward. */
export async function resetWalletOnThisDevice(): Promise<void> {
  const catalog = await loadCatalog().catch(() => null);
  const slots = catalog ? Object.keys(catalog.vaults) : [];
  for (const slot of slots) {
    // Wipe the encrypted blob first, then drop the catalog entry — a keychain
    // failure aborts before we orphan a row.
    await deleteAccount(slot);
    await removeVaultFromCatalog(slot);
  }
  // Everything else this wallet wrote locally: every registered store file and
  // every wallet-owned localStorage key bar the display preferences. Without
  // this the device stays readable — contacts, who was paid, transaction
  // history — to whoever uses it next.
  try {
    await wipeAllLocalWalletState();
  } catch {
    // Defensive: the sweep already swallows its own failures. Even a bug in it
    // must not cost the reload.
  }
  // Reload so the boot probe re-runs: with no vault left it routes to onboarding
  // (the fresh-install state).
  window.location.reload();
}
