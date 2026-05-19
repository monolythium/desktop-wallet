// Per-user entropy for autovote sampling — whitepaper §23.9.
//
// "Two delegators each picking Max Yield must not end up at the same
// cluster set." The algorithm reads:
//
//   seed = SHAKE256("monolythium.autovote.v1" || user_address ||
//                   latest_block_hash, 32)
//
// Within the eligible bracket, N clusters are sampled using
// Fisher-Yates keyed by an arithmetic stream derived from the seed.
// Same user + same block + same bracket → same selection (replayable
// for preview/confirm); different user + same block + same bracket →
// different selection (per-user randomization).
//
// The domain-separation prefix (`monolythium.autovote.v1`) is
// load-bearing — without it the same user's autovote seed would
// collide with any other v1 protocol slot that hashes the same
// (address, block) tuple. Version-tag any future format changes.

import { shake256 } from "@noble/hashes/sha3.js";
import type { ClusterSummary } from "./staking";

const DOMAIN_TAG = "monolythium.autovote.v1";

/**
 * Build the 32-byte autovote seed for `(userAddress, blockHash)`.
 * Both inputs are treated as opaque hex strings — 0x prefix optional,
 * mixed case fine (the underlying bytes are what matter).
 */
export function buildAutovoteSeed(
  userAddress: string,
  blockHash: string,
): Uint8Array {
  const tag = new TextEncoder().encode(DOMAIN_TAG);
  const addr = hexBytes(userAddress);
  const bh = hexBytes(blockHash);
  const buf = new Uint8Array(tag.length + addr.length + bh.length);
  buf.set(tag, 0);
  buf.set(addr, tag.length);
  buf.set(bh, tag.length + addr.length);
  return shake256(buf, { dkLen: 32 });
}

/**
 * Sample `count` clusters from `eligible` using a Fisher-Yates
 * shuffle keyed by `seed`. Deterministic for a given (seed, eligible)
 * pair; never mutates `eligible`.
 *
 * The PRNG is a re-seedable byte stream over SHAKE256 — every time
 * we need fresh bytes, we hash `seed || counter` and consume the
 * resulting 64 bytes. SHAKE256 is the natural XOF for this use case
 * (we already depend on @noble/hashes for PQM-1 derivation, so no
 * new crypto surface).
 */
export function sampleClusters(
  eligible: ClusterSummary[],
  count: number,
  seed: Uint8Array,
): ClusterSummary[] {
  if (count <= 0 || eligible.length === 0) return [];
  if (count >= eligible.length) return [...eligible];

  const rng = makeSeededByteStream(seed);
  const arr = [...eligible];
  // Fisher-Yates: swap each index with a random index ≤ itself.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextUint32() % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr.slice(0, count);
}

// ─── Internals ────────────────────────────────────────────────────

interface ByteStream {
  nextUint32(): number;
}

function makeSeededByteStream(seed: Uint8Array): ByteStream {
  let buffer = new Uint8Array(0);
  let offset = 0;
  let counter = 0;
  const refill = () => {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false);
    counter += 1;
    const input = new Uint8Array(seed.length + counterBytes.length);
    input.set(seed, 0);
    input.set(counterBytes, seed.length);
    buffer = shake256(input, { dkLen: 64 });
    offset = 0;
  };
  return {
    nextUint32(): number {
      if (offset + 4 > buffer.length) refill();
      const v =
        ((buffer[offset]! << 24) >>> 0) |
        (buffer[offset + 1]! << 16) |
        (buffer[offset + 2]! << 8) |
        buffer[offset + 3]!;
      offset += 4;
      return v >>> 0;
    },
  };
}

function hexBytes(input: string): Uint8Array {
  const trimmed = input.startsWith("0x") || input.startsWith("0X")
    ? input.slice(2)
    : input;
  if (trimmed.length === 0) return new Uint8Array(0);
  // Pad odd-length hex on the left so `0x1` → `[0x01]`.
  const padded = trimmed.length % 2 === 0 ? trimmed : "0" + trimmed;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    out[i / 2] = parseInt(padded.slice(i, i + 2), 16);
  }
  return out;
}
