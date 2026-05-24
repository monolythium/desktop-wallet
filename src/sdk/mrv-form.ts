import { MrvValidationError } from "@monolythium/core-sdk";

export interface MrvDeployFormInput {
  artifactBytes: string;
  constructorInput?: string;
  valueLyth?: string;
  executionUnitLimit?: string;
  maxExecutionFeeLythoshi?: string;
}

export interface MrvCallFormInput {
  contractAddress: string;
  input?: string;
  valueLyth?: string;
  executionUnitLimit?: string;
  maxExecutionFeeLythoshi?: string;
}

export interface NormalizedMrvDeployInput {
  artifactBytes: string;
  constructorInput: string;
  valueLyth: string;
  executionUnitLimit?: string;
  maxExecutionFeeLythoshi?: string;
}

export interface NormalizedMrvCallInput {
  contractAddress: string;
  input: string;
  valueLyth: string;
  executionUnitLimit?: string;
  maxExecutionFeeLythoshi?: string;
}

export function normalizeMrvDeployForm(
  input: MrvDeployFormInput,
): NormalizedMrvDeployInput {
  return {
    artifactBytes: normalizeHexBytes("artifact bytes", input.artifactBytes, { allowEmpty: false }),
    constructorInput: normalizeHexBytes("constructor input", input.constructorInput ?? "0x", {
      allowEmpty: true,
    }),
    valueLyth: normalizeOptionalDecimal("value", input.valueLyth) ?? "0",
    ...optionalDecimalField("executionUnitLimit", input.executionUnitLimit),
    ...optionalDecimalField("maxExecutionFeeLythoshi", input.maxExecutionFeeLythoshi),
  };
}

export function normalizeMrvCallForm(input: MrvCallFormInput): NormalizedMrvCallInput {
  const contractAddress = input.contractAddress.trim();
  if (contractAddress.length === 0) {
    throw new MrvValidationError("contract address is required");
  }
  return {
    contractAddress,
    input: normalizeHexBytes("call input", input.input ?? "0x", { allowEmpty: true }),
    valueLyth: normalizeOptionalDecimal("value", input.valueLyth) ?? "0",
    ...optionalDecimalField("executionUnitLimit", input.executionUnitLimit),
    ...optionalDecimalField("maxExecutionFeeLythoshi", input.maxExecutionFeeLythoshi),
  };
}

function normalizeHexBytes(
  field: string,
  value: string,
  opts: { allowEmpty: boolean },
): string {
  const trimmed = value.trim();
  const raw = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.slice(2)
    : trimmed;
  if (raw.length === 0) {
    if (opts.allowEmpty) return "0x";
    throw new MrvValidationError(`${field} is required`);
  }
  if (raw.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new MrvValidationError(`${field} must be even-length hex bytes`);
  }
  return `0x${raw.toLowerCase()}`;
}

function normalizeOptionalDecimal(field: string, value?: string): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return undefined;
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(trimmed)) {
    throw new MrvValidationError(`${field} must be a decimal LYTH value with up to 8 places`);
  }
  return trimmed;
}

function optionalDecimalField<K extends string>(
  key: K,
  value?: string,
): Partial<Record<K, string>> {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) return {};
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) {
    throw new MrvValidationError(`${key} must be a canonical non-negative integer`);
  }
  return { [key]: trimmed } as Partial<Record<K, string>>;
}
