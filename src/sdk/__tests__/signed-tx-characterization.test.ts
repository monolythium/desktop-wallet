import { describe, expect, it } from "vitest";
import {
  MlDsa65Backend,
  ML_DSA_65_PUBLIC_KEY_LEN,
  ML_DSA_65_SIGNATURE_LEN,
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
    // SCOPE — what this hash does and does not pin.
    //
    // The canonical tx hash is keccak over the tx preimage, the RAW signature
    // bytes and the RAW public-key bytes. It does NOT cover the bincode framing
    // those two are wrapped in on the wire, so it is blind to the opaque
    // header — including the enum variant discriminant. Neither does the
    // `startsWith` prefix below: that pins bytes 0..12, and the discriminants
    // live far past it.
    //
    // A wire-variant change is therefore invisible to every assertion in this
    // test: the hashes, the byte count and the prefix all stay identical.
    // That is not hypothetical — it is how a discriminant of 3 shipped against
    // a chain expecting 0, refusing every transaction, with this file green.
    // The discriminant is pinned in the separate describe block below.
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

// ---------------------------------------------------------------------------
// ML-DSA-65 bincode wire variant.
//
// The chain declares `MlDsa65` FIRST in both the `PublicKey` and `Signature`
// enums, so bincode writes its variant index as 0 (MlDsa87=1, Falcon512=2,
// Falcon1024=3). Declaration order IS the wire format there. A wallet writing
// any other index has its envelopes decoded as a different algorithm and
// refused at admission — the failure is total and affects every signed
// operation, so this value is pinned here rather than trusted.
//
// The expected 0 below is a LITERAL, deliberately. Importing the SDK's own
// `ENUM_VARIANT_INDEX_ML_DSA_65` would assert the SDK equals itself and would
// stay green through exactly the change this test exists to catch. The literal
// pins the CHAIN's declaration order, independently of what the SDK ships.
// ---------------------------------------------------------------------------

/** Wire layout of an ML-DSA-65 opaque header, from the SDK's encoder. */
const OPAQUE_VARIANT_AT = 0; // u32 LE — the bincode enum discriminant
const OPAQUE_ALGO_AT = 4; //    u16 LE — algorithm id
const OPAQUE_LEN_AT = 6; //     u64 LE — payload length
const OPAQUE_HEADER_BYTES = 14; // payload starts here

/** The chain's declaration-order index for ML-DSA-65. */
const ML_DSA_65_WIRE_VARIANT = 0;
/** `StandardAlgo::MlDsa65` as it appears on the wire. */
const ML_DSA_65_ALGO_ID = 1001;

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Every offset in `wire` carrying an ML-DSA-65 opaque header whose payload
 * length is `payloadLen`.
 *
 * Located by the algorithm id AND the payload length AND the payload actually
 * fitting — never by a hard-coded offset, so this keeps pointing at the
 * discriminant if the envelope's layout or any payload length ever moves.
 */
function findOpaqueHeaders(view: DataView, total: number, payloadLen: number): number[] {
  const found: number[] = [];
  for (let off = 0; off + OPAQUE_HEADER_BYTES <= total; off += 1) {
    if (view.getUint16(off + OPAQUE_ALGO_AT, true) !== ML_DSA_65_ALGO_ID) continue;
    if (Number(view.getBigUint64(off + OPAQUE_LEN_AT, true)) !== payloadLen) continue;
    if (off + OPAQUE_HEADER_BYTES + payloadLen > total) continue;
    found.push(off);
  }
  return found;
}

describe("ML-DSA-65 wire variant (the chain decodes by declaration order)", () => {
  const FIELDS = [
    { label: "signature", payloadLen: ML_DSA_65_SIGNATURE_LEN },
    { label: "public key", payloadLen: ML_DSA_65_PUBLIC_KEY_LEN },
  ] as const;

  it.each(FIELDS)(
    "encodes the $label opaque header at wire variant 0",
    ({ label, payloadLen }) => {
      const s = buildPlaintextSubmission({ backend: MlDsa65Backend.fromSeed(SEED), tx: TX });
      const wire = hexToBytes(s.signedTxWireHex);
      const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);

      const offsets = findOpaqueHeaders(view, wire.length, payloadLen);
      // Exactly one — so the assertions below cannot be reading adjacent data
      // that merely happens to look like a header.
      expect(offsets, `expected exactly one ${label} opaque header`).toHaveLength(1);
      const off = offsets[0]!;

      // The neighbours prove the offset really is a header before the
      // discriminant is judged.
      expect(view.getUint16(off + OPAQUE_ALGO_AT, true)).toBe(ML_DSA_65_ALGO_ID);
      expect(Number(view.getBigUint64(off + OPAQUE_LEN_AT, true))).toBe(payloadLen);

      expect(
        view.getUint32(off + OPAQUE_VARIANT_AT, true),
        `${label} discriminant at offset ${off}: a non-zero index means the ` +
          `chain decodes this envelope as a different algorithm and refuses it`,
      ).toBe(ML_DSA_65_WIRE_VARIANT);
    },
  );

  it("finds the two headers at distinct offsets", () => {
    const s = buildPlaintextSubmission({ backend: MlDsa65Backend.fromSeed(SEED), tx: TX });
    const wire = hexToBytes(s.signedTxWireHex);
    const view = new DataView(wire.buffer, wire.byteOffset, wire.byteLength);

    const sig = findOpaqueHeaders(view, wire.length, ML_DSA_65_SIGNATURE_LEN);
    const pk = findOpaqueHeaders(view, wire.length, ML_DSA_65_PUBLIC_KEY_LEN);
    expect(sig).toHaveLength(1);
    expect(pk).toHaveLength(1);
    expect(sig[0]).not.toBe(pk[0]);
  });
});
