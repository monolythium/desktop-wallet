// Convert (ChangeNow) — crypto + fiat off-ramp proxies through the
// Stele sidecar. Same shared envelope as the other Stele wrappers.

import { callStele, SteleProxyCallError } from "./stele-base";

export { SteleProxyCallError as ConvertCallError };

export interface ConvertEstimateInput {
  from_currency: string;
  to_currency: string;
  from_amount?: number | null;
  to_amount?: number | null;
  flow?: "standard" | "fixed-rate";
  from_network?: string | null;
  to_network?: string | null;
}

export interface ConvertCreateInput {
  from_currency: string;
  to_currency: string;
  from_amount: number;
  payout_address: string;
  payout_extra_id?: string | null;
  refund_address?: string | null;
  flow?: "standard" | "fixed-rate";
  rate_id?: string | null;
  from_network?: string | null;
  to_network?: string | null;
}

const SURFACE = "Convert";

export async function convertEstimate(input: ConvertEstimateInput): Promise<unknown> {
  return callStele<unknown>("stele_convert_estimate", { input }, SURFACE);
}

export async function convertCreate(input: ConvertCreateInput): Promise<unknown> {
  return callStele<unknown>("stele_convert_create", { input }, SURFACE);
}

export async function convertStatus(swapId: string): Promise<unknown> {
  return callStele<unknown>("stele_convert_status", { swapId }, SURFACE);
}

export async function convertHistory(limit?: number, offset?: number): Promise<unknown> {
  return callStele<unknown>(
    "stele_convert_history",
    { input: { limit: limit ?? null, offset: offset ?? null } },
    SURFACE,
  );
}
