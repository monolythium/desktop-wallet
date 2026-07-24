import { addressToTypedBech32, type RpcClient } from "@monolythium/core-sdk";

export async function getNativeTransactionCount(
  client: RpcClient,
  address: string,
): Promise<bigint> {
  return client.lythGetTransactionCount(userAddressForRpc(address));
}

/** Read the live execution-unit quote as the SEPARATE base + suggested tip the
 *  fee model needs (the summed `executionUnitPriceLythoshi` field is not used —
 *  the dual-fee math scales the tip and adds the base independently). A malformed
 *  quantity throws with the field name; the caller renders the honest fee error. */
export async function getExecutionUnitQuote(
  client: RpcClient,
): Promise<{
  baseLythoshi: bigint;
  suggestedTipLythoshi: bigint;
  summedLythoshi: bigint;
  source: string;
}> {
  const quote = await client.lythExecutionUnitPrice();
  return {
    baseLythoshi: normalizeRpcQuantity(
      quote.basePricePerExecutionUnitLythoshi,
      "lyth_executionUnitPrice.basePricePerExecutionUnitLythoshi",
    ),
    suggestedTipLythoshi: normalizeRpcQuantity(
      quote.priorityTipLythoshi,
      "lyth_executionUnitPrice.priorityTipLythoshi",
    ),
    // The summed per-unit price (base + tip) the max-fee default uses.
    summedLythoshi: normalizeRpcQuantity(
      quote.executionUnitPriceLythoshi,
      "lyth_executionUnitPrice.executionUnitPriceLythoshi",
    ),
    source: quote.source,
  };
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
