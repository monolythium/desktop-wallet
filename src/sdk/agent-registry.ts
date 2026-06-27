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

import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "agents.v1.json";
const STATE_KEY = "state";

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

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

export async function loadAgents(): Promise<AgentEntry[]> {
  const store = await getStore();
  const raw = await store.get<AgentRegistryState>(STATE_KEY);
  if (!raw || typeof raw !== "object" || !raw.agents) return [];
  return Object.values(raw.agents).sort((a, b) => a.createdAt - b.createdAt);
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
