import { beforeEach, describe, expect, it, vi } from "vitest";

// `sendNativeLyth` routes through the shared submit seam, which submits
// PLAINTEXT — the encrypted mempool was removed, so there is no private lane.
// We mock the submit seam and assert the send flows through it unchanged.

const submitNativeTxSpy = vi.fn(
  (_args: unknown): Promise<unknown> =>
    Promise.resolve({
      txHash: "0xfeed",
      fromHex: "0x000000000000000000000000000000000000abcd",
      fee: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, gasLimit: 100_000n },
    }),
);

vi.mock("../submit", () => ({
  submitNativeTx: (args: unknown) => submitNativeTxSpy(args),
}));

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { sendNativeLyth } from "../native-send";

const SEED = new Uint8Array(32).fill(1);
// A valid typed user bech32m recipient for the `0x…dead` address.
const TO = addressToTypedBech32("user", "0x000000000000000000000000000000000000dead");

beforeEach(() => {
  submitNativeTxSpy.mockClear();
});

describe("sendNativeLyth", () => {
  it("routes through the submit seam and returns the parsed amount", async () => {
    const res = await sendNativeLyth({ seed: SEED, to: TO, amountLyth: "1.5" });

    expect(submitNativeTxSpy).toHaveBeenCalledTimes(1);
    expect(res.amountLythoshi).toBe("1500000000000000000");
    expect(res.txHash).toBe("0xfeed");
  });
});
