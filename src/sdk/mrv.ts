// MRV contract deploy/call consumer layer.
//
// The core SDK owns the MRV request builders and native tx adapter fields.
// This module keeps the desktop-wallet surface app-facing: typed MRV requests,
// lythoshi values, and fee previews. Submission is plaintext (`mesh_submitTx`).
//
// TWO SIGNED FIELDS THIS SEAM USED TO TAKE FROM THE OPERATOR IT SUBMITS TO.
//
// This is the one signing path that does NOT route through `submitNativeTx`, so
// neither of that seam's bindings reached it:
//
//   - the chain id came from `eth_chainId` — the operator's unilateral claim
//     about which chain it serves, deciding which chain the signature is valid
//     on. Showing that number to a user is not a fix: they have nothing to check
//     it against. It now comes from `activeChainPin()` (see below).
//   - the fee had no client-side bound at all, because `postClampResolvedFee`
//     is applied inside `submitNativeTx`. The chain has no maximum per-unit
//     price (fee-model.ts), so bounding it is the client's duty and this seam
//     was not doing it.
//
// Both are now taken from the same places every other write takes them.

import {
  assertMrvCallNativeSubmissionPlan,
  assertMrvDeployNativeSubmissionPlan,
  buildMrvCallNativeTxPlan,
  buildMrvDeployPayloadNativeTxPlan,
  formatLyth,
  mrvAddressToBech32,
  mrvCodeHashHex,
  parseLythToLythoshi,
  validateMrvArtifactMetadata,
  MrvValidationError,
} from "@monolythium/core-sdk";
import type {
  MrvArtifactMetadata,
  MrvBytesLike,
  MrvCallNativeTxPlan,
  MrvCallRequest,
  MrvDeployNativeTxPlan,
  MrvDeployRequest,
  MrvNativeFeePreview,
  MrvNativeTxFacade,
  MrvTransactionExtension,
  MrvValidatedArtifactMetadata,
  RpcClient,
} from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  submitTransaction,
} from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";
import { activeChainPin } from "./chain-trust";
import { postClampResolvedFee } from "./fee-model";
import { getExecutionUnitQuote, getNativeTransactionCount } from "./native-rpc";

export const MRV_DEFAULT_DEPLOY_EXECUTION_UNIT_LIMIT = 1_000_000n;
export const MRV_DEFAULT_CALL_EXECUTION_UNIT_LIMIT = 100_000n;

type IntegerLike = string | number | bigint;
type LythoshiLike = string | number | bigint;

interface MrvNativePlanArgs {
  seed: Uint8Array;
  client?: RpcClient;
  chainId?: IntegerLike;
  nonce?: IntegerLike;
  maxExecutionFeeLythoshi?: LythoshiLike;
  priorityTipLythoshi?: LythoshiLike;
}

interface MrvNativeValueArgs {
  valueLyth?: string;
  valueLythoshi?: LythoshiLike;
}

export interface BuildMrvDeployPayloadTransactionPlanArgs
  extends MrvNativePlanArgs,
    MrvNativeValueArgs {
  artifactBytes: MrvBytesLike;
  artifactMetadata?: MrvArtifactMetadata;
  artifactHash?: string;
  constructorInput?: MrvBytesLike | null;
  executionUnitLimit?: IntegerLike;
}

export interface BuildMrvCallTransactionPlanArgs
  extends MrvNativePlanArgs,
    MrvNativeValueArgs {
  contractAddress: string;
  input?: MrvBytesLike;
  executionUnitLimit?: IntegerLike;
}

export type SubmitMrvDeployPayloadTransactionArgs =
  BuildMrvDeployPayloadTransactionPlanArgs;

export type SubmitMrvCallTransactionArgs =
  BuildMrvCallTransactionPlanArgs;

interface MrvAppPlanBase {
  from: string;
  fromHex: string;
  valueLythoshi: string;
  valueDisplay: string;
  nativeTx: MrvNativeTxFacade;
  feePreview: MrvNativeFeePreview;
  extension: MrvTransactionExtension;
}

export interface MrvDeployPayloadTransactionPlan extends MrvAppPlanBase {
  kind: "deploy";
  request: MrvDeployRequest;
  artifactHash: string;
  expectedContractAddress?: string;
  validatedMetadata?: MrvValidatedArtifactMetadata;
}

export interface MrvCallTransactionPlan extends MrvAppPlanBase {
  kind: "call";
  request: MrvCallRequest;
  contractAddress: string;
}

export type MrvDeployPayloadSubmission = MrvDeployPayloadTransactionPlan & {
  txHash: string;
};

export type MrvCallSubmission = MrvCallTransactionPlan & {
  txHash: string;
};

