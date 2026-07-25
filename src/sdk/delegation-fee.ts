// Fee affordability for a delegation — the one guard in this flow that is not
// about weight.
//
// THE ABSENCE THIS CLOSES. Every other delegation guard asks whether the weight
// is allowed. None asked whether the wallet can pay to submit it, so a wallet
// holding plenty of weight but no balance passed every client-side check and was
// refused at chain admission.
//
// THE PREDICATE IS THE TOKEN GATE'S SHAPE, NOT THE NATIVE ONE. A delegation
// carries value = 0, so the fee sits ON TOP OF the transfer rather than inside
// it. The comparison is `basis < reservation`, with NO amount term. The send
// path's native gate compares `amount + reservation > basis`; reaching for that
// here by analogy would produce a check that is wrong in an interesting way
// rather than merely absent, because it would charge the delegation weight
// against a balance the delegation never spends.
//
// THE COMPARAND IS THE RESERVATION, not the displayed charge — the reservation
// is what chain admission actually requires — computed at the delegation path's
// own execution-unit limit rather than a transfer's.
//
// IT FAILS OPEN, AND THAT INVERTS THE SEND PATH ON PURPOSE. On the send path an
// unresolved fee estimate DISABLES Review: an unseen fee must never be signed
// alongside a value transfer. Here the opposite is right, and the difference is
// not an oversight to be tidied away later:
//
//   - a false pass costs an admission refusal, which is free — value = 0,
//     nothing is charged, and the wallet already records and names the failure;
//   - a false block denies a legitimate non-custodial action with no chain-side
//     confirmation the block was right.
//
// So an unreadable balance or an unresolved quote yields "unknown" and the
// surface says nothing at all. It never assumes zero: a fabricated zero balance
// would report every wallet as short, and a guard that invents its own input is
// worse than no guard because it is trusted.

import { RpcClient } from "@monolythium/core-sdk";
import { computeNativeFeeQuote } from "./fee-model";
import { getExecutionUnitQuote } from "./native-rpc";
import { strictBalanceLythoshi } from "./spend-guard";
import { requireTypedUserAddressHex } from "./address";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { formatLythDisplay } from "./lyth-display";

/** The execution-unit budget every delegation call signs with. Mirrors the value
 *  `submitDelegationTx` applies, so the reservation quoted here is the one chain
 *  admission will actually require. */
export const DELEGATION_FEE_UNIT_LIMIT = 150_000n;

/** Whether a delegation's fee is affordable, or whether that cannot be told. */
export type FeeAffordability =
  | { status: "ok" }
  /** The condition could not be evaluated — say nothing, block nothing. */
  | { status: "unknown" }
  | { status: "short"; message: string };

/**
 * Can this wallet pay to submit a delegation?
 *
 * `basisLythoshi` must come from a STRICT balance read — one that excludes a
 * malformed answer rather than falling back to zero. The display path's reader
 * fabricates `0x0` on a shape mismatch, and passing that here would report a
 * shortfall on every malformed response.
 *
 * Exact equality is affordable: covering the reservation to the lythoshi is
 * enough, matching the send gate's own boundary. Pure.
 */
export function delegationFeeAffordability(args: {
  basisLythoshi: bigint | null;
  reservationLythoshi: bigint | null;
}): FeeAffordability {
  const { basisLythoshi, reservationLythoshi } = args;
  // Either input missing → the condition is unevaluable. Never inferred, never
  // defaulted to zero.
  if (basisLythoshi === null || reservationLythoshi === null) {
    return { status: "unknown" };
  }
  // No amount term. The delegation moves nothing; the fee is the entire cost.
  if (basisLythoshi >= reservationLythoshi) return { status: "ok" };
  return {
    status: "short",
    message: `Not enough LYTH to cover the network fee — about ${formatLythDisplay(reservationLythoshi.toString(), 6) ?? "—"} LYTH is needed. A delegation moves no tokens, so the fee is the whole cost.`,
  };
}

/**
 * The reservation a delegation submit would require, or null when it cannot be
 * established.
 *
 * Never throws and never fabricates: a failed or malformed quote, or a refusal
 * from the trust-gated provider seam on a degraded chain, all resolve to null,
 * which the verdict reads as "unknown".
 *
 * NOTE ON QUOTE DRIFT: the submit path re-resolves the fee at signing time, so
 * this figure is an estimate of that, not the signed value. It is why this guard
 * is ADVISORY — a drifted quote can make the warning slightly wrong, and a
 * warning that is slightly wrong costs nothing, where a refusal would deny a
 * transaction the chain would have admitted.
 */
export async function loadDelegationFeeReservation(): Promise<bigint | null> {
  try {
    const client = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions());
    const quote = await getExecutionUnitQuote(client);
    return computeNativeFeeQuote({
      baseLythoshi: quote.baseLythoshi,
      suggestedTipLythoshi: quote.suggestedTipLythoshi,
      // The tier the delegation path signs at.
      tier: "normal",
      executionUnitLimit: DELEGATION_FEE_UNIT_LIMIT,
    }).reservationLythoshi;
  } catch {
    return null;
  }
}

/**
 * The affordability basis: the wallet's balance read STRICTLY from the active
 * trusted provider, or null when no well-formed answer came back.
 *
 * Deliberately the single trusted-provider read, NOT the cross-operator minimum
 * the send path's spend guard takes. That minimum can only tighten, which merely
 * shrinks a Max on the send path but here would drive a wallet-wide "you cannot
 * afford this" on one peer's under-report. The refusal — such as it is — rests
 * on the operator the wallet is already trusting for every other read.
 */
export async function loadDelegationFeeBasis(
  walletBech32m: string,
): Promise<bigint | null> {
  try {
    const hex = requireTypedUserAddressHex(walletBech32m, "wallet");
    return strictBalanceLythoshi(await getProvider().rpcClient.ethGetBalance(hex));
  } catch {
    return null;
  }
}
