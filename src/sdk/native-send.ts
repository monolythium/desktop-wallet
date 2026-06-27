// Native Monolythium send path.
//
// Routes through the shared `submitNativeTx` seam, which submits PLAINTEXT via
// `submitTransaction` → `mesh_submitTx` (the inclusion path that confirms on
// the chain).
//
// The SDK owns signing, native tx bincode, and sane fee defaults (we no longer
// hardcode an execution-unit limit — the transfer default ~100k + clamped tip
// comes from the SDK).

import {
  addressToTypedBech32,
  formatLyth,
  parseLythToLythoshi,
} from "@monolythium/core-sdk";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { requireTypedUserAddressHex } from "./address";
import { submitNativeTx } from "./submit";

export interface SendNativeLythArgs {
  seed: Uint8Array;
  /** Typed `mono1...` recipient. */
  to: string;
  amountLyth: string;
  executionUnitLimit?: bigint;
}

export interface SendNativeLythResult {
  txHash: string;
  from: string;
  amountLythoshi: string;
  amountDisplay: string;
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
    ...(args.executionUnitLimit === undefined
      ? {}
      : { executionUnitLimit: args.executionUnitLimit }),
  });

  return {
    txHash: result.txHash,
    from: addressToTypedBech32("user", result.fromHex),
    amountLythoshi,
    amountDisplay: formatLyth(amountLythoshi, { includeUnit: false }),
  };
}
