// CLOB trade submission.
//
// Encodes `placeLimitOrder(bytes32 base, bytes32 quote, uint8 side,
// uint256 price, uint256 quantity, uint64 expiresAtBlock)` / `cancelOrder`
// calldata against the CLOB precompile (`0x1001`), then submits through the
// shared `submitNativeTx` seam.
//
// PLAINTEXT by default (`mesh_submitTx`) — the path that confirms. Encryption is
// OPTIONAL and costs more; the encrypted mempool is never mandatory and
// threshold-encrypted INCLUSION is not live on-chain yet, so a CLOB order is
// never forced through the encrypted path. The `private` opt-in is wired through
// to the SDK for when inclusion goes live (gate it behind Developer Mode in the
// UI, like the native send); leaving it unset sends plaintext.

import {
  CLOB_SELECTORS,
  PRECOMPILE_ADDRESSES,
  addressToTypedBech32,
  deriveClobMarketId,
  encodeCancelOrderCalldata,
  encodePlaceLimitOrderCalldata,
  type SpotLimitOrderSide,
} from "@monolythium/core-sdk";
import { submitNativeTx } from "./submit";

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
  /** Opt into the encrypted-mempool (private) lane. DEFAULT FALSE = plaintext
   *  `mesh_submitTx`, the path that confirms. Encryption costs more and is never
   *  mandatory; encrypted inclusion isn't live yet, so gate this behind
   *  Developer Mode. */
  private?: boolean;
}

export interface PlaceClobLimitOrderResult {
  txHash: string;
  from: string;
  calldataBytes: number;
  /** True if this went through the encrypted (preview) path. */
  wasPrivate: boolean;
}

export async function placeClobLimitOrder(
  args: PlaceClobLimitOrderArgs,
): Promise<PlaceClobLimitOrderResult> {
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

  const result = await submitNativeTx({
    seed: args.seed,
    to: PRECOMPILE_ADDRESSES.CLOB,
    input: calldataHex,
    executionUnitLimit:
      args.executionUnitLimit ?? SPOT_LIMIT_ORDER_EXECUTION_UNIT_LIMIT,
    private: args.private === true,
  });

  return {
    txHash: result.txHash,
    from: addressToTypedBech32("user", result.fromHex),
    calldataBytes: (calldataHex.length - 2) / 2,
    wasPrivate: result.wasPrivate,
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
  /** Opt into the encrypted-mempool (private) lane. DEFAULT FALSE = plaintext.
   *  See {@link PlaceClobLimitOrderArgs.private}. */
  private?: boolean;
}

export interface CancelClobOrderResult {
  txHash: string;
  from: string;
  calldataBytes: number;
  wasPrivate: boolean;
}

export async function cancelClobOrder(
  args: CancelClobOrderArgs,
): Promise<CancelClobOrderResult> {
  const calldataHex = encodeCancelOrderCalldata({ orderId: args.orderIdHex });

  const result = await submitNativeTx({
    seed: args.seed,
    to: PRECOMPILE_ADDRESSES.CLOB,
    input: calldataHex,
    executionUnitLimit: args.executionUnitLimit ?? CLOB_CANCEL_EXECUTION_UNIT_LIMIT,
    private: args.private === true,
  });

  return {
    txHash: result.txHash,
    from: addressToTypedBech32("user", result.fromHex),
    calldataBytes: (calldataHex.length - 2) / 2,
    wasPrivate: result.wasPrivate,
  };
}

export const CLOB_CANCEL_ORDER_SELECTOR = CLOB_SELECTORS.cancelOrder;
