// Smoke test for shared fixtures. Catches drift between the pinned
// constants and what the SDK actually produces — if the SDK's
// bech32m encoder changes, this test fails before any caller does.

import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import {
  addressToBech32,
  bech32ToAddress,
  normalizeAddressHex,
} from "@monolythium/core-sdk";
import {
  BURN_ADDRESS,
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  TEST_ADDRESS,
  TEST_BECH32M,
  TEST_PRIVKEY,
} from "./fixtures";

describe("test fixtures", () => {
  it("TEST_PRIVKEY derives TEST_ADDRESS", () => {
    const w = new Wallet(TEST_PRIVKEY);
    expect(w.address).toBe(TEST_ADDRESS);
  });

  it("TEST_BECH32M.zero round-trips through the SDK encoder", () => {
    expect(addressToBech32(TEST_BECH32M.zero.hex)).toBe(TEST_BECH32M.zero.bech32);
    expect(normalizeAddressHex(TEST_BECH32M.zero.bech32)).toBe(TEST_BECH32M.zero.hex);
  });

  it("TEST_BECH32M.anvil0 round-trips through the SDK encoder", () => {
    // bech32m is case-sensitive on the body, lowercase-canonical; the
    // hex side is EIP-55 mixed-case but the SDK's normalizer keeps the
    // checksum form on the way out.
    const lowerHex = TEST_BECH32M.anvil0.hex.toLowerCase();
    expect(addressToBech32(TEST_BECH32M.anvil0.hex)).toBe(TEST_BECH32M.anvil0.bech32);
    expect(bech32ToAddress(TEST_BECH32M.anvil0.bech32)).toBe(lowerHex);
  });

  it("BURN_ADDRESS is a well-formed 20-byte hex address", () => {
    expect(BURN_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("MONOLYTHIUM_TESTNET_CHAIN_ID is re-exported from the SDK", () => {
    expect(typeof MONOLYTHIUM_TESTNET_CHAIN_ID).toBe("bigint");
    expect(MONOLYTHIUM_TESTNET_CHAIN_ID > 0n).toBe(true);
  });
});