interface PreparedDeployPayloadPlan {
  client: RpcClient;
  backend: MlDsa65Backend;
  rawPlan: MrvDeployNativeTxPlan;
  appPlan: MrvDeployPayloadTransactionPlan;
}

interface PreparedCallPlan {
  client: RpcClient;
  backend: MlDsa65Backend;
  rawPlan: MrvCallNativeTxPlan;
  appPlan: MrvCallTransactionPlan;
}

// The two `prepare*` helpers below hand OWNERSHIP of a live signing backend to
// their caller — they are the wallet's only construction sites where the key
// must outlive the function that derived it, because the plan is built in one
// step and signed in another. So the four entry points here are the disposal
// boundary, and each disposes in a `finally`: two never sign at all, and two
// sign and must not dispose before they do.

export async function buildMrvDeployPayloadTransactionPlan(
  args: BuildMrvDeployPayloadTransactionPlanArgs,
): Promise<MrvDeployPayloadTransactionPlan> {
  const prepared = await prepareDeployPayloadPlan(args);
  try {
    // Plan only — nothing is signed on this path, so the derived key is dead
    // weight the moment the plan exists.
    return prepared.appPlan;
  } finally {
    prepared.backend.dispose();
  }
}

export async function buildMrvCallTransactionPlan(
  args: BuildMrvCallTransactionPlanArgs,
): Promise<MrvCallTransactionPlan> {
  const prepared = await prepareCallPlan(args);
  try {
    return prepared.appPlan;
  } finally {
    prepared.backend.dispose();
  }
}

export async function submitMrvDeployPayloadTransaction(
  args: SubmitMrvDeployPayloadTransactionArgs,
): Promise<MrvDeployPayloadSubmission> {
  const prepared = await prepareDeployPayloadPlan(args);
  try {
    // Plaintext `mesh_submitTx` (the confirming path). The native tx —
    // extensions included — is signed + submitted.
    const txHash = await submitTransaction({
      client: prepared.client,
      backend: prepared.backend,
      tx: prepared.rawPlan.tx,
    });
    return { ...prepared.appPlan, txHash };
  } finally {
    // After the submit, whether it resolved or threw.
    prepared.backend.dispose();
  }
}

export async function submitMrvCallTransaction(
  args: SubmitMrvCallTransactionArgs,
): Promise<MrvCallSubmission> {
  const prepared = await prepareCallPlan(args);
  try {
    // Plaintext `mesh_submitTx` (the confirming path).
    const txHash = await submitTransaction({
      client: prepared.client,
      backend: prepared.backend,
      tx: prepared.rawPlan.tx,
    });
    return { ...prepared.appPlan, txHash };
  } finally {
    prepared.backend.dispose();
  }
}

export function normalizeMrvContractAddress(address: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return mrvAddressToBech32("contract", address);
  }
  return address;
}

async function prepareDeployPayloadPlan(
  args: BuildMrvDeployPayloadTransactionPlanArgs,
): Promise<PreparedDeployPayloadPlan> {
  const artifact = resolveArtifact(args);
  const backend = MlDsa65Backend.fromSeed(args.seed);
  // `catch`-and-rethrow, NOT `finally`: on SUCCESS the backend is handed to the
  // caller, which owns disposing it. Only a failure between here and the return
  // leaves nobody holding it, and that is the case this covers — the nonce read
  // below is a live RPC call and throws in normal operation.
  try {
    const fromHex = backend.getAddress();
    const from = mrvAddressToBech32("user", fromHex);
    const client = args.client ?? getProvider().rpcClient;
    const valueLythoshi = resolveValueLythoshi(args);
    const context = await resolveNativeContext(client, fromHex, {
      chainId: args.chainId,
      nonce: args.nonce,
      maxExecutionFeeLythoshi: args.maxExecutionFeeLythoshi,
      priorityTipLythoshi: args.priorityTipLythoshi,
      executionUnitLimit: args.executionUnitLimit ?? MRV_DEFAULT_DEPLOY_EXECUTION_UNIT_LIMIT,
    });

    const rawPlan = buildMrvDeployPayloadNativeTxPlan(args.artifactBytes, {
      from,
      chainId: context.chainId,
      nonce: context.nonce,
      constructorInput: args.constructorInput,
      valueLythoshi,
      executionUnitLimit: context.executionUnitLimit,
      maxExecutionFeeLythoshi: context.maxExecutionFeeLythoshi,
      priorityTipLythoshi: context.priorityTipLythoshi,
      artifactHash: artifact.artifactHash,
    });
    assertMrvDeployNativeSubmissionPlan(rawPlan);

    return {
      client,
      backend,
      rawPlan,
      appPlan: toDeployPayloadAppPlan(rawPlan, fromHex, artifact),
    };
  } catch (cause) {
    backend.dispose();
    throw cause;
  }
}

