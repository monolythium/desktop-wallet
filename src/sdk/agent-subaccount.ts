// Agent sub-account lifecycle seam (WP §18.8).
//
// An "agent sub-account" is a SECOND PQM-1 / ML-DSA-65 keypair the
// principal wallet controls — a fresh vault slot, not a derivation of the
// principal. Its lifecycle:
//
//   1. create  — mint a fresh PQM-1 mnemonic + ML-DSA-65 seed in its own
//                 keychain slot (reuses `keychain.createAndStoreVault`).
//   2. fund    — an ORDINARY native LYTH transfer from the principal to the
//                 sub-account address (reuses `native-send.sendNativeLyth`).
//   3. register — the principal binds a spending policy to the sub-account
//                 via `setPolicyClaim`, which requires the sub-account's OWN
//                 pubkey + a claim-bound signature (see `signClaimAsSubAccount`).
//
// The sub-account seed is needed transiently in two places: at create time
// (to derive its address before storing) and at register time (to produce
// the claim signature). Both paths zeroize the seed after use.

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import { createAndStoreVault } from "./keychain";
import { mintVaultSlot } from "./vaultCatalog";
import { sendNativeLyth } from "./native-send";
import { composePolicyClaimMessage } from "./spending-policy";
import type { SpendingPolicyArgs } from "@monolythium/core-sdk";

export interface CreateAgentSubAccountResult {
  /** Keychain slot the fresh agent vault lives under. */
  slot: string;
  /** The fresh PQM-1 mnemonic (show + back up once, never persisted plain). */
  mnemonic: string;
  /** Internal 20-byte address (`0x…`). */
  addressHex: string;
  /** Typed `mono` bech32m address (the funding + policy target). */
  bech32m: string;
}

/**
 * Mint a fresh agent sub-account: a brand-new PQM-1 mnemonic + ML-DSA-65
 * seed under a freshly-minted keychain slot. The principal controls it (it
 * is a separate key the user owns), but it carries its own seed so it can
 * sign the §18.8 policy claim. The caller is responsible for registering
 * the returned slot in the vault catalog with an agent label.
 */
export async function createAgentSubAccount(
  password: string,
): Promise<CreateAgentSubAccountResult> {
  const slot = mintVaultSlot();
  const { mnemonic, addressHex } = await createAndStoreVault(slot, password);
  return {
    slot,
    mnemonic,
    addressHex,
    bech32m: addressToTypedBech32("user", addressHex),
  };
}

export interface FundAgentSubAccountArgs {
  /** Principal vault seed (unlocked by the OperationsDrawer). */
  seed: Uint8Array;
  /** Typed `mono` bech32m sub-account address to fund. */
  toBech32m: string;
  /** Whole-or-decimal LYTH amount to transfer. */
  amountLyth: string;
}

/**
 * Fund an agent sub-account with a plain native LYTH transfer from the
 * principal. There is no special funding primitive — the sub-account is a
 * normal account, so this is a thin wrapper over `sendNativeLyth`.
 */
export async function fundAgentSubAccount(args: FundAgentSubAccountArgs) {
  return sendNativeLyth({
    seed: args.seed,
    to: args.toBech32m,
    amountLyth: args.amountLyth,
  });
}

export interface SubAccountClaimSignature {
  /** The sub-account's ML-DSA-65 public key (1952 bytes). */
  pubkey: Uint8Array;
  /** The sub-account's signature over the claim-bound message (3309 bytes). */
  sig: Uint8Array;
}

/**
 * Produce the sub-account half of the `setPolicyClaim` two-key dance: derive
 * the sub-account backend from its (transient) seed, return its public key
 * and its signature over `composePolicyClaimMessage(args)`. The seed is
 * zeroized before returning — callers must NOT pass a seed they still need.
 *
 * The principal then submits `setPolicyClaim(args, pubkey, sig)` via
 * `submitSpendingPolicyTx` with the principal seed.
 */
export function signClaimAsSubAccount(
  subAccountSeed: Uint8Array,
  args: SpendingPolicyArgs,
): SubAccountClaimSignature {
  try {
    const backend = MlDsa65Backend.fromSeed(subAccountSeed);
    const pubkey = backend.publicKey();
    const message = composePolicyClaimMessage(args);
    const sig = backend.sign(message);
    return { pubkey, sig };
  } finally {
    subAccountSeed.fill(0);
  }
}
