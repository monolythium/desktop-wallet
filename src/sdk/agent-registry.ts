// Agent sub-account registry — tracks which keychain slots are §18.8 agent
// sub-accounts (a fresh ML-DSA-65 keypair the principal controls), separate
// from the main wallet vault catalog.
//
// We keep this out of `vaultCatalog.ts` on purpose: agent sub-accounts are
// a distinct concept (a delegated-spend identity bound to a principal), and
// the in-flight Stele merge already churns the catalog. A dedicated store
// avoids a schema collision and keeps the agent surface self-contained.
//
// The registry stores ONLY non-secret metadata (slot, label, addresses,
// the controlling principal). Key material lives in the OS keychain under
// `slot`; the encrypted vault blob owns the seed. No seed ever lands here.

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { WalletStore } from "./wallet-store";
import { requireTypedUserAddressHex } from "./address";

export const STORE_ID = "agents";
const STATE_KEY = "state";

/** Longest label the create form will write; anything longer on read is a value
 *  this wallet did not produce. */
const MAX_LABEL_LENGTH = 64;
const ADDRESS_HEX = /^0x[0-9a-f]{40}$/;

export interface AgentEntry {
  /** Keychain account slot the agent vault lives under. */
  slot: string;
  /** User-facing label / purpose (e.g. "Travel booking agent"). */
  label: string;
  /** Agent internal 20-byte address (`0x…`). */
  addressHex: string;
  /** Agent typed `mono` bech32m address (funding + policy target). */
  bech32m: string;
  /** Principal `mono` bech32m address that controls this agent. */
  principalBech32m: string;
  createdAt: number;
}

interface AgentRegistryState {
  version: 1;
  agents: Record<string, AgentEntry>;
}

const EMPTY: AgentRegistryState = { version: 1, agents: {} };

let storePromise: Promise<WalletStore> | null = null;

async function getStore(): Promise<WalletStore> {
  if (!storePromise) {
    storePromise = WalletStore.load(STORE_ID);
  }
  return storePromise;
}

/**
 * Validate one stored entry. Returns `null` for anything this wallet would not
 * have written, so a malformed record is dropped rather than cast.
 *
 * WHAT THIS DOES AND DOES NOT CLOSE, because the distinction is the finding.
 * `bech32m` is a transaction target. Validation rejects CORRUPTION — a garbage
 * string, a raw `0x`, a truncated address, an entry whose two encodings of the
 * same address disagree. It does NOT reject SUBSTITUTION: a well-formed address
 * the attacker controls is a well-formed address, and no amount of parsing tells
 * it apart from the user's own. Ownership is proved elsewhere, by re-deriving
 * from the keychain slot — see `agent-ownership.ts`.
 *
 * The internal cross-check is worth having anyway and costs nothing: the record
 * carries the SAME address twice, as `addressHex` and as `bech32m`, written from
 * one derivation. Nothing read either field until now, so the two could disagree
 * with nothing to notice — and an attacker editing only the funding target
 * produces exactly that disagreement.
 */
export function parseAgentEntry(raw: unknown): AgentEntry | null {
  if (raw === null || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;

  if (typeof e.slot !== "string" || e.slot.trim() === "") return null;
  if (typeof e.label !== "string") return null;
  const label = e.label.trim();
  if (label === "" || label.length > MAX_LABEL_LENGTH) return null;

  // `createdAt` orders the list. `undefined` yielded NaN from the comparator,
  // which makes the ordering implementation-defined rather than merely wrong.
  if (typeof e.createdAt !== "number" || !Number.isFinite(e.createdAt)) return null;

  if (typeof e.addressHex !== "string") return null;
  const addressHex = e.addressHex.toLowerCase();
  if (!ADDRESS_HEX.test(addressHex)) return null;

  if (typeof e.bech32m !== "string") return null;
  // Both directions: the string parses as a typed user address, AND it is the
  // one this record's own hex encodes to.
  try {
    requireTypedUserAddressHex(e.bech32m, "agent");
  } catch {
    return null;
  }
  if (e.bech32m !== addressToTypedBech32("user", addressHex)) return null;

  // Written as `principalBech32m ?? ""`, so empty is a value this wallet
  // produces. A non-empty one must be a real typed address.
  if (typeof e.principalBech32m !== "string") return null;
  if (e.principalBech32m !== "") {
    try {
      requireTypedUserAddressHex(e.principalBech32m, "principal");
    } catch {
      return null;
    }
  }

  return {
    slot: e.slot,
    label,
    addressHex,
    bech32m: e.bech32m,
    principalBech32m: e.principalBech32m,
    createdAt: e.createdAt,
  };
}

export async function loadAgents(): Promise<AgentEntry[]> {
  const store = await getStore();
  const raw = await store.get<AgentRegistryState>(STATE_KEY);
  if (!raw || typeof raw !== "object" || !raw.agents) return [];
  // Drop rather than cast. An agent whose record this wallet cannot vouch for is
  // not an agent the user can fund — and a list that silently omits a corrupted
  // row is safer than one that offers a Fund button beside it.
  return Object.values(raw.agents)
    .map((entry) => parseAgentEntry(entry))
    .filter((entry): entry is AgentEntry => entry !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function registerAgent(
  entry: Omit<AgentEntry, "createdAt">,
): Promise<void> {
  const store = await getStore();
  const raw = (await store.get<AgentRegistryState>(STATE_KEY)) ?? { ...EMPTY };
  const agents = raw.agents ?? {};
  agents[entry.slot] = {
    ...entry,
    addressHex: entry.addressHex.toLowerCase(),
    createdAt: Date.now(),
  };
  await store.set(STATE_KEY, { version: 1, agents });
  await store.save();
}

export async function removeAgent(slot: string): Promise<void> {
  const store = await getStore();
  const raw = await store.get<AgentRegistryState>(STATE_KEY);
  if (!raw || !raw.agents || !(slot in raw.agents)) return;
  delete raw.agents[slot];
  await store.set(STATE_KEY, { version: 1, agents: raw.agents });
  await store.save();
}
