// Proving an agent sub-account is one the user actually controls.
//
// THE PROBLEM. The agent registry store is plaintext JSON anything running as
// this OS user can write (the file name is Rust's business — see
// `wallet_store.rs`, and the guard that keeps it that way, which caught an
// earlier draft of this comment). `bech32m` is a transaction target: it reaches
// `fundAgentSubAccount` and the policy calldata with no check but
// well-formedness. `requireTypedUserAddressHex` sits exactly where an ownership
// check is needed and answers a different question — a valid attacker address is
// a valid address. Parsing rejects corruption, never substitution.
//
// WHY NOT AN INTEGRITY TAG HERE. The wallet owns a seed-derived HMAC
// (`sent-recipients.ts`), and it is the obvious reach. It does not fit this
// record's lifecycle: the tag would have to be written when the agent is
// created, and agent creation unlocks only the AGENT's vault — the principal's
// seed, which is the only key worth tagging under, is not in hand at that
// moment. Tagging later, at the first funding, would bless whatever is on disk
// by then, which is the laundering move this audit keeps refusing.
//
// WHAT IS ACTUALLY AVAILABLE. An agent sub-account is a fresh ML-DSA-65 keypair
// in its own keychain slot — NOT a derivation of the principal, so the principal
// seed cannot reproduce it. But the agent's own vault can, and the wallet
// already unlocks it to sign a policy claim. So ownership is proved the way the
// finding's own fix direction names: re-derive from the slot and compare.
//
// The proof is recorded in R6's per-process provenance set, so it is asked for
// once per session rather than once per action, and it evaporates on lock along
// with every other derivation. Nothing is persisted: a "verified" flag on disk
// would sit in the same attacker-writable store as the value it vouches for.

import { fetchAndUnlockVault } from "./keychain";
import { withSigningBackend } from "./signing-backend";
import { isAddressDerived, markAddressDerived } from "./address-provenance";
import type { AgentEntry } from "./agent-registry";

export type AgentProofOutcome =
  /** The vault under `slot` derives exactly the address the record claims. */
  | { kind: "proved"; addressHex: string }
  /** The vault opened, and derives a DIFFERENT address than the record claims.
   *  This is the planted-registry case, and it is not a password problem. */
  | { kind: "mismatch"; derivedHex: string; claimedHex: string }
  | { kind: "wrong-password" }
  | { kind: "failed"; message: string };

/**
 * True when this process has already watched a derivation produce the agent's
 * claimed address. Unknown means unproved — there is no path by which a lookup
 * failure reports an agent as owned.
 */
export function isAgentAddressProven(agent: Pick<AgentEntry, "addressHex">): boolean {
  return isAddressDerived(agent.addressHex);
}

/**
 * Unlock the agent's own vault and check that it derives the address the
 * registry claims for it.
 *
 * On success the address joins the provenance set, so the rest of the session
 * can fund this agent without asking again. On mismatch nothing is recorded —
 * and the caller must treat that as hostile data, not as a typo.
 */
export async function proveAgentAddress(
  agent: Pick<AgentEntry, "slot" | "addressHex">,
  password: string,
): Promise<AgentProofOutcome> {
  let seed: Uint8Array | null = null;
  try {
    seed = await fetchAndUnlockVault(agent.slot, password);
    const derivedHex = withSigningBackend(seed, (backend) =>
      backend.getAddress().toLowerCase(),
    );
    // Zeroed the moment the derivation is done — it was fetched for nothing
    // else. The `finally` remains the backstop for the paths that never reach
    // here.
    seed.fill(0);
    const claimedHex = agent.addressHex.toLowerCase();
    if (derivedHex !== claimedHex) {
      return { kind: "mismatch", derivedHex, claimedHex };
    }
    markAddressDerived(derivedHex);
    return { kind: "proved", addressHex: derivedHex };
  } catch (cause) {
    const message = (cause as Error)?.message ?? String(cause);
    // A wrong passphrase is the expected failure and is distinguished so the UI
    // can re-prompt rather than accusing the user's data of being tampered with.
    if (/decrypt|password|MAC|authentication/i.test(message)) {
      return { kind: "wrong-password" };
    }
    return { kind: "failed", message };
  } finally {
    seed?.fill(0);
  }
}

/** What the user is told when the slot derives a different address. Deliberately
 *  not phrased as a possible mistake of theirs. */
export const AGENT_MISMATCH_MESSAGE =
  "This agent's stored address is not the one its vault produces. The record on " +
  "this device has been changed. Funding is blocked — do not send to it.";
