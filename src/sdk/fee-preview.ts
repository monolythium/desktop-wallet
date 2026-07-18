// In-compose fee preview.
//
// Fetches the live execution-unit quote ONCE per compose open and expands it into
// the dual-fee result (§3) at every tier. The compose surface reuses this bundle
// for tier switches with no refetch: the DISPLAYED charge, the RESERVATION that
// backs Max + the affordability gate, and the byte-identical `signedFee` all
// derive from it. There is no separate "max fee" model any more — the honest
// charge is the headline (native) and the reservation is honestly labelled
// "(max)" (token), both from one quote.

import { RpcClient } from "@monolythium/core-sdk";
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
