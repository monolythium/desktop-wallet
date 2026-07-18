// In-compose fee preview.
//
// The shared submit seam (`submitNativeTx`) resolves a live execution fee at
// broadcast time via the SDK `resolveExecutionFee`. To show the fee BEFORE the
// user confirms, this resolves the SAME transfer-class fee against the live
// node quote and exposes the worst-case max fee (`maxFeePerGas × gasLimit`)
// plus the total a send of `amountLythoshi` would reserve.
//
// HONESTY: this is the MAX the chain reserves (`maxFeePerGas × gasLimit`), not
// the post-execution charge — the actual fee is `(base + tip) × units_used`
// and is only known after the tx settles. The preview is labelled as a max so
// the figure is never read as an exact charge.

import { formatLyth, resolveExecutionFee, RpcClient } from "@monolythium/core-sdk";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { getExecutionUnitQuote } from "./native-rpc";
import {
  computeNativeFeeQuote,
  NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT,
  type FeeTier,
  type NativeFeeQuote,
} from "./fee-model";
import { TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT } from "./token-send";

/** The live quote + the dual-fee result at every tier (computed once per compose
 *  open and reused for tier switches — no refetch). */
export interface FeeQuoteBundle {
  quote: { baseLythoshi: bigint; suggestedTipLythoshi: bigint; source: string };
  perTier: Record<FeeTier, NativeFeeQuote>;
}

/**
 * Fetch the execution-unit quote once and expand it into the per-tier dual-fee
 * results at the signed limit for this write class (native 30_000n / token
 * 250_000n). Throws on a failed/malformed quote — the caller renders the honest
 * fee error state, never a fabricated number. The read flows through the
 * fail-closed provider seam (an untrusted operator throws at `getProvider`).
 */
export async function previewNativeSendFee(
  client: RpcClient = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions()),
  opts: { tokenTransfer?: boolean } = {},
): Promise<FeeQuoteBundle> {
  const quote = await getExecutionUnitQuote(client);
  const limit = opts.tokenTransfer
    ? TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT
    : NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT;
  return {
    quote,
    perTier: {
      normal: computeNativeFeeQuote(quote.baseLythoshi, quote.suggestedTipLythoshi, "normal", limit),
      fast: computeNativeFeeQuote(quote.baseLythoshi, quote.suggestedTipLythoshi, "fast", limit),
    },
  };
}

export interface NativeFeePreview {
  /** Resolved per-unit price + execution-unit limit (same shape submit uses). */
  fee: ResolvedExecutionFee;
  /** Worst-case max fee in lythoshi (`maxFeePerGas × gasLimit`). */
  maxFeeLythoshi: bigint;
  /** Worst-case max fee formatted as a decimal LYTH string. */
  maxFeeLyth: string;
}

/** Compute the worst-case max fee a resolved fee implies. Pure. */
export function maxFeeLythoshiFrom(fee: ResolvedExecutionFee): bigint {
  return fee.maxFeePerGas * fee.gasLimit;
}

/**
 * Resolve the transfer-class execution fee from the live node quote and shape
 * it for the compose preview. Throws on a failed quote — the caller renders an
 * honest "fee unavailable" line rather than a fabricated number.
 *
 * `executionUnitLimit` overrides the SDK's transfer default so the shown worst-
 * case max fee matches what a heavier call (e.g. a token-factory transfer)
 * reserves at submit time — the preview stays honest instead of under-quoting.
 */
export async function previewTransferFee(
  client: RpcClient = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions()),
  executionUnitLimit?: bigint,
): Promise<NativeFeePreview> {
  const fee = await resolveExecutionFee(
    client,
    executionUnitLimit === undefined ? undefined : { executionUnitLimit },
  );
  const maxFeeLythoshi = maxFeeLythoshiFrom(fee);
  return {
    fee,
    maxFeeLythoshi,
    maxFeeLyth: formatLyth(maxFeeLythoshi.toString(), { includeUnit: false }),
  };
}

/**
 * Total a send reserves: amount + worst-case max fee, formatted as LYTH. Pure.
 * `amountLythoshi` is the send value in lythoshi.
 */
export function totalReservedLyth(amountLythoshi: bigint, maxFeeLythoshi: bigint): string {
  return formatLyth((amountLythoshi + maxFeeLythoshi).toString(), { includeUnit: false });
}
