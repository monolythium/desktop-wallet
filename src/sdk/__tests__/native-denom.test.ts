import { describe, expect, it } from "vitest";
import { MONOLYTHIUM_TESTNET_CHAIN_ID, addressToTypedBech32 } from "@monolythium/core-sdk";
import { balanceQuantityToLyth, balanceQuantityToLythoshi } from "../client";
import { buildNativeLythTransferPlan } from "../native-send";

describe("native LYTH denomination helpers", () => {
  it("renders RPC balance quantities as lythoshi-backed LYTH", () => {
    // 1 LYTH = 1e18 lythoshi = 0xde0b6b3a7640000; 20 LYTH = 0x1158e460913d00000
    expect(balanceQuantityToLythoshi("0xde0b6b3a7640000")).toBe("1000000000000000000");
    expect(balanceQuantityToLyth("0xde0b6b3a7640000")).toBe("1");
    expect(balanceQuantityToLyth("0x1158e460913d00000")).toBe("20");
    expect(balanceQuantityToLyth("not-a-quantity")).toBe("0");
  });

  it("builds encrypted native transfer tx values in lythoshi", () => {
    const plan = buildNativeLythTransferPlan({
      chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
      nonce: 7n,
      to: addressToTypedBech32("user", "0x000000000000000000000000000000000000dead"),
      amountLyth: "1.25",
      executionUnitPriceLythoshi: 11n,
      priorityTipLythoshi: 2n,
      executionUnitLimit: 30_000n,
    });

    expect(plan.amountLythoshi).toBe("1250000000000000000");
    expect(plan.amountDisplay).toBe("1.25");
    expect(plan.tx.value).toBe("1250000000000000000");
    expect(plan.tx.chainId).toBe(MONOLYTHIUM_TESTNET_CHAIN_ID);
    expect(plan.tx.to).toBe("0x000000000000000000000000000000000000dead");
    expect(plan.tx.maxFeePerGas).toBe(11n);
    expect(plan.tx.maxPriorityFeePerGas).toBe(2n);
    expect(plan.tx.gasLimit).toBe(30_000n);
  });

  it("rejects non-canonical native LYTH decimals before signing", () => {
    expect(() =>
      buildNativeLythTransferPlan({
        chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
        nonce: 7n,
        to: addressToTypedBech32("user", "0x000000000000000000000000000000000000dead"),
        amountLyth: "1.0000000000000000001", // 19 fractional digits > 18-decimal denom
        executionUnitPriceLythoshi: 11n,
      }),
    ).toThrow(/18 decimal/);
  });
});
