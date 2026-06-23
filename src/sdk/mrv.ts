// MRV contract deploy/call consumer layer.
//
// The core SDK owns the MRV request builders and native tx adapter fields.
// This module keeps the desktop-wallet surface app-facing: typed MRV requests,
// lythoshi values, and fee previews. Submission is plaintext (`mesh_submitTx`).

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
  submitTransactionWithPrivacy,
} from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";
import { getExecutionUnitPriceLythoshi, getNativeTransactionCount } from "./native-rpc";

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

export async function buildMrvDeployPayloadTransactionPlan(
  args: BuildMrvDeployPayloadTransactionPlanArgs,
): Promise<MrvDeployPayloadTransactionPlan> {
  return (await prepareDeployPayloadPlan(args)).appPlan;
}

export async function buildMrvCallTransactionPlan(
  args: BuildMrvCallTransactionPlanArgs,
): Promise<MrvCallTransactionPlan> {
  return (await prepareCallPlan(args)).appPlan;
}

export async function submitMrvDeployPayloadTransaction(
  args: SubmitMrvDeployPayloadTransactionArgs,
): Promise<MrvDeployPayloadSubmission> {
  const prepared = await prepareDeployPayloadPlan(args);
  // Plaintext `mesh_submitTx` (the confirming path). The native tx —
  // extensions included — is signed + submitted.
  const txHash = await submitTransactionWithPrivacy({
    client: prepared.client,
    backend: prepared.backend,
    tx: prepared.rawPlan.tx,
    private: false,
  });
  return { ...prepared.appPlan, txHash };
}

export async function submitMrvCallTransaction(
  args: SubmitMrvCallTransactionArgs,
): Promise<MrvCallSubmission> {
  const prepared = await prepareCallPlan(args);
  // Plaintext `mesh_submitTx` (the confirming path).
  const txHash = await submitTransactionWithPrivacy({
    client: prepared.client,
    backend: prepared.backend,
    tx: prepared.rawPlan.tx,
    private: false,
  });
  return { ...prepared.appPlan, txHash };
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
}

async function prepareCallPlan(
  args: BuildMrvCallTransactionPlanArgs,
): Promise<PreparedCallPlan> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
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
  const [chainId, nonce, maxExecutionFeeLythoshi] = await Promise.all([
    args.chainId === undefined
      ? client.ethChainId()
      : Promise.resolve(normalizeU64("chainId", args.chainId)),
    args.nonce === undefined
      ? getNativeTransactionCount(client, fromHex)
      : Promise.resolve(normalizeU64("nonce", args.nonce)),
    args.maxExecutionFeeLythoshi === undefined
      ? getExecutionUnitPriceLythoshi(client).then((value) => value.toString())
      : Promise.resolve(normalizeLythoshi("maxExecutionFeeLythoshi", args.maxExecutionFeeLythoshi)),
  ]);

  return {
    chainId,
    nonce,
    executionUnitLimit: normalizeU64("executionUnitLimit", args.executionUnitLimit),
    maxExecutionFeeLythoshi,
    priorityTipLythoshi: normalizeLythoshi("priorityTipLythoshi", args.priorityTipLythoshi ?? 0n),
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
