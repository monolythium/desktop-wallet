// ERC-20 reader + transfer encoder.
//
// Monolythium v4.0 is fully EVM-compatible (§22.6), so wallet-side ERC-20
// support is standard: keccak-derived selectors + ABI-encoded args, fired
// at the contract address via `eth_call`. The SDK's `RpcClient.ethCall`
// is the wire; this module owns the calldata shape + decoding.
//
// Decimals are read once (cached upstream by the token-list seam in
// Commit 6) — they never change for a given contract under any
// real-world ERC-20.
//
// Errors are surfaced as `RpcOutcome<T>` envelopes (matches Phase 1
// `live.ts`, Phase 2 `staking.ts`, Phase 3 `naming.ts`) so the UI
// renders a banner on failure rather than unwinding a throw.

import {
  Interface,
  zeroPadValue,
  toBeHex,
  hexlify,
  concat,
  getBytes,
  toUtf8Bytes,
  keccak256,
} from "ethers";
import type { TransactionRequest } from "ethers";
import { getProvider } from "./client";
import { capture, type RpcOutcome } from "./live";

// ─── Selectors ────────────────────────────────────────────────────

/** Solidity-canonical signatures we encode against. Selectors are
 *  derived once at module-load via `keccak256(toUtf8Bytes(sig)).slice(0,10)`. */
export const ERC20_SIGNATURES = {
  name: "name()",
  symbol: "symbol()",
  decimals: "decimals()",
  balanceOf: "balanceOf(address)",
  totalSupply: "totalSupply()",
  transfer: "transfer(address,uint256)",
  approve: "approve(address,uint256)",
  allowance: "allowance(address,address)",
} as const;

function selectorOf(signature: string): string {
  return keccak256(toUtf8Bytes(signature)).slice(0, 10);
}

export const ERC20_SELECTORS = {
  name: selectorOf(ERC20_SIGNATURES.name),
  symbol: selectorOf(ERC20_SIGNATURES.symbol),
  decimals: selectorOf(ERC20_SIGNATURES.decimals),
  balanceOf: selectorOf(ERC20_SIGNATURES.balanceOf),
  totalSupply: selectorOf(ERC20_SIGNATURES.totalSupply),
  transfer: selectorOf(ERC20_SIGNATURES.transfer),
  approve: selectorOf(ERC20_SIGNATURES.approve),
  allowance: selectorOf(ERC20_SIGNATURES.allowance),
} as const;

// ─── ABI codec — minimal local helpers ─────────────────────────────
// Using ethers' `Interface` for decoding when the return is non-trivial
// (string), and the small typed helpers below for fixed-width words.

function encodeAddress(addr: string): string {
  return zeroPadValue(addr.toLowerCase(), 32);
}

function encodeUint256(value: bigint): string {
  if (value < 0n) {
    throw new Error("uint256 must be non-negative");
  }
  return zeroPadValue(toBeHex(value), 32);
}

function decodeUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

/** Ethers Interface for ERC-20 — used for the single non-trivial
 *  decode path (Solidity `string` return). Encoding goes through the
 *  selector + word helpers above so the calldata layout is explicit. */
const ERC20_IFACE = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

