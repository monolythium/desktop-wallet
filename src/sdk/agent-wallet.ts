// Agent-wallet bridge — sub-accounts under the user's identity that can
// transact within capped limits ("low-value" mode + spending policy).
//
// Naming convention: `<label>.agent.<parent>.mono`. The `name` field
// here is the bare label; lyth_mcp registers it under the parent
// identity that owns the user's primary wallet.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as AgentWalletCallError };

export interface AgentWalletCreateInput {
  name: string;
  purpose: string;
  max_balance?: string | null;
  low_value_max_amount?: string | null;
  low_value_daily_limit?: string | null;
  allowed_categories?: string[] | null;
  allowed_counterparties?: string[] | null;
  expires_at?: string | null;
  fallback_approval?: "passphrase" | "wallet_handoff" | "deny" | null;
}

export interface AgentWalletLimitsInput {
  name: string;
  max_balance?: string | null;
  low_value_max_amount?: string | null;
  low_value_daily_limit?: string | null;
  allowed_categories?: string[] | null;
  allowed_counterparties?: string[] | null;
  expires_at?: string | null;
  fallback_approval?: "passphrase" | "wallet_handoff" | "deny" | null;
}

const SURFACE = "Agent wallets";

export async function agentWalletCreate(input: AgentWalletCreateInput): Promise<unknown> {
  return callStele<unknown>("stele_agent_wallet_create", { input }, SURFACE);
}

export async function agentWalletList(): Promise<unknown> {
  return callStele<unknown>("stele_agent_wallet_list", undefined, SURFACE);
}

export async function agentWalletLimits(input: AgentWalletLimitsInput): Promise<unknown> {
  return callStele<unknown>("stele_agent_wallet_limits", { input }, SURFACE);
}

export async function agentWalletPause(name: string): Promise<unknown> {
  return callStele<unknown>("stele_agent_wallet_pause", { name }, SURFACE);
}

export async function agentWalletDelete(name: string, confirmName: string): Promise<unknown> {
  return callStele<unknown>("stele_agent_wallet_delete", { name, confirmName }, SURFACE);
}