async function prepareCallPlan(
  args: BuildMrvCallTransactionPlanArgs,
): Promise<PreparedCallPlan> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  // See `prepareDeployPayloadPlan` — `catch`-and-rethrow, because success hands
  // ownership to the caller and only failure orphans the key.
  try {
    const fromHex = backend.getAddress();
    const from = mrvAddressToBech32("user", fromHex);
    const client = args.client ?? getProvider().rpcClient;
    const valueLythoshi = resolveValueLythoshi(args);
    const context = await resolveNativeContext(client, fromHex, {
      chainId: args.chainId,
      nonce: args.nonce,
      maxExecutionFeeLythoshi: args.maxExecutionFeeLythoshi,
      priorityTipLythoshi: args.priorityTipLythoshi,
      executionUnitLimit: args.executionUnitLimit ?? MRV_DEFAULT_CALL_EXECUTION_UNIT_LIMIT,
    });

    const rawPlan = buildMrvCallNativeTxPlan(
      normalizeMrvContractAddress(args.contractAddress),
      args.input ?? "0x",
      {
        from,
        chainId: context.chainId,
        nonce: context.nonce,
        valueLythoshi,
        executionUnitLimit: context.executionUnitLimit,
        maxExecutionFeeLythoshi: context.maxExecutionFeeLythoshi,
        priorityTipLythoshi: context.priorityTipLythoshi,
      },
    );
    assertMrvCallNativeSubmissionPlan(rawPlan);

    return {
      client,
      backend,
      rawPlan,
      appPlan: toCallAppPlan(rawPlan, fromHex),
    };
  } catch (cause) {
    backend.dispose();
    throw cause;
  }
}

async function resolveNativeContext(
  client: RpcClient,
  fromHex: string,
  args: {
    chainId?: IntegerLike;
    nonce?: IntegerLike;
    maxExecutionFeeLythoshi?: LythoshiLike;
    priorityTipLythoshi?: LythoshiLike;
    executionUnitLimit: IntegerLike;
  },
): Promise<{
  chainId: bigint;
  nonce: bigint;
  executionUnitLimit: bigint;
  maxExecutionFeeLythoshi: string;
  priorityTipLythoshi: string;
}> {
  // THE CHAIN ID IS THE ONE THE ACTIVE OPERATOR WAS VERIFIED AGAINST — never the
  // one it reports about itself.
  //
  // `activeChainPin()` is the single derivation the health tick and the
  // switch-time gate both use: the SDK registry pin on the builtin chain, the
  // user's own record on a custom one. The operator that will receive this wire
  // has already been compared against it (`verdictFromStats`), and
  // `getProvider()` refuses to hand out a transport until that comparison
  // passed — so this value has been checked AGAINST the wire rather than taken
  // FROM it, which is the whole difference.
  //
  // Not a second hardcoded literal, either: `submit.ts` pins
  // MONOLYTHIUM_TESTNET_CHAIN_ID, which is correct only while the builtin chain
  // is active. This tracks a user-added chain, so copying that literal here
  // would have reproduced a known defect rather than fixed one.
  const chainId =
    args.chainId === undefined
      ? BigInt(activeChainPin().chainId)
      : normalizeU64("chainId", args.chainId);

  // One live quote covers both defaulted fee fields (single RPC): the max-fee
  // default reads the summed per-unit price and the tip default reads the live,
  // height-aware priority-tip floor — so a milestone that raises the floor is
  // tracked, instead of a hardcoded 1 gwei that only happens to match today.
  const needsQuote =
    args.maxExecutionFeeLythoshi === undefined || args.priorityTipLythoshi === undefined;
  const [nonce, quote] = await Promise.all([
    args.nonce === undefined
      ? getNativeTransactionCount(client, fromHex)
      : Promise.resolve(normalizeU64("nonce", args.nonce)),
    needsQuote ? getExecutionUnitQuote(client) : Promise.resolve(null),
  ]);

  const executionUnitLimit = normalizeU64("executionUnitLimit", args.executionUnitLimit);

  // The SAME floor + ceiling that binds every `submitNativeTx` write, applied
  // here because this seam does not route through it. Unconditional, including
  // a caller-supplied number: the ceiling is a client duty the chain does not
  // perform (it has floors only), so WHO supplied the price does not change
  // whether it should be bounded. One import, so the two paths cannot come to
  // disagree about what the bound is.
  const bounded = postClampResolvedFee({
    maxFeePerGas:
      args.maxExecutionFeeLythoshi === undefined
        ? quote!.summedLythoshi
        : BigInt(normalizeLythoshi("maxExecutionFeeLythoshi", args.maxExecutionFeeLythoshi)),
    maxPriorityFeePerGas:
      args.priorityTipLythoshi === undefined
        ? quote!.suggestedTipLythoshi
        : BigInt(normalizeLythoshi("priorityTipLythoshi", args.priorityTipLythoshi)),
    gasLimit: executionUnitLimit,
  });

  return {
    chainId,
    nonce,
    executionUnitLimit,
    maxExecutionFeeLythoshi: bounded.maxFeePerGas.toString(),
    priorityTipLythoshi: bounded.maxPriorityFeePerGas.toString(),
  };
}

