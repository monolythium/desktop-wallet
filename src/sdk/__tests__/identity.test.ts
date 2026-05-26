import { describe, expect, it } from "vitest";
import { blake3 } from "@noble/hashes/blake3.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  ML_DSA_65_SEED_LEN,
  MlDsa65Backend,
  bytesToHex,
} from "@monolythium/core-sdk/crypto";
import { deriveLiveWalletIdentity } from "../live";

const ADDRESS_DOMAIN = new TextEncoder().encode("MONO_ADDRESS_BLAKE3_20_V1");
const ML_DSA_65_ALGO_ID_BE = Uint8Array.from([0x03, 0xe9]);

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((len, chunk) => len + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe("desktop ML-DSA identity derivation", () => {
  it("derives vault addresses with the BLAKE3 address domain", () => {
    const seed = new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x42);
    const backend = MlDsa65Backend.fromSeed(seed);
    const publicKey = backend.publicKey();

    const expected = bytesToHex(
      blake3(concatBytes(ADDRESS_DOMAIN, ML_DSA_65_ALGO_ID_BE, publicKey)).slice(0, 20),
    );
    const retiredKeccakAddress = bytesToHex(keccak_256(publicKey).slice(12));

    expect(backend.getAddress()).toBe(expected);
    expect(deriveLiveWalletIdentity(seed).address).toBe(expected);
    expect(expected).not.toBe(retiredKeccakAddress);
  });
});
