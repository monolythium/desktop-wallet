// Native Monolythium send path.
//
// Routes through the shared `submitNativeTx` seam, which submits PLAINTEXT via
// `submitTransaction` → `mesh_submitTx` (the inclusion path that confirms on
// the chain).
//
// The SDK owns signing + native tx bincode. The send path signs the compose
// preview's tiered fee VERBATIM when one is provided (shown == signed);
// otherwise it defaults the native limit to 30_000 units
// (NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT, above the 24_309 ML-DSA-65 intrinsic
// floor) and the resolver's fee is bounded by the shared floor/ceiling in
// submitNativeTx.

import {
  addressToTypedBech32,
  formatLyth,
  parseLythToLythoshi,
} from "@monolythium/core-sdk";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { requireTypedUserAddressHex } from "./address";
import { submitNativeTx } from "./submit";
import { NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT } from "./fee-model";

export interface SendNativeLythArgs {
  seed: Uint8Array;
  /** Typed `mono1...` recipient. */
  to: string;
  amountLyth: string;
  executionUnitLimit?: bigint;
  /** The compose preview's tiered fee — signed VERBATIM (shown == signed) when
   *  present; otherwise the resolver runs (bounded by the shared clamps). */
  resolvedFee?: ResolvedExecutionFee;
}

export interface SendNativeLythResult {
  txHash: string;
  from: string;
  amountLythoshi: string;
  amountDisplay: string;
  /** Account nonce this send signed with (for dropped-tx detection). */
  nonce: number;
}

export interface NativeLythTransferPlanArgs {
  chainId: bigint;
  nonce: bigint;
  /** Typed `mono1...` recipient. */
  to: string;
  amountLyth: string;
  executionUnitPriceLythoshi: bigint;
  priorityTipLythoshi?: bigint;
  executionUnitLimit?: bigint;
}

export interface NativeLythTransferPlan {
  amountLythoshi: string;
  amountDisplay: string;
  tx: NativeEvmTxFields;
}

/** Default execution-unit limit for a bare transfer plan preview. The live
 *  send path takes the SDK transfer default; this is only for offline plan
 *  construction / tests. */
const TRANSFER_PLAN_EXECUTION_UNIT_LIMIT = 100_000n;

export function buildNativeLythTransferPlan(args: NativeLythTransferPlanArgs): NativeLythTransferPlan {
  const amountLythoshi = parseLythToLythoshi(args.amountLyth).toString();
  const executionUnitLimit = args.executionUnitLimit ?? TRANSFER_PLAN_EXECUTION_UNIT_LIMIT;
  const toHex = requireTypedUserAddressHex(args.to, "to");
  return {
    amountLythoshi,
    amountDisplay: formatLyth(amountLythoshi, { includeUnit: false }),
    tx: {
      chainId: args.chainId,
      nonce: args.nonce,
      maxFeePerGas: args.executionUnitPriceLythoshi,
      maxPriorityFeePerGas: args.priorityTipLythoshi ?? args.executionUnitPriceLythoshi,
      gasLimit: executionUnitLimit,
      to: toHex,
      value: amountLythoshi,
      input: "0x",
    },
  };
}

export async function sendNativeLyth(args: SendNativeLythArgs): Promise<SendNativeLythResult> {
  const toHex = requireTypedUserAddressHex(args.to, "to");
  const amountLythoshi = parseLythToLythoshi(args.amountLyth).toString();

  const result = await submitNativeTx({
    seed: args.seed,
    to: toHex,
    valueLythoshi: BigInt(amountLythoshi),
    feeClass: "transfer",
    executionUnitLimit: args.executionUnitLimit ?? NATIVE_TRANSFER_EXECUTION_UNIT_LIMIT,
    ...(args.resolvedFee === undefined ? {} : { resolvedFee: args.resolvedFee }),
  });

  return {
    txHash: result.txHash,
    from: addressToTypedBech32("user", result.fromHex),
    amountLythoshi,
    amountDisplay: formatLyth(amountLythoshi, { includeUnit: false }),
    nonce: result.nonce,
  };
}
