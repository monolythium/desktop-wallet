// Delegation tx encoders.
//
// Targets the delegation precompile at `0x000000000000000000000000000000000000100A`
// (Law §7.6; SDK constant `PRECOMPILE_ADDRESSES.DELEGATION`).
//
// Selectors are the keccak-derived 4-byte heads of these Solidity
// signatures (mono-core/crates/precompiles/system/delegation/abi.rs):
//
//   delegate(uint32 cluster, uint16 weightBps)
//   undelegate(uint32 cluster)
//   redelegate(uint32 fromCluster, uint32 toCluster, uint16 weightBps)
//   claim()
//   setAutoCompound(bool enabled)
//
// `weightBps` is a 16-bit basis-points value (0..10_000 represents 0%..100%
// of the wallet's total bonded weight, with per-cluster cap enforced
// protocol-side per §23.7). The wallet's user-facing amount input is
// translated to bps by the Stake UI before this encoder is called; this
// module only deals in protocol-shaped values.

import {
  keccak256,
  getBytes,
  hexlify,
  concat,
  toUtf8Bytes,
  zeroPadValue,
  toBeHex,
} from "ethers";
import type { TransactionRequest } from "ethers";
import {
  ADDRESS_HRP as _UNUSED,
  PRECOMPILE_ADDRESSES,
} from "@monolythium/core-sdk";

// Re-export the precompile address so callers don't have to dig into
// the SDK consts to confirm where the tx is targeted.
export const DELEGATION_PRECOMPILE = PRECOMPILE_ADDRESSES.DELEGATION;
void _UNUSED; // import preserves the SDK as a transitive presence — see file header

// ─── Selectors ────────────────────────────────────────────────────

/**
 * Solidity-canonical signatures for every encoder this module emits.
 * Pinned here as `as const` so the keccak derivation in
 * `DELEGATION_SELECTORS` is byte-stable across re-renders + tests.
 */
export const DELEGATION_SIGNATURES = {
  delegate: "delegate(uint32,uint16)",
  undelegate: "undelegate(uint32)",
  redelegate: "redelegate(uint32,uint32,uint16)",
  claim: "claim()",
  setAutoCompound: "setAutoCompound(bool)",
} as const;

function selectorOf(signature: string): string {
  // Route through ethers' `toUtf8Bytes` so the input to `keccak256`
  // is a `BytesLike` (Uint8Array). Wrapping `TextEncoder.encode` in a
  // plain object trips ethers' BytesLike runtime check.
  const hash = keccak256(toUtf8Bytes(signature));
  // keccak256 returns 0x-prefixed 32-byte hex; the first 4 bytes
  // (8 hex chars after the 0x prefix) are the selector.
  return hash.slice(0, 10);
}

/**
 * 4-byte selectors keyed by op name. Derived once on first access,
 * cached for the lifetime of the module (the SDK does the same on
 * its Rust side via `OnceLock`).
 */
export const DELEGATION_SELECTORS = {
  delegate: selectorOf(DELEGATION_SIGNATURES.delegate),
  undelegate: selectorOf(DELEGATION_SIGNATURES.undelegate),
  redelegate: selectorOf(DELEGATION_SIGNATURES.redelegate),
  claim: selectorOf(DELEGATION_SIGNATURES.claim),
  setAutoCompound: selectorOf(DELEGATION_SIGNATURES.setAutoCompound),
} as const;

// ─── Calldata builders ────────────────────────────────────────────

function encodeUint(n: number | bigint): string {
  // Right-aligned 32-byte word; ethers' `zeroPadValue` handles the
  // pad-left semantics Solidity uses for fixed-width uints.
  return zeroPadValue(toBeHex(BigInt(n)), 32);
}

function encodeBool(v: boolean): string {
  return zeroPadValue(toBeHex(BigInt(v ? 1 : 0)), 32);
}

function callDataHex(selector: string, ...wordsHex: string[]): string {
  // `concat` accepts 0x-prefixed hex strings; output is single 0x-prefixed hex.
  return hexlify(
    concat([getBytes(selector), ...wordsHex.map((w) => getBytes(w))]),
  );
}

/**
 * Build a `TransactionRequest` for `delegate(cluster, weightBps)`.
 *
 * `weightBps` must be 0..=10_000. The protocol enforces a per-cluster
 * cap separately (§23.7), so the UI should pre-validate against the
 * cap before calling this encoder.
 *
 * `from` is required because ethers uses it when estimating gas; the
 * signer is expected to set it on the signing path either way.
 */
export function encodeDelegate(args: {
  from: string;
  clusterId: number;
  weightBps: number;
}): TransactionRequest {
  validateClusterId(args.clusterId);
  validateWeightBps(args.weightBps);
  return {
    type: 2,
    from: args.from,
    to: DELEGATION_PRECOMPILE,
    data: callDataHex(
      DELEGATION_SELECTORS.delegate,
      encodeUint(args.clusterId),
      encodeUint(args.weightBps),
    ),
    value: 0n,
  };
}

/** Build a `TransactionRequest` for `undelegate(cluster)`. */
export function encodeUndelegate(args: {
  from: string;
  clusterId: number;
}): TransactionRequest {
  validateClusterId(args.clusterId);
  return {
    type: 2,
    from: args.from,
    to: DELEGATION_PRECOMPILE,
    data: callDataHex(
      DELEGATION_SELECTORS.undelegate,
      encodeUint(args.clusterId),
    ),
    value: 0n,
  };
}

/**
 * Build a `TransactionRequest` for
 * `redelegate(fromCluster, toCluster, weightBps)`.
 *
 * The chain atomically moves bps from one cluster to another — no
 * unbonding window applies (see §14 cluster mobility).
 */
export function encodeRedelegate(args: {
  from: string;
  fromClusterId: number;
  toClusterId: number;
  weightBps: number;
}): TransactionRequest {
  validateClusterId(args.fromClusterId);
  validateClusterId(args.toClusterId);
  validateWeightBps(args.weightBps);
  if (args.fromClusterId === args.toClusterId) {
    throw new Error("redelegate: fromClusterId and toClusterId must differ");
  }
  return {
    type: 2,
    from: args.from,
    to: DELEGATION_PRECOMPILE,
    data: callDataHex(
      DELEGATION_SELECTORS.redelegate,
      encodeUint(args.fromClusterId),
      encodeUint(args.toClusterId),
      encodeUint(args.weightBps),
    ),
    value: 0n,
  };
}

/**
 * Build a `TransactionRequest` for `claim()` — settles + withdraws
 * the caller's pending delegation rewards (MS-CORE-0009).
 */
export function encodeClaim(args: { from: string }): TransactionRequest {
  return {
    type: 2,
    from: args.from,
    to: DELEGATION_PRECOMPILE,
    data: DELEGATION_SELECTORS.claim,
    value: 0n,
  };
}

/** Build a `TransactionRequest` for `setAutoCompound(bool)`. */
export function encodeSetAutoCompound(args: {
  from: string;
  enabled: boolean;
}): TransactionRequest {
  return {
    type: 2,
    from: args.from,
    to: DELEGATION_PRECOMPILE,
    data: callDataHex(
      DELEGATION_SELECTORS.setAutoCompound,
      encodeBool(args.enabled),
    ),
    value: 0n,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────

function validateClusterId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 0xff_ff_ff_ff) {
    throw new Error(`clusterId out of range: ${id}`);
  }
}

function validateWeightBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`weightBps must be 0..=10000 (got ${bps})`);
  }
}
