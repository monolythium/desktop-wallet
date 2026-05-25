// x402 bridge — per-request agent payments. Vendors set a policy with
// origin allowlist + asset list + per-request cap; consumers pay through
// the policy with the wallet that owns the agent.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as X402CallError };

export interface X402Policy {
  vendor_id: string;
  wallet_name: string;
  origin_allowlist: string[];
  allowed_assets: string[];
  /** Per-asset atomic-unit cap, e.g. `{"8453:USDC":"5000000"}` for $5. */
  max_payment_per_request: Record<string, string>;
  notes?: string | null;
}

export interface X402PayInput {
  vendor_id: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  asset_symbol_hint?: string | null;
  dry_run?: boolean | null;
}

const SURFACE = "x402 payments";

export async function x402PolicySet(input: X402Policy): Promise<unknown> {
  return callStele<unknown>("stele_x402_policy_set", { input }, SURFACE);
}

export async function x402PolicyList(): Promise<unknown> {
  return callStele<unknown>("stele_x402_policy_list", undefined, SURFACE);
}

export async function x402PolicyGet(vendorId: string): Promise<unknown> {
  return callStele<unknown>("stele_x402_policy_get", { vendorId }, SURFACE);
}

export async function x402PolicyRemove(vendorId: string): Promise<unknown> {
  return callStele<unknown>("stele_x402_policy_remove", { vendorId }, SURFACE);
}

export async function x402Pay(input: X402PayInput): Promise<unknown> {
  return callStele<unknown>("stele_x402_pay", { input }, SURFACE);
}
