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
// FEES: a caller may pass a `resolvedFee` (the compose preview's tiered fee),
// which is signed VERBATIM so display == signed. Absent that, the SDK sane-fee
// resolvers (`resolveExecutionFee` / `resolveRegistryExecutionFee`) read the live
// `lyth_executionUnitPrice` quote, apply the safety multiplier, and default the
// execution-unit limit per write class (the installed SDK transfer default is
// 500_000n; registry/register 1_000_000n) — and their output is then bounded by the
// shared floor + ceiling (`postClampResolvedFee`), so every signed write is fee-
// bounded whether or not it supplies its own fee.

import {
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  RpcClient,
  resolveExecutionFee,
  resolveRegistryExecutionFee,
} from "@monolythium/core-sdk";
import type { ResolvedExecutionFee } from "@monolythium/core-sdk";
import { postClampResolvedFee } from "./fee-model";
import {
  MlDsa65Backend,
  buildPlaintextSubmission,
  submitPlaintextTransaction,
} from "@monolythium/core-sdk/crypto";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { scopeChainKey } from "./chains";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { getNativeTransactionCount } from "./native-rpc";
import { nextSendNonce, recordSubmittedNonce } from "./pending-nonce";

/** A transaction that was signed and submitted but REFUSED by the node at
 *  admission. It carries the canonical hash — known locally, since the wallet
 *  hashes the signed envelope before submitting — so the refusal can be recorded
 *  as an attempt the network declined, not chain history. `message` mirrors the
 *  original cause so {@link extractSendError} still classifies it, and `cause`
 *  preserves the full chain for the classifier. */
export class SubmitRejectedError extends Error {
  readonly txHash: string;
  constructor(txHash: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "SubmitRejectedError";
    this.txHash = txHash;
  }
}

/** The canonical hash of a REFUSED submission when the thrown error carries one
 *  (a {@link SubmitRejectedError} anywhere in the cause chain), else undefined.
 *  Pure. */
export function rejectedSubmitTxHash(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = cause;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { txHash?: unknown; cause?: unknown };
    if (typeof o.txHash === "string" && o.txHash.length > 0) return o.txHash;
    cur = o.cause;
  }
  return undefined;
}

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
   * unset to take the sane per-class default (SDK transfer default 500_000n /
   * registry 1_000_000n). Ignored when `resolvedFee` is supplied (its gasLimit wins).
   */
  executionUnitLimit?: bigint;
  /** Fee-resolution class. `transfer` (default) vs `registry`/`register`. */
  feeClass?: SubmitFeeClass;
  /**
   * A pre-resolved fee to sign VERBATIM (shown == signed) — no re-resolve, no
   * re-quote, no adjustment. When absent, the SDK resolver runs and is bounded by
   * the shared floor/ceiling. Never affects `value`.
   */
  resolvedFee?: ResolvedExecutionFee;
}

export interface SubmitNativeTxResult {
  /** Canonical inner native tx hash (`0x`-prefixed). */
  txHash: string;
  /** Sender 20-byte address (`0x`-prefixed). */
  fromHex: string;
  /** Resolved per-unit fee + execution-unit limit actually used. */
  fee: ResolvedExecutionFee;
  /** The account nonce this tx signed with — surfaced so the tracked-tx layer
   *  can detect a dropped tx (a later nonce confirmed while this stays pending). */
  nonce: number;
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
  // Fail-closed: `getProvider` throws when the active operator is untrusted, so
  // the wallet never signs against an unverified chain.
  const client = new RpcClient(getProvider().rpcClient.endpoint, rpcClientOptions());
  const fromHex = backend.getAddress();

  const feeOptions =
    args.executionUnitLimit === undefined
      ? undefined
      : { executionUnitLimit: args.executionUnitLimit };

  // A supplied `resolvedFee` is signed exactly as previewed (shown == signed).
  // Otherwise resolve and bound the result by the shared floor + ceiling — this
  // binds every resolver path (delegation / registry / token / CLOB / MRV) and
  // touches only the fee fields, never `value`.
  const feePromise: Promise<ResolvedExecutionFee> =
    args.resolvedFee !== undefined
      ? Promise.resolve(args.resolvedFee)
      : (args.feeClass === "registry"
          ? resolveRegistryExecutionFee(client, feeOptions)
          : resolveExecutionFee(client, feeOptions)
        ).then(postClampResolvedFee);

  const [committedNonce, fee] = await Promise.all([
    getNativeTransactionCount(client, fromHex),
    feePromise,
  ]);
  // Local pending-nonce: sign max(committed, lastSubmitted+1) so a 2nd submit
  // before the 1st commits doesn't reuse the nonce (the chain exposes only the
  // committed nonce). Recorded on success below; covers every native submit
  // path (send / register / CLOB / MRV) since they all route through here.
  //
  // Key the local nonce to the ACTIVE chain — the same chain `committedNonce`
  // was just read from (`getProvider()` above) — so the two agree by
  // construction; `recordSubmittedNonce` below reuses this exact key. A fixed
  // literal here would collide two chains' nonces once the wallet reads a nonce
  // on a second chain. (The signed `tx.chainId` is a separate axis, unchanged.)
  const chainIdHex = scopeChainKey();
  const nonce = nextSendNonce(fromHex, chainIdHex, committedNonce);

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

  // Build + sign locally FIRST — this yields the canonical native tx hash before
  // the node ever sees it. Then submit. If the node rejects the tx at admission,
  // its hash is still known, so the failure can be recorded as a refused ATTEMPT
  // (see SubmitRejectedError) rather than vanishing without a trace.
  const submission = buildPlaintextSubmission({ backend, tx });
  const localTxHash = submission.innerTxHashHex;
  let txHash: string;
  try {
    txHash = await submitPlaintextTransaction(
      client,
      submission.signedTxWireHex,
      localTxHash,
    );
  } catch (cause) {
    // Only surface the hash when it is a well-formed canonical hash (defensive:
    // never trust the SDK's declared shape blindly). Otherwise fall back to a
    // hashless reject, which records no row — the pre-F3 behaviour.
    throw isCanonicalHash(localTxHash)
      ? new SubmitRejectedError(localTxHash, cause)
      : cause;
  }
  // Success — advance the local pending nonce so the next submit won't reuse it.
  // Same (address, chain) key the read used, so the record can never drift from it.
  recordSubmittedNonce(fromHex, chainIdHex, nonce);

  return { txHash, fromHex, fee, nonce: Number(nonce) };
}

/** True for a 0x-prefixed 32-byte hex hash — the only shape we treat as a
 *  usable canonical tx hash. */
function isCanonicalHash(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}
