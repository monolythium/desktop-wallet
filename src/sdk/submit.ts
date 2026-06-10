// Shared native-tx submission seam.
//
// Every wallet write — send / delegate / undelegate / redelegate / claim /
// register (spending-policy) / CLOB / MRV — routes through `submitNativeTx`
// here so there is exactly ONE place that decides the privacy posture and
// the fee shape.
//
// DEFAULT = PLAINTEXT. The function delegates to the SDK
// `submitTransactionWithPrivacy` with `private: false`, which builds + signs
// + posts the bincode `SignedTransaction` through `mesh_submitTx` (the node
// routes it to `MempoolTx::plaintext`). That is the inclusion path that
// actually confirms on a chain running with `encrypted_mempool_required =
// false` (the live optional-encryption testnet posture).
//
// `private: true` engages the Ferveo encrypt-then-submit pipeline
// (`lyth_submitEncrypted`). Threshold-encrypted INCLUSION is NOT live yet on
// the chain, so encrypted submits will not confirm — surfaces that expose a
// privacy toggle MUST keep it default-off + preview-gated (see
// SendComposeModal). The plumbing here is correct and ready for the
// fast-follow flip; nothing should call it with `private: true` from a
// user-reachable path until threshold inclusion ships.
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
  fetchEncryptionKey,
  submitTransactionWithPrivacy,
} from "@monolythium/core-sdk/crypto";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { getNativeTransactionCount } from "./native-rpc";

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
  /**
   * Privacy posture. DEFAULT FALSE = plaintext `mesh_submitTx` (the working,
   * confirming path). TRUE = Ferveo encrypted submit, which is NOT live for
   * inclusion yet — callers must gate it (see SendComposeModal).
   */
  private?: boolean;
}

export interface SubmitNativeTxResult {
  /** Canonical inner native tx hash (`0x`-prefixed). */
  txHash: string;
  /** Sender 20-byte address (`0x`-prefixed). */
  fromHex: string;
  /** Resolved per-unit fee + execution-unit limit actually used. */
  fee: ResolvedExecutionFee;
  /** True if this went through the encrypted (preview) path. */
  wasPrivate: boolean;
}

/**
 * Build, sign, and submit a native transaction. PLAINTEXT by default
 * (`submitTransactionWithPrivacy({ private: false })` → `mesh_submitTx`).
 *
 * Resolves nonce + sane SDK fee defaults, then hands the explicit privacy
 * toggle straight to the SDK. The encryption key is fetched ONLY when
 * `private === true`.
 */
export async function submitNativeTx(
  args: SubmitNativeTxArgs,
): Promise<SubmitNativeTxResult> {
  const wantPrivate = args.private === true;
  const backend = MlDsa65Backend.fromSeed(args.seed);
  // A fresh transport bound to the shared provider endpoint, matching the
  // prior per-seam behaviour (the SDK client is request-scoped, not pooled).
  const client = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions());
  const fromHex = backend.getAddress();

  const feeOptions =
    args.executionUnitLimit === undefined
      ? undefined
      : { executionUnitLimit: args.executionUnitLimit };

  const [nonce, fee, encryptionKey] = await Promise.all([
    getNativeTransactionCount(client, fromHex),
    args.feeClass === "registry"
      ? resolveRegistryExecutionFee(client, feeOptions)
      : resolveExecutionFee(client, feeOptions),
    wantPrivate ? fetchEncryptionKey(client) : Promise.resolve(undefined),
  ]);

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

  const txHash = await submitTransactionWithPrivacy({
    client,
    backend,
    tx,
    private: wantPrivate,
    ...(encryptionKey === undefined ? {} : { encryptionKey }),
  });

  return { txHash, fromHex, fee, wasPrivate: wantPrivate };
}
