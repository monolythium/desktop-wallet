import type { RpcClient } from "@monolythium/core-sdk";

export async function getNativeTransactionCount(
  client: RpcClient,
  address: string,
): Promise<bigint> {
  try {
    return normalizeRpcQuantity(
      await client.call<number | string | bigint>("lyth_getTransactionCount", [address]),
      "lyth_getTransactionCount",
    );
  } catch (cause) {
    if (!isMethodMissing(cause)) throw cause;
    return client.ethGetTransactionCount(address, "pending");
  }
}

export async function getExecutionUnitPriceLythoshi(client: RpcClient): Promise<bigint> {
  return normalizeRpcQuantity(await client.call<string>("eth_gasPrice", []), "eth_gasPrice");
}

function normalizeRpcQuantity(value: number | string | bigint, field: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${field} returned an invalid quantity`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} returned an invalid quantity`);
    }
    return BigInt(value);
  }
  if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value);
  if (/^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`${field} returned an invalid quantity`);
}

function isMethodMissing(cause: unknown): boolean {
  const err = cause as { code?: number; message?: string; cause?: unknown };
  if (err?.code === -32601) return true;
  if (typeof err?.message === "string" && /method not found/i.test(err.message)) return true;
  if (err?.cause !== undefined && err.cause !== cause) return isMethodMissing(err.cause);
  return false;
}
