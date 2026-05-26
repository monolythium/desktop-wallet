import { addressToTypedBech32, type RpcClient } from "@monolythium/core-sdk";

export async function getNativeTransactionCount(
  client: RpcClient,
  address: string,
): Promise<bigint> {
  return client.lythGetTransactionCount(userAddressForRpc(address));
}

export async function getExecutionUnitPriceLythoshi(client: RpcClient): Promise<bigint> {
  const quote = await client.lythExecutionUnitPrice();
  return normalizeRpcQuantity(
    quote.executionUnitPriceLythoshi,
    "lyth_executionUnitPrice.executionUnitPriceLythoshi",
  );
}

function userAddressForRpc(address: string): string {
  return address.startsWith("0x") || address.startsWith("0X")
    ? addressToTypedBech32("user", address)
    : address;
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
