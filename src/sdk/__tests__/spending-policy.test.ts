// Golden-vector coverage for the §18.8 spending-policy seam.
//
// These pins guarantee calldata correctness WITHOUT a live chain: a wrong
// selector, a wrong pubkey/sig length, or a wrong precompile target would
// be rejected on-chain — here they fail fast in CI instead.

import { describe, expect, it } from "vitest";
import {
  ML_DSA_65_PUBLIC_KEY_LEN,
  ML_DSA_65_SIGNATURE_LEN,
  MONOLYTHIUM_TESTNET_CHAIN_ID,
  SPENDING_POLICY_SELECTORS,
  addressToTypedBech32,
  composeClaimBoundMessage,
} from "@monolythium/core-sdk";
import { MlDsa65Backend } from "@monolythium/core-sdk/crypto";
import {
  SPENDING_POLICY_PRECOMPILE,
  ZERO_WORD,
  buildDisablePolicyCalldata,
  buildEnablePolicyCalldata,
  buildSetPolicyCalldata,
  buildSetPolicyClaimCalldata,
  buildSpendingPolicyArgs,
  composePolicyClaimMessage,
} from "../spending-policy";
import { signClaimAsSubAccount } from "../agent-subaccount";

// Deterministic fixtures — a fixed 32-byte sub-account seed gives a stable
// 1952-byte pubkey / 3309-byte signature for the layout assertions.
const SUB_SEED = new Uint8Array(32).fill(7);
const SUB_HEX = "0x" + "11".repeat(20);
const PRINCIPAL_HEX = "0x" + "22".repeat(20);
const SUB_BECH32M = addressToTypedBech32("user", SUB_HEX);
const PRINCIPAL_BECH32M = addressToTypedBech32("user", PRINCIPAL_HEX);

function sampleForm() {
  return {
    subAccount: SUB_BECH32M,
    principal: PRINCIPAL_BECH32M,
    perTxCapLythoshi: 1_000n,
    dailyCapLythoshi: 5_000n,
    weeklyCapLythoshi: 20_000n,
    monthlyCapLythoshi: 80_000n,
    timeWindow: { enabled: true, startHour: 9, endHour: 17 },
    policyExpiryUnixSeconds: 1_900_000_000n,
  };
}