function resolveArtifact(args: {
  artifactBytes: MrvBytesLike;
  artifactMetadata?: MrvArtifactMetadata;
  artifactHash?: string;
}): {
  artifactHash: string;
  validatedMetadata?: MrvValidatedArtifactMetadata;
} {
  const validatedMetadata =
    args.artifactMetadata === undefined
      ? undefined
      : validateMrvArtifactMetadata(args.artifactMetadata, args.artifactBytes);
  const artifactHash = validatedMetadata?.codeHash ?? mrvCodeHashHex(args.artifactBytes);
  if (args.artifactHash !== undefined && args.artifactHash.toLowerCase() !== artifactHash) {
    throw new MrvValidationError("artifactHash does not match validated MRV artifact bytes");
  }
  return {
    artifactHash,
    ...(validatedMetadata === undefined ? {} : { validatedMetadata }),
  };
}

function toDeployPayloadAppPlan(
  rawPlan: MrvDeployNativeTxPlan,
  fromHex: string,
  artifact: { artifactHash: string; validatedMetadata?: MrvValidatedArtifactMetadata },
): MrvDeployPayloadTransactionPlan {
  return {
    kind: "deploy",
    from: rawPlan.request.from ?? "",
    fromHex,
    request: rawPlan.request,
    artifactHash: artifact.artifactHash,
    ...(rawPlan.expectedContractAddress === undefined
      ? {}
      : { expectedContractAddress: rawPlan.expectedContractAddress }),
    ...(artifact.validatedMetadata === undefined
      ? {}
      : { validatedMetadata: artifact.validatedMetadata }),
    valueLythoshi: rawPlan.nativeTx.valueLythoshi,
    valueDisplay: formatLyth(rawPlan.nativeTx.valueLythoshi, { includeUnit: false }),
    nativeTx: rawPlan.nativeTx,
    feePreview: rawPlan.feePreview,
    extension: rawPlan.extension,
  };
}

function toCallAppPlan(rawPlan: MrvCallNativeTxPlan, fromHex: string): MrvCallTransactionPlan {
  return {
    kind: "call",
    from: rawPlan.request.from ?? "",
    fromHex,
    request: rawPlan.request,
    contractAddress: rawPlan.request.contractAddress,
    valueLythoshi: rawPlan.nativeTx.valueLythoshi,
    valueDisplay: formatLyth(rawPlan.nativeTx.valueLythoshi, { includeUnit: false }),
    nativeTx: rawPlan.nativeTx,
    feePreview: rawPlan.feePreview,
    extension: rawPlan.extension,
  };
}

function resolveValueLythoshi(args: MrvNativeValueArgs): string {
  const fromLyth =
    args.valueLyth === undefined ? undefined : parseLythToLythoshi(args.valueLyth).toString();
  const fromLythoshi =
    args.valueLythoshi === undefined
      ? undefined
      : normalizeLythoshi("valueLythoshi", args.valueLythoshi);
  if (fromLyth !== undefined && fromLythoshi !== undefined && fromLyth !== fromLythoshi) {
    throw new MrvValidationError("valueLyth and valueLythoshi do not describe the same amount");
  }
  return fromLythoshi ?? fromLyth ?? "0";
}

function normalizeLythoshi(field: string, value: LythoshiLike): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new MrvValidationError(`${field} must be non-negative`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MrvValidationError(`${field} must be a non-negative safe integer`);
    }
    return value.toString();
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new MrvValidationError(`${field} must be canonical decimal lythoshi`);
  }
  return value;
}

function normalizeU64(field: string, value: IntegerLike): bigint {
  const parsed = normalizeInteger(field, value);
  if (parsed > (1n << 64n) - 1n) {
    throw new MrvValidationError(`${field} out of u64 range`);
  }
  return parsed;
}

function normalizeInteger(field: string, value: IntegerLike): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new MrvValidationError(`${field} must be non-negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new MrvValidationError(`${field} must be a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new MrvValidationError(`${field} must be a canonical decimal integer`);
  }
  return BigInt(value);
}
