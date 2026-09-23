// React view over `address-provenance.ts`, kept separate so the provenance set
// itself stays importable from non-React code (the keychain and the operations
// drawer both mark derivations without touching React).

import { useSyncExternalStore } from "react";
import {
  derivedAddressesRevision,
  isAddressDerived,
  subscribeDerivedAddresses,
} from "./address-provenance";

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

/**
 * Re-render when the provenance set changes, for a surface asking about MANY
 * addresses at once (a vault list). Hooks cannot be called per row, so this
 * subscribes once and the caller uses `isAddressDerived` directly.
 *
 * The returned number is a MONOTONIC revision, not the set's size. A size is a
 * colliding snapshot: clear-then-derive returns to the same count, and
 * `useSyncExternalStore` compares with `Object.is`, so React would bail out of
 * the re-render and leave a row showing an affordance for an address no longer
 * in the set.
 *
 * Never gate a publication on this value — "something changed" is not "THIS
 * address was derived".
 */
export function useDerivedAddressesVersion(): number {
  return useSyncExternalStore(subscribeDerivedAddresses, derivedAddressesRevision, () => 0);
}
