// Shared deterministic fixtures for SDK + UI tests.
//
// Why: `Wallet.createRandom()` is flaky under jsdom because of how Node
// surfaces `Buffer` to ethers' rng path. Pinning a known-good private
// key + its derived address gives every test stable wire bytes and
// stable EIP-155 signatures.
//
// The pinned private key is Anvil's default account #0 — a value
// every Ethereum dev tool published in the last six years recognises
// as "fake test money." It must never appear in any production code
// path; encoding it as a constant here documents that intent.
//
// `MONOLYTHIUM_TESTNET_CHAIN_ID` is re-exported from the SDK so test
// files have a single import surface for "the test environment's
// chain identity" without reaching into the SDK each time.

import { MONOLYTHIUM_TESTNET_CHAIN_ID } from "@monolythium/core-sdk";

/**
 * Anvil account #0 private key (well-known test vector). Pinned so
 * the test is byte-reproducible across environments. NEVER use this
 * in production code — any address it controls is public domain.
 */
export const TEST_PRIVKEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/** The 20-byte address derived from `TEST_PRIVKEY` (EIP-55 checksum form). */
export const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** Mono-testnet chain id, re-exported so tests have one import surface. */
export { MONOLYTHIUM_TESTNET_CHAIN_ID };

/**
 * Known-good bech32m pairs for round-trip tests. Both hex inputs are
 * mapped through the SDK's `addressToBech32` to derive the canonical
 * mono1 form; pinning both directions catches a regression in either
 * the SDK helper or the desktop-side display wrapper.
 *
 * `zero` is the all-zero account — the simplest possible test vector.
 * `anvil0` is the Anvil account-#0 address derived from `TEST_PRIVKEY`
 * — exercises a real 20-byte address with mixed bits.
 */
export const TEST_BECH32M = {
  zero: {
    hex: "0x0000000000000000000000000000000000000000",
    bech32: "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxq7cge",
  },
  anvil0: {
    hex: TEST_ADDRESS,
    bech32: "mono17w0adeg64ky0daxwd2ugyuneellmjgnxk794yy",
  },
} as const;

/** Burn address — common Send-test destination, matches `SEND_DEMO.to`. */
export const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";
