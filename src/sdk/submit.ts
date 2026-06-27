// Shared native-tx submission seam.
//
// Every wallet write — send / delegate / undelegate / redelegate / claim /
// register (spending-policy) / CLOB / MRV — routes through `submitNativeTx`
// here so there is exactly ONE place that decides the fee shape.
//
// Submission is PLAINTEXT. The function delegates to the SDK
// `submitTransaction`, which builds + signs + posts the bincode
// `SignedTransaction` through `mesh_submitTx` (the node routes it to
// `MempoolTx::plaintext`). That is the only inclusion path the chain exposes
// — the encrypted mempool was removed (DEC-029), so there is no longer a
// private/encrypted submit lane to route to.
//
// FEES come from the SDK sane-fee resolvers (`resolveExecutionFee` /
// `resolveRegistryExecutionFee`): they read the live `lyth_executionUnitPrice`
// quote, apply the safety multiplier, clamp the priority tip to the per-unit
// max price (the plaintext path rejects `priority_tip > max_execution_unit_price`
// with `FeeMismatch`), and default the execution-unit limit per write class
// (transfer ~100k, registry/register ~250k). We never hardcode the old
// per-seam limits.

import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  RpcClient,
  resolveExecutionFee,
  resolveRegistryExecutionFee,
} from "@monolythium/core-sdk";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  submitTransaction,
} from "@monolythium/core-sdk/crypto";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { getNativeTransactionCount } from "./native-rpc";
import { nextSendNonce, recordSubmittedNonce } from "./pending-nonce";

/** Fee-resolution class — picks the SDK default execution-unit limit. */
export type SubmitFeeClass = "transfer" | "registry";

export interface SubmitNativeTxArgs {
  /** Wallet's ML-DSA-65 seed (32 bytes), unlocked by the OperationsDrawer. */
  seed: Uint8Array;
  /** `0x`-prefixed 20-byte recipient / precompile / contract target. */
  to: string;
  /** msg.value in lythoshi. Defaults to 0. */
  valueLythoshi?: bigint;
  /** `0x`-prefixed calldata. Defaults to `0x`. */
  input?: string;
  /**
   * Override the SDK default execution-unit limit for this write. Leave
   * unset to take the sane per-class default (transfer ~100k / registry ~250k).
   */
  executionUnitLimit?: bigint;
  /** Fee-resolution class. `transfer` (default) vs `registry`/`register`. */
  feeClass?: SubmitFeeClass;
}

export interface SubmitNativeTxResult {
  /** Canonical inner native tx hash (`0x`-prefixed). */
  txHash: string;
  /** Sender 20-byte address (`0x`-prefixed). */
  fromHex: string;
  /** Resolved per-unit fee + execution-unit limit actually used. */
  fee: ResolvedExecutionFee;
}

/**
 * Build, sign, and submit a native transaction over the plaintext
 * `mesh_submitTx` path (`submitTransaction`).
 *
 * Resolves nonce + sane SDK fee defaults, then hands the signed tx to the SDK.
 */
export async function submitNativeTx(
  args: SubmitNativeTxArgs,
): Promise<SubmitNativeTxResult> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  // A fresh transport bound to the shared provider endpoint, matching the
  // prior per-seam behaviour (the SDK client is request-scoped, not pooled).
  const client = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions());
  const fromHex = backend.getAddress();

  const feeOptions =
    args.executionUnitLimit === undefined
      ? undefined
      : { executionUnitLimit: args.executionUnitLimit };

  const [committedNonce, fee] = await Promise.all([
    getNativeTransactionCount(client, fromHex),
    args.feeClass === "registry"
      ? resolveRegistryExecutionFee(client, feeOptions)
      : resolveExecutionFee(client, feeOptions),
  ]);
  // Local pending-nonce: sign max(committed, lastSubmitted+1) so a 2nd submit
  // before the 1st commits doesn't reuse the nonce (the chain exposes only the
  // committed nonce). Recorded on success below; covers every native submit
  // path (send / register / CLOB / MRV) since they all route through here.
  const nonce = nextSendNonce(fromHex, MONOLYTHIUM_TESTNET_CHAIN_ID, committedNonce);

  const tx: NativeEvmTxFields = {
    chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
    nonce,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
    gasLimit: fee.gasLimit,
    to: args.to,
    value: args.valueLythoshi ?? 0n,
    input: args.input ?? "0x",
  };

  const txHash = await submitTransaction({
    client,
    backend,
    tx,
  });
  // Success — advance the local pending nonce so the next submit won't reuse it.
  recordSubmittedNonce(fromHex, MONOLYTHIUM_TESTNET_CHAIN_ID, nonce);

  return { txHash, fromHex, fee };
}
