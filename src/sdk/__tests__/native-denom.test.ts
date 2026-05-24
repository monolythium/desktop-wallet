import { describe, expect, it } from "vitest";
import { MONOLYTHIUM_TESTNET_CHAIN_ID } from "@monolythium/core-sdk";
import { balanceQuantityToLyth, balanceQuantityToLythoshi } from "../client";
import { buildNativeLythTransferPlan } from "../native-send";

describe("native LYTH denomination helpers", () => {
  it("renders RPC balance quantities as lythoshi-backed LYTH", () => {
    expect(balanceQuantityToLythoshi("0x5f5e100")).toBe("100000000");
    expect(balanceQuantityToLyth("0x5f5e100")).toBe("1");
    expect(balanceQuantityToLyth("0x77359400")).toBe("20");
    expect(balanceQuantityToLyth("not-a-quantity")).toBe("0");
  });

  it("builds encrypted native transfer tx values in lythoshi", () => {
    const plan = buildNativeLythTransferPlan({
      chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
      nonce: 7n,
      to: "0x000000000000000000000000000000000000dead",
      amountLyth: "1.25",
      executionUnitPriceLythoshi: 11n,
      priorityTipLythoshi: 2n,
      executionUnitLimit: 30_000n,
    });

    expect(plan.amountLythoshi).toBe("125000000");
    expect(plan.amountDisplay).toBe("1.25");
    expect(plan.tx.value).toBe("125000000");
    expect(plan.tx.chainId).toBe(MONOLYTHIUM_TESTNET_CHAIN_ID);
    expect(plan.tx.maxFeePerGas).toBe(11n);
    expect(plan.tx.maxPriorityFeePerGas).toBe(2n);
    expect(plan.tx.gasLimit).toBe(30_000n);
  });

  it("rejects non-canonical native LYTH decimals before signing", () => {
    expect(() =>
      buildNativeLythTransferPlan({
        chainId: MONOLYTHIUM_TESTNET_CHAIN_ID,
        nonce: 7n,
        to: "0x000000000000000000000000000000000000dead",
        amountLyth: "1.000000001",
        executionUnitPriceLythoshi: 11n,
      }),
    ).toThrow(/8 decimal/);
  });
});
