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

/**
 * A formatted view of a ChangeNow convert estimate. The proxy returns an
 * untyped payload, so this normalises the fields the UI shows — rate, fee, and
 * minimum received — and leaves any field the payload didn't carry as `null`
 * (the UI renders an em-dash, never a fabricated number).
 */
export interface ConvertQuoteView {
  fromCurrency: string;
  toCurrency: string;
  /** Amount sent (`fromAmount`), decimal string, when present. */
  fromAmount: string | null;
  /** Amount received (`toAmount` / `estimatedAmount`), decimal string. */
  toAmount: string | null;
  /** Derived 1:from → N:to rate, decimal string, when both amounts present. */
  rate: string | null;
  /** Network / service fee where the payload exposes one, decimal string. */
  fee: string | null;
  /** Minimum the user can convert (`minAmount`), decimal string. */
  minReceived: string | null;
  /** Speed forecast label, when present. */
  speed: string | null;
  /** Any warning the proxy attached (e.g. amount below minimum). */
  warning: string | null;
  /** Rate id for a fixed-rate flow, when present. */
  rateId: string | null;
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Compute a `1 from → N to` rate from the two leg amounts. Pure; returns null
 *  when either leg is missing or the sent amount is zero. */
export function deriveConvertRate(fromAmount: string | null, toAmount: string | null): string | null {
  if (fromAmount === null || toAmount === null) return null;
  const from = Number(fromAmount);
  const to = Number(toAmount);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  const rate = to / from;
  if (!Number.isFinite(rate)) return null;
  // Trim trailing zeros for a clean display while keeping precision for small
  // rates (sub-1 conversions like BTC→ETH).
  return rate.toLocaleString("en-US", { maximumFractionDigits: 8, useGrouping: false });
}

/**
 * Normalise a raw ChangeNow estimate payload into the formatted view the UI
 * renders. Tolerant of the proxy's untyped shape — unknown / missing fields
 * collapse to `null`. Pure and side-effect-free.
 */
export function formatConvertQuote(
  input: Pick<ConvertEstimateInput, "from_currency" | "to_currency">,
  raw: unknown,
): ConvertQuoteView {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fromAmount = pickString(record, "fromAmount", "from_amount");
  const toAmount = pickString(record, "toAmount", "to_amount", "estimatedAmount", "estimated_amount");
  return {
    fromCurrency: input.from_currency.toUpperCase(),
    toCurrency: input.to_currency.toUpperCase(),
    fromAmount,
    toAmount,
    rate: deriveConvertRate(fromAmount, toAmount),
    fee: pickString(record, "networkFee", "network_fee", "fee", "depositFee", "withdrawalFee"),
    minReceived: pickString(record, "minAmount", "min_amount", "minReceived", "min_received"),
    speed: pickString(record, "transactionSpeedForecast", "transaction_speed_forecast", "speed"),
    warning: pickString(record, "warningMessage", "warning_message", "warning"),
    rateId: pickString(record, "rateId", "rate_id", "id"),
  };
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
