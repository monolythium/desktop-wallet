// Per-vault scoped-state cleanup.
//
// Removing a vault used to leave its per-(address, chain) scope maps behind in
// the notification / activity-cache / chain-health / sent-recipients stores
// forever (orphaned, never read again, inflating every future write). This
// coordinator deletes them at once, keyed by the vault's bech32m address — the same address
// dimension those stores key on — derived from the catalog's stored 20-byte
// addressHex. Best-effort and exact-prefix scoped, so pruning one vault never
// touches another's data.

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { purgeScopesForAddress as purgeActivity } from "./activity-cache-store";
import { purgeScopesForAddress as purgeChainHealth } from "./chain-health-store";
import { purgeScopesForAddress as purgeNotifications } from "./notifications-store";
import { purgeScopesForAddress as purgeSentRecipients } from "./sent-recipients-store";
import { purgeScopesForAddress as purgeLastKnownBalance } from "./last-known-balance";

/** Drop every scoped-store entry owned by the vault whose internal address is
 *  `addressHex`. A null addressHex (a vault never unlocked, no address captured)
 *  has no scoped state to purge. */
export async function purgeVaultScopes(addressHex: string | null): Promise<void> {
  if (!addressHex) return;
  let addressLower: string;
  try {
    addressLower = addressToTypedBech32("user", addressHex).toLowerCase();
  } catch {
    return; // an unparseable address has no reachable scope keys
  }
  await Promise.allSettled([
    purgeNotifications(addressLower),
    purgeActivity(addressLower),
    purgeChainHealth(addressLower),
    purgeSentRecipients(addressLower),
    purgeLastKnownBalance(addressLower),
  ]);
}
