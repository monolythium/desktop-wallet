import { describe, expect, it } from "vitest";
import { encodeNameRegisterCall, nameRegistryAddressHex } from "@monolythium/core-sdk";
import { nameRegisterTx, quoteUnchanged } from "../name-registry";

describe("nameRegisterTx — the exact register(name, owner) submit inputs", () => {
  it("targets 0x110E, encodes register(name), and value == the exact quoted cost", () => {
    const cost = 5_000_000_000n; // a real U-curve cost in lythoshi
    const tx = nameRegisterTx("Alice.MONO", cost);
    expect(tx.to).toBe(nameRegistryAddressHex());
    // shown == submitted: the tx value is exactly the quoted cost.
    expect(tx.valueLythoshi).toBe(cost);
    expect(tx.feeClass).toBe("registry");
    // Calldata is the SDK register encoder (name lower-cased), owner default zero
    // (the caller becomes the owner).
    expect(tx.input).toBe(encodeNameRegisterCall("alice.mono"));
  });
});

describe("quoteUnchanged — confirm-time fee guard (no silent IncorrectFee)", () => {
  it("allows a submit only when the fresh quote equals the reviewed one", () => {
    expect(quoteUnchanged(5_000_000_000n, 5_000_000_000n)).toBe(true);
    // A base-fee move → different cost → blocked (would revert IncorrectFee).
    expect(quoteUnchanged(5_000_000_000n, 6_000_000_000n)).toBe(false);
  });
});
