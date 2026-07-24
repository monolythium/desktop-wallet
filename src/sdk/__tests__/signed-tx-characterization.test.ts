import { describe, expect, it } from "vitest";
import {
  MlDsa65Backend,
  buildPlaintextSubmission,
  type NativeEvmTxFields,
} from "@monolythium/core-sdk/crypto";

// Characterization pin for the SIGNED WIRE (V-B). F3 split submitNativeTx into
// `buildPlaintextSubmission` (which yields the hash locally) + `submitPlaintext-
// Transaction`. The SDK's own `submitTransaction` is exactly that pair in that
// order (dist/crypto/index.js), so F3 is byte-identical by construction — this
// test is the regression anchor: a known seed + tx must produce these exact
// signed bytes. ML-DSA-65 here signs with `{ extraEntropy: false }`, i.e.
// DETERMINISTIC (no hedge), so the wire + hash are stable and pinnable. Uses the
// REAL SDK crypto (unmocked) — unlike submit.test.ts, which stubs the build.

const SEED = new Uint8Array(32);
for (let i = 0; i < 32; i += 1) SEED[i] = i + 1; // 0x0102…20

const TX: NativeEvmTxFields = {
  chainId: 69_420n,
  nonce: 7n,
  maxFeePerGas: 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  gasLimit: 30_000n,
  to: "0x000000000000000000000000000000000000dead",
  value: 1_250_000_000_000_000_000n,
  input: "0x",
};

describe("signed-tx characterization pin (V-B — F3 preserves the signed bytes)", () => {
  it("derives the pinned address from the seed", () => {
    expect(MlDsa65Backend.fromSeed(SEED).getAddress()).toBe(
      "0x0b70cd43a426f1322e9311008476813da1755ac0",
    );
  });

  it("produces the exact canonical tx hash + sighash + wire length for a known tx", () => {
    const s = buildPlaintextSubmission({ backend: MlDsa65Backend.fromSeed(SEED), tx: TX });
    // The canonical tx hash is keccak over the tx preimage + signature + pubkey,
    // so this single value pins the entire signed envelope's byte identity.
    expect(s.innerTxHashHex).toBe(
      "0x6dbd307541062dffb5bb69b023b820935a0bfc2ffddd195a29e1d0225ca562ca",
    );
    expect(s.innerSighashHex).toBe(
      "0xd34099a30b2b2c9933a1e60189131591e20c37ccf72bf48589a9d5b0e51c7a8c",
    );
    expect(s.innerWireBytes).toBe(5486);
    expect(s.signedTxWireHex).toHaveLength(10_974);
    expect(s.signedTxWireHex.startsWith("0x2c0f0100000000000700000000")).toBe(true);
  });

  it("is DETERMINISTIC — building twice yields byte-identical wire + hash", () => {
    const a = buildPlaintextSubmission({ backend: MlDsa65Backend.fromSeed(SEED), tx: TX });
    const b = buildPlaintextSubmission({ backend: MlDsa65Backend.fromSeed(SEED), tx: TX });
    expect(b.signedTxWireHex).toBe(a.signedTxWireHex);
    expect(b.innerTxHashHex).toBe(a.innerTxHashHex);
  });
});
