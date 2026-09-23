// Finding — and re-adopting — a vault the catalog has lost track of.
//
// The sealed blobs live in the OS credential store; the catalog only NAMES
// them. When the two disagree the store is the one holding the money, and two
// measured ways they disagree are a torn catalog write (which reads back as an
// EMPTY catalog, sending a funded wallet into first-run onboarding) and a
// credential written under a bundle identifier the app no longer uses.
//
// This module is the CAPABILITY, not a screen. Deciding when to offer recovery,
// and how to describe it, is a product decision; what was missing was any way
// to ask the question at all.
//
// The three-outcome discipline is the whole point of the shape below. An
// enumeration that could not run must never be readable as "no vaults found" —
// that is the original defect wearing a different face, because an orphaned
// slot would look absent and the user would be told their wallet does not
// exist. `unsupported` and `unavailable` carry no account list, so there is no
// way to receive an empty array except from `enumerated`.

import { invoke } from "@tauri-apps/api/core";
import { fetchAndUnlockVault } from "./keychain";
import { withSigningBackend } from "./signing-backend";
import { markAddressDerived } from "./address-provenance";
import { listVaults, registerVault } from "./vaultCatalog";

/** One credential, by name. Never carries secret material. */
export interface StoredAccount {
  service: string;
  account: string;
}

/** The result of looking in the credential store. */
export type CredentialScan =
  /** Definitive — an empty `accounts` here really does mean none. */
  | { outcome: "enumerated"; accounts: StoredAccount[] }
  /** Enumeration is not implemented on this platform. Not an answer. */
  | { outcome: "unsupported"; platform: string }
  /** Enumeration was attempted and failed. Not an answer. */
  | { outcome: "unavailable"; message: string };

/**
 * Every credential the wallet recognises, by name.
 *
 * An IPC failure becomes `unavailable` rather than an empty list, so a caller
 * cannot mistake "could not look" for "nothing there".
 */
export async function listStoredAccounts(): Promise<CredentialScan> {
  try {
    return await invoke<CredentialScan>("keychain_list_accounts");
  } catch (cause) {
    return { outcome: "unavailable", message: String(cause) };
  }
}

/**
 * Wallet slots the credential store holds that the catalog does not name.
 *
 * The catalog is read here rather than passed in, so a caller cannot ask the
 * question against a stale list — the comparison is always against what the
 * catalog says right now.
 */
export async function findOrphanedSlots(): Promise<CredentialScan> {
  let catalogSlots: string[];
  try {
    catalogSlots = (await listVaults()).map((v) => v.slot);
  } catch (cause) {
    // A catalog that cannot be read is exactly the torn-write case, and it is
    // NOT an empty catalog. Refusing to answer is right: treating it as empty
    // would report every real vault as an orphan.
    return { outcome: "unavailable", message: `catalog unreadable: ${String(cause)}` };
  }
  try {
    return await invoke<CredentialScan>("keychain_orphaned_slots", { catalogSlots });
  } catch (cause) {
    return { outcome: "unavailable", message: String(cause) };
  }
}

/** What a recovery attempt produced. */
export type RecoverOutcome =
  | { kind: "recovered"; slot: string; addressHex: string }
  | { kind: "wrong-password" }
  | { kind: "failed"; message: string };

/**
 * Re-adopt a discovered slot into the catalog.
 *
 * Every piece of this already existed — unlocking by an arbitrary account name
 * has always worked, and `registerVault` has always been able to add a row.
 * What was missing was knowing the name to pass. So recovery is: enumerate to
 * learn the slot, unlock it to prove the passphrase and derive its address,
 * then write the catalog row.
 *
 * The passphrase is required and that is deliberate: re-adopting a slot without
 * it would let anyone with local access add someone else's vault to the visible
 * list. Unlocking also produces the address, so the recovered row is complete
 * rather than carrying a null the UI would have to explain.
 *
 * The seed is zeroed here and the derived key is disposed by the helper — a
 * recovery must not be the one path that leaves key material behind.
 */
export async function recoverSlotIntoCatalog(
  slot: string,
  password: string,
  name: string,
): Promise<RecoverOutcome> {
  let seed: Uint8Array | null = null;
  try {
    seed = await fetchAndUnlockVault(slot, password);
    const addressHex = withSigningBackend(seed, (backend) =>
      backend.getAddress().toLowerCase(),
    );
    markAddressDerived(addressHex);
    await registerVault({ slot, name, addressHex });
    return { kind: "recovered", slot, addressHex };
  } catch (cause) {
    const message = (cause as Error)?.message ?? String(cause);
    // A wrong passphrase is the expected failure and is distinguished, so a UI
    // can re-prompt rather than telling the user the vault is unrecoverable.
    if (/decrypt|password|MAC|authentication/i.test(message)) {
      return { kind: "wrong-password" };
    }
    return { kind: "failed", message };
  } finally {
    seed?.fill(0);
  }
}
