// Native Sprintnet send path.
//
// This is the desktop-wallet equivalent of the browser wallet's ML-DSA
// encrypted-submit route, but kept thin: the SDK owns signing, native tx
// bincode, encrypted-envelope construction, and `lyth_submitEncrypted`.

import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  RpcClient,
  formatLyth,
  parseLythToLythoshi,
} from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
  submitEncryptedEnvelope,
} from "@monolythium/core-sdk/crypto";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";

const SPRINTNET_TRANSFER_EXECUTION_UNIT_LIMIT = 30_000n;

export interface SendNativeLythArgs {
  seed: Uint8Array;
  to: string;
  amountLyth: string;
  executionUnitLimit?: bigint;
}

export interface SendNativeLythResult {
  txHash: string;
  from: string;
  amountLythoshi: string;
  amountDisplay: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
}

export interface NativeLythTransferPlanArgs {
  chainId: bigint;
  nonce: bigint;
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

export function buildNativeLythTransferPlan(args: NativeLythTransferPlanArgs): NativeLythTransferPlan {
  const amountLythoshi = parseLythToLythoshi(args.amountLyth).toString();
  const executionUnitLimit = args.executionUnitLimit ?? SPRINTNET_TRANSFER_EXECUTION_UNIT_LIMIT;
  return {
    amountLythoshi,
    amountDisplay: formatLyth(amountLythoshi, { includeUnit: false }),
    tx: {
      chainId: args.chainId,
      nonce: args.nonce,
      maxFeePerGas: args.executionUnitPriceLythoshi,
      maxPriorityFeePerGas: args.priorityTipLythoshi ?? args.executionUnitPriceLythoshi,
      gasLimit: executionUnitLimit,
      to: args.to,
      value: amountLythoshi,
      input: "0x",
    },
  };
}

export async function sendNativeLyth(args: SendNativeLythArgs): Promise<SendNativeLythResult> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  const provider = getProvider();
  const client = new RpcClient(provider.rpcClient.endpoint);
  const from = backend.getAddress();

  const [nonce, executionUnitPrice, encryptionKey] = await Promise.all([
    client.ethGetTransactionCount(from, "pending"),
    client.ethGasPrice(),
    fetchEncryptionKey(client),
  ]);
  const plan = buildNativeLythTransferPlan({
    chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
    nonce,
    to: args.to,
    amountLyth: args.amountLyth,
    executionUnitPriceLythoshi: executionUnitPrice,
    executionUnitLimit: args.executionUnitLimit,
  });

  const wrapped = await buildEncryptedSubmission({
    backend,
    encryptionKey,
    tx: plan.tx,
  });

  const txHash = await submitEncryptedEnvelope(client, wrapped.envelopeWireHex);
  return {
    txHash,
    from,
    amountLythoshi: plan.amountLythoshi,
    amountDisplay: plan.amountDisplay,
    innerSighashHex: wrapped.innerSighashHex,
    envelopeWireBytes: (wrapped.envelopeWireHex.length - 2) / 2,
  };
}
