// ERC-721 reader + transfer encoder.
//
// Standard EVM NFT surface — readers via `eth_call`, encoders via the
// canonical signatures. The browser-wallet's `lib/nft-client.ts` is
// the parity reference; this file mirrors that shape but routes wire
// I/O through the desktop wallet's `MonolythiumProvider` singleton
// + the `RpcOutcome<T>` envelope used everywhere else in the SDK.
//
// `safeTransferFrom` is the recommended path for ERC-721 (rejects
// transfers to non-receiver contracts). `transferFrom` is included as
// a fallback for the rare collection that lacks the safe variant.

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

export const ERC721_SIGNATURES = {
  name: "name()",
  symbol: "symbol()",
  balanceOf: "balanceOf(address)",
  ownerOf: "ownerOf(uint256)",
  tokenURI: "tokenURI(uint256)",
  tokenOfOwnerByIndex: "tokenOfOwnerByIndex(address,uint256)",
  transferFrom: "transferFrom(address,address,uint256)",
  safeTransferFrom: "safeTransferFrom(address,address,uint256)",
  supportsInterface: "supportsInterface(bytes4)",
} as const;

function selectorOf(signature: string): string {
  return keccak256(toUtf8Bytes(signature)).slice(0, 10);
}

export const ERC721_SELECTORS = {
  name: selectorOf(ERC721_SIGNATURES.name),
  symbol: selectorOf(ERC721_SIGNATURES.symbol),
  balanceOf: selectorOf(ERC721_SIGNATURES.balanceOf),
  ownerOf: selectorOf(ERC721_SIGNATURES.ownerOf),
  tokenURI: selectorOf(ERC721_SIGNATURES.tokenURI),
  tokenOfOwnerByIndex: selectorOf(ERC721_SIGNATURES.tokenOfOwnerByIndex),
  transferFrom: selectorOf(ERC721_SIGNATURES.transferFrom),
  safeTransferFrom: selectorOf(ERC721_SIGNATURES.safeTransferFrom),
  supportsInterface: selectorOf(ERC721_SIGNATURES.supportsInterface),
} as const;

/** ERC-165 interface ID for ERC-721 (per EIP-721). */
export const INTERFACE_ID_ERC721 = "0x80ac58cd";

// ─── ABI codec helpers ─────────────────────────────────────────────

function encodeAddress(addr: string): string {
  return zeroPadValue(addr.toLowerCase(), 32);
}

function encodeUint256(value: bigint): string {
  if (value < 0n) throw new Error("uint256 must be non-negative");
  return zeroPadValue(toBeHex(value), 32);
}

function decodeUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

function decodeAddress(hex: string): string {
  // Solidity right-aligns address inside a 32-byte word.
  if (!hex || hex.length < 66) return "0x" + "0".repeat(40);
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return "0x" + clean.slice(24).toLowerCase();
}

const STRING_IFACE = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function tokenURI(uint256) view returns (string)",
]);

function decodeString(returnHex: string, fnName: "name" | "symbol" | "tokenURI"): string {
  if (!returnHex || returnHex === "0x") return "";
  try {
    const decoded = STRING_IFACE.decodeFunctionResult(fnName, returnHex);
    const value = decoded[0];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

// ─── Public types ──────────────────────────────────────────────────

export interface Erc721CollectionMetadata {
  name: string;
  symbol: string;
}

// ─── Readers ───────────────────────────────────────────────────────

/**
 * Read `name()` + `symbol()` for an ERC-721 collection. Falls back to
 * empty strings for either field if the underlying call fails — many
 * older collections omit the metadata extension. Surfaces ok:false
 * only when both calls fail.
 */
export async function getNftCollectionMetadata(
  contract: string,
): Promise<RpcOutcome<Erc721CollectionMetadata>> {
  const provider = getProvider();
  const [nameOut, symbolOut] = await Promise.all([
    capture(() => provider.rpcClient.ethCall({ to: contract, data: ERC721_SELECTORS.name })),
    capture(() => provider.rpcClient.ethCall({ to: contract, data: ERC721_SELECTORS.symbol })),
  ]);
  if (!nameOut.ok && !symbolOut.ok) {
    return { ok: false, error: nameOut.error ?? "collection metadata unavailable" };
  }
  const name = nameOut.ok && typeof nameOut.value === "string"
    ? decodeString(nameOut.value, "name")
    : "";
  const symbol = symbolOut.ok && typeof symbolOut.value === "string"
    ? decodeString(symbolOut.value, "symbol")
    : "";
  return { ok: true, value: { name, symbol } };
}

/** ERC-721 `balanceOf(address)` — number of distinct tokens held by `owner`. */
export async function getNftBalance(
  contract: string,
  owner: string,
): Promise<RpcOutcome<bigint>> {
  const provider = getProvider();
  const data = ERC721_SELECTORS.balanceOf + encodeAddress(owner).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "balanceOf returned no data" };
  }
  return { ok: true, value: decodeUint256(out.value) };
}

