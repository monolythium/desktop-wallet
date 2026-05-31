import { beforeEach, describe, expect, it, vi } from "vitest";

// `sendNativeLyth` must route through the shared submit seam with PLAINTEXT
// by default, and pass `private: true` only when the (preview-gated) Send
// toggle requests it. We mock the submit seam and assert the privacy flag.

const submitNativeTxSpy = vi.fn(
  (_args: { private?: boolean }): Promise<unknown> =>
    Promise.resolve({
      txHash: "0xfeed",
      fromHex: "0x000000000000000000000000000000000000abcd",
      fee: { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, gasLimit: 100_000n },
      wasPrivate: _args.private === true,
    }),
);

vi.mock("../submit", () => ({
  submitNativeTx: (args: { private?: boolean }) => submitNativeTxSpy(args),
}));

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { sendNativeLyth } from "../native-send";

const SEED = new Uint8Array(32).fill(1);
// A valid typed user bech32m recipient for the `0x…dead` address.
const TO = addressToTypedBech32("user", "0x000000000000000000000000000000000000dead");

beforeEach(() => {
  submitNativeTxSpy.mockClear();
});

describe("sendNativeLyth privacy posture", () => {
  it("defaults to PLAINTEXT (private:false)", async () => {
    const res = await sendNativeLyth({ seed: SEED, to: TO, amountLyth: "1.5" });

    expect(submitNativeTxSpy).toHaveBeenCalledTimes(1);
    const call = submitNativeTxSpy.mock.calls[0]![0];
    expect(call.private).toBe(false);
    expect(res.wasPrivate).toBe(false);
    expect(res.amountLythoshi).toBe("150000000");
  });

  it("passes private:true only when explicitly requested", async () => {
    const res = await sendNativeLyth({ seed: SEED, to: TO, amountLyth: "2", private: true });

    const call = submitNativeTxSpy.mock.calls[0]![0];
    expect(call.private).toBe(true);
    expect(res.wasPrivate).toBe(true);
  });
});
