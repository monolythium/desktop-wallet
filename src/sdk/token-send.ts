// MRC-20 token send path.
//
// Parallels sendNativeLyth (native-send.ts): routes an MRC-20 transfer through
// the SAME submitNativeTx seam, but the tx carries the token-factory precompile
// calldata (encodeTokenFactoryTransferCalldata) with `value` 0 — the transfer is
// non-payable, so no native LYTH is ever attached — and the fee is an ordinary
// native-LYTH execution fee.
//
// Fund-safety (defense-in-depth over the compose gate): the amount is encoded at
// the token's REAL decimals (from the F1 metadata cache); a null decimals throws
// rather than encode at a guessed scale; and the encoded base units must display
// back (via the exact inverse) to the same amount before anything is signed.

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import {
  encodeTokenFactoryTransferCalldata,
  tokenFactoryAddressHex,
} from "@monolythium/core-sdk";
import { requireTypedUserAddressHex } from "./address";
import { submitNativeTx } from "./submit";
import {
  isSupportedTokenDecimals,
  tokenAmountBaseToDisplay,
  tokenAmountToBase,
} from "./token-send-compose";

/** Conservative execution-unit reserve for a token-factory transfer — a
 *  precompile call heavier than a bare native transfer (~100k). Mirrors the
 *  delegation precompile reserve (150k) with headroom; the actual fee is metered
 *  lower, so over-reserving only inflates the shown max (safe) and prevents an
 *  out-of-units failure. Passed to the fee preview too so shown == reserved. */
export const TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT = 250_000n;

export interface SendMrc20Args {
  seed: Uint8Array;
  /** 32-byte token id (`0x`-hex) — the factory-origin MRC-20 asset. */
  tokenId: string;
  /** Typed `mono1...` recipient (already resolved fail-closed by the caller). */
  to: string;
  /** Human amount in TOKEN units (validated by the compose gate). */
  amount: string;
  /** The token's real decimals from `lyth_mrcMetadata`; null/undefined BLOCKS. */
  decimals: number | null | undefined;
  executionUnitLimit?: bigint;
}

export interface SendMrc20Result {
  txHash: string;
  from: string;
  tokenId: string;
  /** Encoded base-units amount (exact integer string). */
  amountBase: string;
  /** Human amount that was shown/encoded (exact inverse of amountBase). */
  amountDisplay: string;
  nonce: number;
}

/**
 * Encode + submit an MRC-20 `transfer(tokenId, to, amount)` through the shared
 * plaintext submit seam. `to = tokenFactoryAddressHex()` (0x…1000), `value` 0.
 */
export async function sendMrc20Token(args: SendMrc20Args): Promise<SendMrc20Result> {
  // Block an unavailable OR out-of-range (non-u8) scale — never encode an amount
  // at a decimals the display path itself would refuse.
  if (!isSupportedTokenDecimals(args.decimals)) {
    throw new Error(
      "token decimals unavailable or out of range — refusing to encode at a guessed/bad scale",
    );
  }
  const decimals = args.decimals;
  const amountBase = tokenAmountToBase(args.amount, decimals);
  if (amountBase <= 0n) throw new Error("amount must be greater than zero");

  const amountDisplay = tokenAmountBaseToDisplay(amountBase, decimals);
  // Round-trip: the encoded base units must display back to exactly this amount,
  // and that display must re-encode to the same base units. A scaling drift is
  // caught here, never signed.
  if (tokenAmountToBase(amountDisplay, decimals) !== amountBase) {
    throw new Error("amount round-trip mismatch — refusing to send a mis-scaled amount");
  }

  // Fail-closed recipient → 20-byte hex for the calldata `to` (throws on a raw
  // 0x or malformed bech32m). The SAME resolved recipient the caller showed.
  const toHex = requireTypedUserAddressHex(args.to, "recipient");
  const input = encodeTokenFactoryTransferCalldata(args.tokenId, toHex, amountBase);

  const result = await submitNativeTx({
    seed: args.seed,
    to: tokenFactoryAddressHex(),
    input,
    valueLythoshi: 0n,
    feeClass: "transfer",
    executionUnitLimit: args.executionUnitLimit ?? TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT,
  });

  return {
    txHash: result.txHash,
    from: addressToTypedBech32("user", result.fromHex),
    tokenId: args.tokenId,
    amountBase: amountBase.toString(),
    amountDisplay,
    nonce: result.nonce,
  };
}
