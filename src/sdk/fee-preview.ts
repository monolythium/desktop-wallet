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
 */
export async function previewTransferFee(
  client: RpcClient = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions()),
): Promise<NativeFeePreview> {
  const fee = await resolveExecutionFee(client);
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