function decodeString(returnHex: string, fnName: "name" | "symbol"): string {
  if (!returnHex || returnHex === "0x") return "";
  try {
    const decoded = ERC20_IFACE.decodeFunctionResult(fnName, returnHex);
    const value = decoded[0];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

// ─── Public types ──────────────────────────────────────────────────

export interface Erc20Metadata {
  name: string;
  symbol: string;
  decimals: number;
}

// ─── Readers ───────────────────────────────────────────────────────

/**
 * Read `name()` + `symbol()` + `decimals()` for an ERC-20 contract.
 * Three parallel `eth_call`s; throws (via the outer `capture`) only
 * if every call fails. Otherwise partial data is filled in with
 * sane defaults: empty string for missing name/symbol, 18 for
 * missing decimals.
 *
 * Non-standard tokens (older USDT clones, some bridged assets) return
 * bytes32 rather than string for name/symbol; this reader will surface
 * them as empty rather than throwing — the Tokens page renders a
 * fallback label in that case.
 */
export async function getTokenMetadata(
  contract: string,
): Promise<RpcOutcome<Erc20Metadata>> {
  const provider = getProvider();
  const client = provider.rpcClient;
  const [nameOut, symbolOut, decimalsOut] = await Promise.all([
    capture(() => client.ethCall({ to: contract, data: ERC20_SELECTORS.name })),
    capture(() => client.ethCall({ to: contract, data: ERC20_SELECTORS.symbol })),
    capture(() => client.ethCall({ to: contract, data: ERC20_SELECTORS.decimals })),
  ]);
  if (!nameOut.ok && !symbolOut.ok && !decimalsOut.ok) {
    return {
      ok: false,
      error: nameOut.error ?? symbolOut.error ?? decimalsOut.error ?? "metadata unavailable",
    };
  }
  const name = nameOut.ok && typeof nameOut.value === "string"
    ? decodeString(nameOut.value, "name")
    : "";
  const symbol = symbolOut.ok && typeof symbolOut.value === "string"
    ? decodeString(symbolOut.value, "symbol")
    : "";
  // decimals() returns uint8 right-padded to 32 bytes; integer cast.
  let decimals = 18;
  if (decimalsOut.ok && typeof decimalsOut.value === "string") {
    const raw = decodeUint256(decimalsOut.value);
    // Anything > 36 is almost certainly garbage from a non-ERC-20.
    decimals = raw > 36n ? 18 : Number(raw);
  }
  return { ok: true, value: { name, symbol, decimals } };
}

/**
 * Read the ERC-20 balance for `holder` on `contract`. Returns the raw
 * uint256 — caller applies decimals for display.
 */
export async function getTokenBalance(
  contract: string,
  holder: string,
): Promise<RpcOutcome<bigint>> {
  const provider = getProvider();
  const data = ERC20_SELECTORS.balanceOf + encodeAddress(holder).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "balanceOf returned no data" };
  }
  return { ok: true, value: decodeUint256(out.value) };
}

/**
 * Read the ERC-20 `allowance(owner, spender)`. Used by future
 * approval-aware flows (Phase 5+ DEX integrations). Included here
 * because it's part of the standard reader surface.
 */
export async function getTokenAllowance(
  contract: string,
  owner: string,
  spender: string,
): Promise<RpcOutcome<bigint>> {
  const provider = getProvider();
  const data =
    ERC20_SELECTORS.allowance +
    encodeAddress(owner).slice(2) +
    encodeAddress(spender).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "allowance returned no data" };
  }
  return { ok: true, value: decodeUint256(out.value) };
}

// ─── Encoders ──────────────────────────────────────────────────────

/**
 * Build a `transfer(address,uint256)` TransactionRequest targeting
 * `contract`. The wallet's existing native/ledger signer paths take
 * this through preview → auth → submit unchanged.
 */
export function encodeTransfer(args: {
  from: string;
  contract: string;
  to: string;
  amount: bigint;
}): TransactionRequest {
  const data = hexlify(
    concat([
      getBytes(ERC20_SELECTORS.transfer),
      getBytes(encodeAddress(args.to)),
      getBytes(encodeUint256(args.amount)),
    ]),
  );
  return {
    type: 2,
    from: args.from,
    to: args.contract,
    data,
    value: 0n,
  };
}

/**
 * Build an `approve(spender,amount)` TransactionRequest. Minimal-scope
 * for now — most wallet flows don't need approvals directly, but a few
 * DEX hookups will.
 */
export function encodeApprove(args: {
  from: string;
  contract: string;
  spender: string;
  amount: bigint;
}): TransactionRequest {
  const data = hexlify(
    concat([
      getBytes(ERC20_SELECTORS.approve),
      getBytes(encodeAddress(args.spender)),
      getBytes(encodeUint256(args.amount)),
    ]),
  );
  return {
    type: 2,
    from: args.from,
    to: args.contract,
    data,
    value: 0n,
  };
}

/**
 * Format an ERC-20 raw balance for display. `decimals = 18` matches
 * the LYTH baseline most contracts default to. Returns a JS number
 * via the same wei-to-LYTH precision dance the chain snapshot uses
 * — display only.
 */
export function formatTokenAmount(raw: bigint, decimals: number): number {
  if (decimals === 0) return Number(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  return Number(whole) + Number(frac) / Number(scale);
}

/**
 * Inverse of `formatTokenAmount`: parse a user-typed decimal string
 * into a raw uint256 for use in `encodeTransfer`. Throws on garbage.
 */
export function parseTokenAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === ".") throw new Error("amount required");
  if (!/^\d*\.?\d*$/.test(trimmed)) throw new Error("invalid amount");
  const [whole = "0", frac = ""] = trimmed.split(".") as [string, string?];
  if (frac.length > decimals) throw new Error(`too many decimal places (max ${decimals})`);
  const paddedFrac = frac.padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + (paddedFrac === "" ? 0n : BigInt(paddedFrac));
}
