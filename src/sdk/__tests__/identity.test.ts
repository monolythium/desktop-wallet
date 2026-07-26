import { describe, expect, it } from "vitest";
import { blake3 } from "@noble/hashes/blake3.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  ML_DSA_65_SEED_LEN,
  MlDsa65Backend,
  bytesToHex,
} from "@monolythium/core-sdk/crypto";
import { deriveLiveWalletIdentity } from "../live";
import { requireTypedUserAddressHex } from "../address";

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
    // The wallet's identity carries the TYPED form, so the derivation law is
    // asserted on the bytes it decodes to — the domain-separated BLAKE3 digest,
    // never the retired Keccak scheme. The form is asserted separately below.
    expect(requireTypedUserAddressHex(deriveLiveWalletIdentity(seed).address, "wallet")).toBe(
      expected,
    );
    expect(expected).not.toBe(retiredKeccakAddress);
  });
});

describe("the derived identity's address form", () => {
  const seed = new Uint8Array(ML_DSA_65_SEED_LEN).fill(0x42);

  it("is the typed form this wallet transacts in, not raw hex", () => {
    // The SDK backend hands back a raw 0x address. This wallet retired that
    // form everywhere — the send parser rejects it, the spending policy
    // canonicalises away from it, and the vault catalogue on this very page
    // converts before rendering. The derivation seam is where the SDK's form
    // becomes the wallet's, so no consumer downstream can get it wrong.
    const { address } = deriveLiveWalletIdentity(seed);
    expect(address.startsWith("0x")).toBe(false);
    expect(address.startsWith("mono1")).toBe(true);
  });

  it("is accepted by the wallet's own balance reader", () => {
    // THE closed loop this fixes. The panel derived an address, handed it to
    // loadLiveWalletBalance, and that reader's first act is this validator —
    // which threw "raw 0x addresses are retired" on the wallet's own address.
    // Balance and nonce then rendered "unavailable until unlock + RPC", which
    // was never true: the request had not left the wallet.
    const { address } = deriveLiveWalletIdentity(seed);
    expect(() => requireTypedUserAddressHex(address, "wallet")).not.toThrow();
  });

  it("round-trips to the same BLAKE3 bytes the SDK derived", () => {
    // The conversion must be lossless — a typed address that decodes to
    // different bytes would be a worse bug than the one being fixed.
    const backend = MlDsa65Backend.fromSeed(seed);
    const { address } = deriveLiveWalletIdentity(seed);
    expect(requireTypedUserAddressHex(address, "wallet")).toBe(backend.getAddress());
  });
});