/** ERC-721 `ownerOf(uint256)` — current owner of `tokenId`. */
export async function getNftOwner(
  contract: string,
  tokenId: bigint,
): Promise<RpcOutcome<string>> {
  const provider = getProvider();
  const data = ERC721_SELECTORS.ownerOf + encodeUint256(tokenId).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "ownerOf returned no data" };
  }
  return { ok: true, value: decodeAddress(out.value) };
}

/** ERC-721 `tokenURI(uint256)` — metadata URI for `tokenId`. */
export async function getNftTokenUri(
  contract: string,
  tokenId: bigint,
): Promise<RpcOutcome<string>> {
  const provider = getProvider();
  const data = ERC721_SELECTORS.tokenURI + encodeUint256(tokenId).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "tokenURI returned no data" };
  }
  return { ok: true, value: decodeString(out.value, "tokenURI") };
}

/**
 * ERC-721 Enumerable extension — `tokenOfOwnerByIndex(owner, idx)`.
 * Only collections that implement the Enumerable extension (interface
 * ID 0x780e9d63) respond. Other collections need event-log scanning
 * to find tokenIds; that path lands in Commit 5's discovery seam.
 */
export async function getNftTokenOfOwnerByIndex(
  contract: string,
  owner: string,
  index: bigint,
): Promise<RpcOutcome<bigint>> {
  const provider = getProvider();
  const data =
    ERC721_SELECTORS.tokenOfOwnerByIndex +
    encodeAddress(owner).slice(2) +
    encodeUint256(index).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "tokenOfOwnerByIndex returned no data" };
  }
  return { ok: true, value: decodeUint256(out.value) };
}

/**
 * ERC-165 `supportsInterface(0x80ac58cd)` check. Used by the custom
 * token-add flow to classify a pasted address.
 */
export async function supportsErc721(
  contract: string,
): Promise<boolean> {
  const provider = getProvider();
  // bytes4 arg is left-aligned in a 32-byte word.
  const interfaceIdPadded = (INTERFACE_ID_ERC721.slice(2) + "0".repeat(56)).slice(0, 64);
  const data = ERC721_SELECTORS.supportsInterface + interfaceIdPadded;
  try {
    const out = await provider.rpcClient.ethCall({ to: contract, data });
    if (typeof out !== "string") return false;
    return decodeUint256(out) !== 0n;
  } catch {
    return false;
  }
}

// ─── Encoders ──────────────────────────────────────────────────────

/**
 * Build a `safeTransferFrom(address,address,uint256)` TransactionRequest.
 * Recommended path — the chain rejects transfers to contracts that
 * haven't implemented the ERC-721 receiver interface, protecting users
 * from sending an NFT to a contract that can't release it.
 */
export function encodeSafeTransferFrom(args: {
  from: string;
  contract: string;
  to: string;
  tokenId: bigint;
}): TransactionRequest {
  const data = hexlify(
    concat([
      getBytes(ERC721_SELECTORS.safeTransferFrom),
      getBytes(encodeAddress(args.from)),
      getBytes(encodeAddress(args.to)),
      getBytes(encodeUint256(args.tokenId)),
    ]),
  );
  return { type: 2, from: args.from, to: args.contract, data, value: 0n };
}

/**
 * Build a `transferFrom(address,address,uint256)` TransactionRequest.
 * Fallback for collections that don't implement the safe variant —
 * the wallet UI should prefer `encodeSafeTransferFrom` and offer
 * this only as a "force-send" toggle.
 */
export function encodeTransferFrom(args: {
  from: string;
  contract: string;
  to: string;
  tokenId: bigint;
}): TransactionRequest {
  const data = hexlify(
    concat([
      getBytes(ERC721_SELECTORS.transferFrom),
      getBytes(encodeAddress(args.from)),
      getBytes(encodeAddress(args.to)),
      getBytes(encodeUint256(args.tokenId)),
    ]),
  );
  return { type: 2, from: args.from, to: args.contract, data, value: 0n };
}
