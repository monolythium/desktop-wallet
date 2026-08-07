// React view over `address-provenance.ts`, kept separate so the provenance set
// itself stays importable from non-React code (the keychain and the operations
// drawer both mark derivations without touching React).

import { useSyncExternalStore } from "react";
import { isAddressDerived, subscribeDerivedAddresses } from "./address-provenance";

/**
 * True only when this process watched a derivation produce `addressHex`.
 *
 * Re-renders when a derivation lands (so a surface gated on this reveals itself
 * the moment the user proves the passphrase) and when the set is cleared on
 * lock. `null`/`undefined`/unknown all answer `false`.
 */
export function useAddressDerived(addressHex: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeDerivedAddresses,
    () => isAddressDerived(addressHex),
    // Server snapshot: nothing is derived before hydration, and the fail
    // direction says unknown is unverified.
    () => false,
  );
}
