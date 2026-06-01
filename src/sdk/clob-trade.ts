// CLOB trade submission — encrypted-mempool path.
//
// Encodes `placeLimitOrder(bytes32 base, bytes32 quote, uint8 side,
// uint256 price, uint256 quantity, uint64 expiresAtBlock)` calldata
// against the CLOB precompile (`0x1001`), signs with the wallet's
// ML-DSA-65 backend, wraps in the encrypted envelope per ADR-0021,
// and posts via `lyth_submitEncrypted`. Mirrors `sendNativeLyth` —
// same submission shape, different precompile target + value=0.

import {
  CLOB_SELECTORS,
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  PRECOMPILE_ADDRESSES,
  RpcClient,
  addressToTypedBech32,
  deriveClobMarketId,
  encodeCancelOrderCalldata,
  encodePlaceLimitOrderCalldata,
  type SpotLimitOrderSide,
} from "@monolythium/core-sdk";
import {
  MlDsa65Backend,
  buildEncryptedSubmission,
  fetchEncryptionKey,
} from "@monolythium/core-sdk/crypto";
import { submitEncryptedEnvelope } from "@monolythium/core-sdk/crypto";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";
import { getProvider } from "./client";
import { rpcClientOptions } from "./http";
import { getExecutionUnitPriceLythoshi, getNativeTransactionCount } from "./native-rpc";

const SPOT_LIMIT_ORDER_EXECUTION_UNIT_LIMIT = 250_000n;
const CLOB_CANCEL_EXECUTION_UNIT_LIMIT = 80_000n;

export interface PlaceClobLimitOrderArgs {
  /** Wallet's ML-DSA-65 seed (32 bytes). */
  seed: Uint8Array;
  /** 32-byte base-token id (with or without `0x` prefix). */
  baseTokenIdHex: string;
  /** 32-byte quote-token id. */
  quoteTokenIdHex: string;
  /** "buy" or "sell". */
  side: SpotLimitOrderSide;
  /** Limit price as a decimal integer string of quote atoms per base atom. */
  price: string;
  /** Order quantity as a decimal integer string of base atoms. */
  quantity: string;
  /** Optional expiry block height. `0` (default) = never expires. */
  expiresAtBlock?: bigint;
  /** Optional execution-unit limit override; defaults to a value sized for
   *  a typical place + cross + escrow + (one or two) fills. */
  executionUnitLimit?: bigint;
}

export interface PlaceClobLimitOrderResult {
  txHash: string;
  from: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
  calldataBytes: number;
}

export async function placeClobLimitOrder(
  args: PlaceClobLimitOrderArgs,
): Promise<PlaceClobLimitOrderResult> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  const provider = getProvider();
  const client = new RpcClient(provider.rpcClient.endpoint, rpcClientOptions());
  const fromHex = backend.getAddress();

  const [nonce, executionUnitPrice, encryptionKey] = await Promise.all([
    getNativeTransactionCount(client, fromHex),
    getExecutionUnitPriceLythoshi(client),
    fetchEncryptionKey(client),
  ]);

  const marketId = deriveClobMarketId(args.baseTokenIdHex, args.quoteTokenIdHex);
  const calldataHex = encodePlaceLimitOrderCalldata({
    marketId,
    baseTokenId: args.baseTokenIdHex,
    quoteTokenId: args.quoteTokenIdHex,
    side: args.side,
    price: args.price,
    quantity: args.quantity,
    expiryBlock: args.expiresAtBlock ?? 0n,
  });

  const tx: NativeEvmTxFields = {
    chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
    nonce,
    maxFeePerGas: executionUnitPrice,
    maxPriorityFeePerGas: executionUnitPrice,
    gasLimit: args.executionUnitLimit ?? SPOT_LIMIT_ORDER_EXECUTION_UNIT_LIMIT,
    to: PRECOMPILE_ADDRESSES.CLOB,
    value: 0n,
    input: calldataHex,
  };

  const wrapped = await buildEncryptedSubmission({
    backend,
    encryptionKey,
    tx,
  });

  const txHash = await submitEncryptedEnvelope(client, wrapped.envelopeWireHex);
  return {
    txHash,
    from: addressToTypedBech32("user", fromHex),
    innerSighashHex: wrapped.innerSighashHex,
    envelopeWireBytes: (wrapped.envelopeWireHex.length - 2) / 2,
    calldataBytes: (calldataHex.length - 2) / 2,
  };
}

// Re-export the selector so the Trade UI can show it next to the
// submit button for transparency / forensic logging.
export const CLOB_PLACE_LIMIT_ORDER_SELECTOR = CLOB_SELECTORS.placeLimitOrder;

export interface CancelClobOrderArgs {
  seed: Uint8Array;
  /** 32-byte order id (`0x…`). */
  orderIdHex: string;
  executionUnitLimit?: bigint;
}

export interface CancelClobOrderResult {
  txHash: string;
  from: string;
  innerSighashHex: string;
  envelopeWireBytes: number;
  calldataBytes: number;
}

export async function cancelClobOrder(
  args: CancelClobOrderArgs,
): Promise<CancelClobOrderResult> {
  const backend = MlDsa65Backend.fromSeed(args.seed);
  const provider = getProvider();
  const client = new RpcClient(provider.rpcClient.endpoint, rpcClientOptions());
  const fromHex = backend.getAddress();

  const [nonce, executionUnitPrice, encryptionKey] = await Promise.all([
    getNativeTransactionCount(client, fromHex),
    getExecutionUnitPriceLythoshi(client),
    fetchEncryptionKey(client),
  ]);

  const calldataHex = encodeCancelOrderCalldata({ orderId: args.orderIdHex });

  const tx: NativeEvmTxFields = {
    chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
    nonce,
    maxFeePerGas: executionUnitPrice,
    maxPriorityFeePerGas: executionUnitPrice,
    gasLimit: args.executionUnitLimit ?? CLOB_CANCEL_EXECUTION_UNIT_LIMIT,
    to: PRECOMPILE_ADDRESSES.CLOB,
    value: 0n,
    input: calldataHex,
  };

  const wrapped = await buildEncryptedSubmission({ backend, encryptionKey, tx });
  const txHash = await submitEncryptedEnvelope(client, wrapped.envelopeWireHex);
  return {
    txHash,
    from: addressToTypedBech32("user", fromHex),
    innerSighashHex: wrapped.innerSighashHex,
    envelopeWireBytes: (wrapped.envelopeWireHex.length - 2) / 2,
    calldataBytes: (calldataHex.length - 2) / 2,
  };
}

export const CLOB_CANCEL_ORDER_SELECTOR = CLOB_SELECTORS.cancelOrder;
