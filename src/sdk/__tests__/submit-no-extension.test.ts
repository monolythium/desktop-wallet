// A non-MRV write signs no transaction extension.
//
// `NativeEvmTxFields` declares `extensions?: readonly NativeTxExtensionLike[]`,
// and the preimage map recorded the field as "empty on every shipping path".
// That is half right: the MRV seam signs a NON-empty one, and it is the field
// that makes the transaction an MRV transaction at all.
//
// So `extensions` is a signed component this wallet deliberately does not
// render — a user cannot read an opaque body, and a kind byte supports no
// decision. That omission is only safe while the value is known. This is what
// makes it known: every write through `submitNativeTx` must sign an absent or
// empty extension list, and one that grows one silently is a defect nothing
// else in the tree would see.
//
// Asserted on the fields handed to the ENCODER, not on the arguments handed to
// the seam: the property is about what gets signed, and a field added between
// the two would be invisible to the weaker check.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeEvmTxFields } from "@monolythium/core-sdk/crypto";

const cap = vi.hoisted(() => ({ built: [] as NativeEvmTxFields[] }));

vi.mock("@monolythium/core-sdk/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@monolythium/core-sdk/crypto")>();
  return {
    ...actual,
    buildPlaintextSubmission: (args: { backend: unknown; tx: NativeEvmTxFields }) => {
      cap.built.push(args.tx);
      return {
        innerTxHashHex: `0x${"11".repeat(32)}`,
        innerSighashHex: `0x${"22".repeat(32)}`,
        signedTxWireHex: "0x00",
        innerWireBytes: 1,
      };
    },
    submitPlaintextTransaction: async () => `0x${"11".repeat(32)}`,
  };
});

vi.mock("../client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client")>()),
  getProvider: () => ({ rpcClient: { endpoint: "http://test.invalid" } }),
}));

vi.mock("../native-rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../native-rpc")>()),
  getNativeTransactionCount: async () => 3n,
}));

import { submitNativeTx } from "../submit";
import { buildMrvCallNativeTxPlan, mrvAddressToBech32 } from "@monolythium/core-sdk";
import { MlDsa65Backend, ML_DSA_65_SEED_LEN } from "@monolythium/core-sdk/crypto";

const SEED = new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x41);
const TO = "0x000000000000000000000000000000000000dead";
const FEE = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 30_000n };

beforeEach(() => {
  cap.built = [];
});

describe("the submit seam signs no transaction extension", () => {
  it("leaves `extensions` absent or empty on a plain native write", async () => {
    await submitNativeTx({ seed: SEED, to: TO, valueLythoshi: 1n, resolvedFee: FEE });

    // Anti-vacuity: the encoder really was reached, so "no extension" is a
    // statement about a built transaction and not about a call that never
    // happened.
    expect(cap.built).toHaveLength(1);
    const tx = cap.built[0]!;
    expect(tx.to).toBe(TO);
    expect(tx.extensions ?? []).toHaveLength(0);
  });

  it("holds for a calldata write too — the shape every precompile seam uses", async () => {
    await submitNativeTx({
      seed: SEED,
      to: TO,
      input: "0x0102",
      valueLythoshi: 0n,
      resolvedFee: FEE,
    });
    expect(cap.built).toHaveLength(1);
    expect(cap.built[0]!.input).toBe("0x0102");
    expect(cap.built[0]!.extensions ?? []).toHaveLength(0);
  });
});

describe("the control — the MRV seam DOES sign one", () => {
  it("carries a non-empty extension, so the assertions above are not vacuous", () => {
    // Without this, both tests above would keep passing after `extensions` was
    // removed from the signed type entirely, or after nothing anywhere set it.
    // The MRV plan is built directly here because that is the only production
    // path that populates the field.
    const backend = MlDsa65Backend.fromSeed(SEED);
    const plan = buildMrvCallNativeTxPlan(
      mrvAddressToBech32("contract", "0x2222222222222222222222222222222222222222"),
      "0x0102",
      {
        from: mrvAddressToBech32("user", backend.getAddress()),
        chainId: 69_420n,
        nonce: 5n,
        valueLythoshi: "0",
        executionUnitLimit: 50_000n,
        maxExecutionFeeLythoshi: "2000000000",
        priorityTipLythoshi: "1000000000",
      },
    );
    const extensions = plan.tx.extensions ?? [];
    expect(extensions.length).toBeGreaterThan(0);
    // And it is a real descriptor, not a placeholder — the field the preimage
    // map recorded as "always empty on every shipping path".
    expect(extensions[0]).toHaveProperty("kind");
  });
});
