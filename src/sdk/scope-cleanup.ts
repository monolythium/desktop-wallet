// Per-vault scoped-state cleanup.
//
// Removing a vault used to leave its per-(address, chain) scope maps behind in
// every scoped store forever (orphaned, never read again, inflating every future
// write — and leaving a removed vault's balances, tx history and resolved
// counterparty names on disk). This coordinator deletes them at once, keyed by
// the vault's bech32m address — the same address dimension those stores key on —
// derived from the catalog's stored 20-byte addressHex. Best-effort and
// exact-prefix scoped, so pruning one vault never touches another's data.
//
// The set of purges here is the SINGLE SOURCE the scoped-store invariant checks:
// every store classified `scoped` (scoped-store-invariant.test.ts) must appear
// below, and scope-cleanup.test.ts asserts each is actually invoked. Adding a
// scoped store without wiring its purge here fails the invariant.

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { purgeScopesForAddress as purgeActivity } from "./activity-cache-store";
import { purgeScopesForAddress as purgeChainHealth } from "./chain-health-store";
import { purgeScopesForAddress as purgeNotifications } from "./notifications-store";
import { purgeScopesForAddress as purgeSentRecipients } from "./sent-recipients-store";
import { purgeScopesForAddress as purgeLastKnownBalance } from "./last-known-balance";
import { purgeScopesForAddress as purgeReverseNames } from "./reverse-name-cache";
import { purgeScopesForAddress as purgePendingTxs } from "./pending-tx-store";
import { purgeNameNudgeForAddress } from "./has-name";

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
    purgeReverseNames(addressLower),
    purgePendingTxs(addressLower),
  ]);
  // Synchronous localStorage — not part of the settled set above.
  purgeNameNudgeForAddress(addressLower);
}