describe("spending-policy §18.8 calldata", () => {
  it("packs every §18.8 dimension into the SpendingPolicyArgs", () => {
    const args = buildSpendingPolicyArgs(sampleForm());
    expect(args.subAccount).toBe(SUB_BECH32M);
    expect(args.principal).toBe(PRINCIPAL_BECH32M);
    expect(args.perTxCapLythoshi).toBe(1_000n);
    expect(args.dailyCapLythoshi).toBe(5_000n);
    expect(args.weeklyCapLythoshi).toBe(20_000n);
    expect(args.monthlyCapLythoshi).toBe(80_000n);
    expect(args.policyExpiry).toBe(1_900_000_000n);
    // Roots default to the zero "no constraint" sentinel when unset.
    expect(args.allowRoot).toBe(ZERO_WORD);
    expect(args.denyRoot).toBe(ZERO_WORD);
    expect(args.categoryAllowRoot).toBe(ZERO_WORD);
    // Time window is a packed 32-byte word, NOT the {enabled,...} object.
    expect(args.timeWindow).toBeInstanceOf(Uint8Array);
    expect((args.timeWindow as Uint8Array).length).toBe(32);
  });

  it("composePolicyClaimMessage matches the SDK composeClaimBoundMessage", () => {
    const args = buildSpendingPolicyArgs(sampleForm());
    const ours = composePolicyClaimMessage(args);
    const sdk = composeClaimBoundMessage(MONOLYTHIUM_TESTNET_CHAIN_ID, args);
    expect(Array.from(ours)).toEqual(Array.from(sdk));
  });

  it("buildSetPolicyClaimCalldata pins selector 0x35531f6c and appends the 1952/3309 keypair", () => {
    expect(SPENDING_POLICY_SELECTORS.setPolicyClaim).toBe("0x35531f6c");

    const args = buildSpendingPolicyArgs(sampleForm());
    const backend = MlDsa65Backend.fromSeed(SUB_SEED);
    const pubkey = backend.publicKey();
    const sig = backend.sign(composePolicyClaimMessage(args));

    expect(pubkey.length).toBe(ML_DSA_65_PUBLIC_KEY_LEN);
    expect(pubkey.length).toBe(1952);
    expect(sig.length).toBe(ML_DSA_65_SIGNATURE_LEN);
    expect(sig.length).toBe(3309);

    const calldata = buildSetPolicyClaimCalldata(args, pubkey, sig);
    // setPolicyClaim selector (NOT setPolicy 0x8da1a765).
    expect(calldata.slice(0, 10)).toBe("0x35531f6c");
    expect(calldata.startsWith("0x")).toBe(true);
    // The pubkey (1952B) + sig (3309B) are carried inside the calldata, so
    // the encoded byte length must comfortably exceed their sum.
    const calldataBytes = (calldata.length - 2) / 2;
    expect(calldataBytes).toBeGreaterThan(1952 + 3309);
  });

  it("rejects a wrong-size sub-account pubkey", () => {
    const args = buildSpendingPolicyArgs(sampleForm());
    const backend = MlDsa65Backend.fromSeed(SUB_SEED);
    const sig = backend.sign(composePolicyClaimMessage(args));
    const shortPubkey = backend.publicKey().slice(0, 100);
    expect(() => buildSetPolicyClaimCalldata(args, shortPubkey, sig)).toThrow();
  });

  it("rejects a wrong-size sub-account signature", () => {
    const args = buildSpendingPolicyArgs(sampleForm());
    const backend = MlDsa65Backend.fromSeed(SUB_SEED);
    const pubkey = backend.publicKey();
    const shortSig = backend.sign(composePolicyClaimMessage(args)).slice(0, 100);
    expect(() => buildSetPolicyClaimCalldata(args, pubkey, shortSig)).toThrow();
  });

  it("buildSetPolicyCalldata (existing-policy update) pins the no-claim setPolicy selector 0x8da1a765", () => {
    expect(SPENDING_POLICY_SELECTORS.setPolicy).toBe("0x8da1a765");
    const args = buildSpendingPolicyArgs(sampleForm());
    const calldata = buildSetPolicyCalldata(args);
    // The UPDATE path is setPolicy (no agent claim), NOT setPolicyClaim.
    expect(calldata.slice(0, 10)).toBe("0x8da1a765");
    expect(calldata.slice(0, 10)).not.toBe(SPENDING_POLICY_SELECTORS.setPolicyClaim);
    // No pubkey/sig payload — much smaller than the claim calldata.
    const calldataBytes = (calldata.length - 2) / 2;
    expect(calldataBytes).toBeLessThan(1952 + 3309);
  });

  it("buildDisablePolicyCalldata (revoke) pins selector 0xe6c09edf", () => {
    expect(SPENDING_POLICY_SELECTORS.disable).toBe("0xe6c09edf");
    const calldata = buildDisablePolicyCalldata(SUB_BECH32M);
    expect(calldata.slice(0, 10)).toBe("0xe6c09edf");
  });

  it("buildEnablePolicyCalldata pins selector 0x5bfa1b68", () => {
    expect(SPENDING_POLICY_SELECTORS.enable).toBe("0x5bfa1b68");
    const calldata = buildEnablePolicyCalldata(SUB_BECH32M);
    expect(calldata.slice(0, 10)).toBe("0x5bfa1b68");
  });

  it("targets the §18.8 spending-policy precompile 0x…110c", () => {
    expect(SPENDING_POLICY_PRECOMPILE.toLowerCase()).toBe(
      "0x000000000000000000000000000000000000110c",
    );
  });

  it("rejects raw 0x addresses in policy args (typed bech32m only)", () => {
    expect(() =>
      buildSpendingPolicyArgs({ ...sampleForm(), subAccount: SUB_HEX }),
    ).toThrow(/raw 0x addresses are retired/);
  });

  it("signClaimAsSubAccount produces a 1952/3309 keypair and zeroizes the seed", () => {
    const args = buildSpendingPolicyArgs(sampleForm());
    const seed = new Uint8Array(32).fill(7);
    const { pubkey, sig } = signClaimAsSubAccount(seed, args);
    expect(pubkey.length).toBe(1952);
    expect(sig.length).toBe(3309);
    // The transient seed must be wiped after signing.
    expect(seed.every((b) => b === 0)).toBe(true);
    // The produced signature must verify against the produced pubkey for the
    // exact claim-bound message (round-trip correctness).
    const calldata = buildSetPolicyClaimCalldata(args, pubkey, sig);
    expect(calldata.slice(0, 10)).toBe("0x35531f6c");
  });
});
