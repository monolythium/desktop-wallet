import { beforeEach, describe, expect, it, vi } from "vitest";

// sendMrc20Token routes through the SAME shared submit seam as native send; we
// mock the seam and assert the token transfer is encoded + submitted correctly
// (to = token-factory precompile, value 0, calldata = transfer(tokenId,to,amt)).

const submitNativeTxSpy = vi.fn(
  (_args: unknown): Promise<unknown> =>
    Promise.resolve({
      txHash: "0xfeed",
      fromHex: "0x000000000000000000000000000000000000abcd",
      fee: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, gasLimit: 250_000n },
      nonce: 7,
    }),
);

vi.mock("../submit", () => ({
  submitNativeTx: (args: unknown) => submitNativeTxSpy(args),
}));

import {
  addressToTypedBech32,
  encodeTokenFactoryTransferCalldata,
  tokenFactoryAddressHex,
} from "@monolythium/core-sdk";
import { requireTypedUserAddressHex } from "../address";
import { sendMrc20Token, TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT } from "../token-send";

const SEED = new Uint8Array(32).fill(1);
const TO = addressToTypedBech32("user", "0x000000000000000000000000000000000000dead");
const TO_HEX = requireTypedUserAddressHex(TO, "to");
const TOKEN_ID = "0x" + "cd".repeat(32);

function submittedArgs() {
  return submitNativeTxSpy.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => submitNativeTxSpy.mockClear());

describe("sendMrc20Token", () => {
  it("encodes transfer(tokenId,to,amount) to the factory precompile with value 0", async () => {
    const res = await sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "1.5", decimals: 6 });

    expect(submitNativeTxSpy).toHaveBeenCalledTimes(1);
    const args = submittedArgs();
    // Target is the token-factory precompile (0x…1000), NOT the recipient.
    expect(args.to).toBe(tokenFactoryAddressHex());
    // Non-payable transfer → no native LYTH attached.
    expect(args.valueLythoshi).toBe(0n);
    expect(args.feeClass).toBe("transfer");
    expect(args.executionUnitLimit).toBe(TOKEN_TRANSFER_EXECUTION_UNIT_LIMIT);
    // Calldata is exactly the SDK-encoded transfer with the resolved recipient
    // hex + the base-unit amount at the token's real decimals (1.5 * 10^6).
    expect(args.input).toBe(encodeTokenFactoryTransferCalldata(TOKEN_ID, TO_HEX, 1_500_000n));

    expect(res.amountBase).toBe("1500000");
    expect(res.amountDisplay).toBe("1.5"); // shown == encoded
    expect(res.txHash).toBe("0xfeed");
    expect(res.nonce).toBe(7);
  });

  it("scales an 18-decimal amount exactly (no float) above 2^53", async () => {
    await sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "12.345678901234567890", decimals: 18 });
    expect(submittedArgs().input).toBe(
      encodeTokenFactoryTransferCalldata(TOKEN_ID, TO_HEX, 12_345_678_901_234_567_890n),
    );
  });

  it("encodes a 0-decimal token as whole units", async () => {
    await sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "42", decimals: 0 });
    expect(submittedArgs().input).toBe(encodeTokenFactoryTransferCalldata(TOKEN_ID, TO_HEX, 42n));
  });

  it("BLOCKS (throws, no submit) when decimals are unavailable — never a guessed scale", async () => {
    await expect(
      sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "1.5", decimals: null }),
    ).rejects.toThrow(/decimals unavailable/);
    await expect(
      sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "1.5", decimals: undefined }),
    ).rejects.toThrow(/decimals unavailable/);
    expect(submitNativeTxSpy).not.toHaveBeenCalled();
  });

  it("BLOCKS (throws, no submit) on an out-of-range / non-integer decimals (malformed metadata)", async () => {
    await expect(
      sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "1", decimals: 256 }),
    ).rejects.toThrow();
    await expect(
      sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "1", decimals: 6.5 }),
    ).rejects.toThrow();
    expect(submitNativeTxSpy).not.toHaveBeenCalled();
  });

  it("throws (no submit) on a zero or over-precise amount", async () => {
    await expect(
      sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "0", decimals: 6 }),
    ).rejects.toThrow();
    await expect(
      sendMrc20Token({ seed: SEED, tokenId: TOKEN_ID, to: TO, amount: "1.2345678", decimals: 6 }),
    ).rejects.toThrow();
    expect(submitNativeTxSpy).not.toHaveBeenCalled();
  });

  it("throws (no submit) on a raw 0x recipient — fail-closed address handling", async () => {
    await expect(
      sendMrc20Token({
        seed: SEED,
        tokenId: TOKEN_ID,
        to: "0x000000000000000000000000000000000000dead",
        amount: "1",
        decimals: 6,
      }),
    ).rejects.toThrow();
    expect(submitNativeTxSpy).not.toHaveBeenCalled();
  });
});
