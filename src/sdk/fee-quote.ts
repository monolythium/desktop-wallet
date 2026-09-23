// One quote, two consumers.
//
// THE DEFECT THIS EXISTS TO CLOSE is not that a fee is wrong. It is that the
// displayed fee and the signed fee were two independent computations over two
// independent READS. R1 measured both halves at one site: the MRC-20 row
// understated the signed ceiling by 3.00x (normal) / 2.00x (fast), and
// separately the node's `lyth_executionUnitPrice` reports a `source` that moves
// between reads (`mempool_floor` / `latest_block`) — a label the wallet only
// records and never selects, so the node decides which price a given read gets.
//
// ⇒ Unifying the FORMULA without unifying the READ reintroduces the defect.
// Two calls to the same correct function can still return two numbers.
//
// So the unit here is an OBJECT, not a function. `resolveOperationFee` performs
// exactly one read and returns a value whose display string is computed from the
// very fields that will be signed:
//
//     displayLyth === formatLyth(signed.maxFeePerGas * signed.gasLimit)
//
// There is no way to render the row from one read and sign from another without
// holding two of these objects, which is a thing a reviewer can see.
//
// WHAT IS NOT CHANGED. Every branch below produces byte-identically what the
// path already produced — the same SDK resolver, the same shared clamp, the same
// per-class limit. What moves is WHEN the read happens (before the password
// instead of after it), never what the formula is.

import {
  RpcClient,
  formatLyth,
  resolveExecutionFee,
  resolveRegistryExecutionFee,
} from "@monolythium/core-sdk";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";
import { postClampResolvedFee } from "./fee-model";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { getExecutionUnitQuote } from "./native-rpc";

/**
 * How a surface's fee is resolved.
 *
 * `transfer` / `registry` reproduce `submit.ts`'s two resolver branches exactly.
 * `mrv` reproduces `mrv.ts`'s: that seam does not route through `submitNativeTx`
 * and defaults its max price to the quote's SUMMED per-unit price rather than
 * the SDK resolver's safety-multiplied one. Folding it into `transfer` would
 * change what MRV signs, which is out of scope for this pass — so the
 * difference is named here rather than smoothed over.
 */
export type OperationFeeClass = "transfer" | "registry" | "mrv";

/** What a signing surface declares so the drawer can price it. */
export interface OperationFeePlan {
  feeClass: OperationFeeClass;
  /** The execution-unit limit this surface signs. MUST be the same constant the
   *  seam passes — never a second literal, which is how a shown/signed pair
   *  drifts back apart. */
  executionUnitLimit: bigint;
}

/**
 * One read's answer. The two fields are not two results; the second is computed
 * from the first, so they cannot disagree.
 */
export interface OperationFee {
  /** Signed VERBATIM by `submitNativeTx` (`shown == signed`). */
  readonly signed: ResolvedExecutionFee;
  /** The worst case in LYTH — `maxFeePerGas x gasLimit`, the amount admission
   *  reserves. A TOTAL, never a per-unit price: a user cannot act on a per-unit
   *  price without doing arithmetic at a consent moment. Unit-less; the caller
   *  appends " LYTH". */
  readonly displayLyth: string;
}

/** The reservation a resolved fee implies, in lythoshi. Pure. */
export function reservationLythoshi(fee: ResolvedExecutionFee): bigint {
  return fee.maxFeePerGas * fee.gasLimit;
}

/**
 * Resolve a surface's fee from EXACTLY ONE node read.
 *
 * Throws when the quote is unavailable or malformed. The caller renders the
 * honest unavailable state and REFUSES TO PROCEED — never a stale value, never
 * a placeholder, never a caveated estimate. Proceeding would hand control back
 * to `submitNativeTx`, which resolves its own, which is the divergence.
 */
export async function resolveOperationFee(
  plan: OperationFeePlan,
  client: RpcClient = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions()),
): Promise<OperationFee> {
  const signed = await resolveSignedFee(plan, client);
  return {
    signed,
    // Computed from `signed`'s own fields — not from the quote, and not from a
    // second call. This is the whole mechanism.
    displayLyth: formatLyth(reservationLythoshi(signed).toString(), { includeUnit: false }),
  };
}

async function resolveSignedFee(
  plan: OperationFeePlan,
  client: RpcClient,
): Promise<ResolvedExecutionFee> {
  if (plan.feeClass === "mrv") {
    // `mrv.ts`'s own defaults, reproduced so the signed value does not move:
    // the summed per-unit price as the max, the live height-aware floor as the
    // tip, then the shared clamp.
    const quote = await getExecutionUnitQuote(client);
    return postClampResolvedFee({
      maxFeePerGas: quote.summedLythoshi,
      maxPriorityFeePerGas: quote.suggestedTipLythoshi,
      gasLimit: plan.executionUnitLimit,
    });
  }
  const options = { executionUnitLimit: plan.executionUnitLimit };
  const resolved =
    plan.feeClass === "registry"
      ? await resolveRegistryExecutionFee(client, options)
      : await resolveExecutionFee(client, options);
  return postClampResolvedFee(resolved);
}
