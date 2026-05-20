// ERC-1155 reader + transfer encoder.
//
// EIP-1155 is multi-token: one contract represents many fungible /
// semi-fungible / non-fungible token ids. Balance is keyed by
// (owner, tokenId) — no `ownerOf`, since a single token id can have
// many holders.
//
// `safeTransferFrom` carries an `amount` (fungible quantity per id) +
// an opaque `data` bytes payload (always empty for wallet-side
// transfers; receiver-contract hooks read it).
//
// `uri(tokenId)` may contain the literal `{id}` placeholder per
// EIP-1155 §metadata — the wallet substitutes a 64-char lowercase-hex
// zero-padded token id before fetching metadata.

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

export const ERC1155_SIGNATURES = {
  balanceOf: "balanceOf(address,uint256)",
  balanceOfBatch: "balanceOfBatch(address[],uint256[])",
  uri: "uri(uint256)",
  safeTransferFrom: "safeTransferFrom(address,address,uint256,uint256,bytes)",
  safeBatchTransferFrom:
    "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
  supportsInterface: "supportsInterface(bytes4)",
} as const;

function selectorOf(signature: string): string {
  return keccak256(toUtf8Bytes(signature)).slice(0, 10);
}

export const ERC1155_SELECTORS = {
  balanceOf: selectorOf(ERC1155_SIGNATURES.balanceOf),
  balanceOfBatch: selectorOf(ERC1155_SIGNATURES.balanceOfBatch),
  uri: selectorOf(ERC1155_SIGNATURES.uri),
  safeTransferFrom: selectorOf(ERC1155_SIGNATURES.safeTransferFrom),
  safeBatchTransferFrom: selectorOf(ERC1155_SIGNATURES.safeBatchTransferFrom),
  supportsInterface: selectorOf(ERC1155_SIGNATURES.supportsInterface),
} as const;

/** ERC-165 interface ID for ERC-1155 (per EIP-1155). */
export const INTERFACE_ID_ERC1155 = "0xd9b67a26";

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

const URI_IFACE = new Interface([
  "function uri(uint256) view returns (string)",
  "function balanceOfBatch(address[], uint256[]) view returns (uint256[])",
]);

function decodeUriString(returnHex: string): string {
  if (!returnHex || returnHex === "0x") return "";
  try {
    const decoded = URI_IFACE.decodeFunctionResult("uri", returnHex);
    const value = decoded[0];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function decodeBalanceBatch(returnHex: string): bigint[] {
  if (!returnHex || returnHex === "0x") return [];
  try {
    const decoded = URI_IFACE.decodeFunctionResult("balanceOfBatch", returnHex);
    const arr = decoded[0];
    if (!Array.isArray(arr)) return [];
    return arr.map((v) => BigInt(v as bigint | string | number));
  } catch {
    return [];
  }
}

// ─── Readers ───────────────────────────────────────────────────────

/** ERC-1155 `balanceOf(owner, tokenId)`. */
export async function getMultiTokenBalance(
  contract: string,
  owner: string,
  tokenId: bigint,
): Promise<RpcOutcome<bigint>> {
  const provider = getProvider();
  const data =
    ERC1155_SELECTORS.balanceOf +
    encodeAddress(owner).slice(2) +
    encodeUint256(tokenId).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "balanceOf returned no data" };
  }
  return { ok: true, value: decodeUint256(out.value) };
}

/**
 * ERC-1155 `balanceOfBatch(owners[], tokenIds[])` — single call returns
 * the per-pair balance vector. `owners` and `tokenIds` must be the
 * same length; throws otherwise (chain would revert anyway).
 */
export async function getMultiTokenBalanceBatch(
  contract: string,
  owners: string[],
  tokenIds: bigint[],
): Promise<RpcOutcome<bigint[]>> {
  if (owners.length !== tokenIds.length) {
    return { ok: false, error: "owners.length !== tokenIds.length" };
  }
  if (owners.length === 0) return { ok: true, value: [] };
  // ABI for two dynamic arrays of equal length:
  //   head: ownersOffset | tokenIdsOffset
  //   ownersTail:  len | addr0 | addr1 | … (padded)
  //   tokenIdsTail: len | id0 | id1 | …
  const n = BigInt(owners.length);
  const ownersOffset = encodeUint256(64n); // 2 * 32
  const ownersTailBytes = 32 + owners.length * 32;
  const tokenIdsOffset = encodeUint256(BigInt(64 + ownersTailBytes));
  const ownersTail = hexlify(
    concat([
      getBytes(encodeUint256(n)),
      ...owners.map((a) => getBytes(encodeAddress(a))),
    ]),
  );
  const tokenIdsTail = hexlify(
    concat([
      getBytes(encodeUint256(n)),
      ...tokenIds.map((id) => getBytes(encodeUint256(id))),
    ]),
  );
  const data =
    ERC1155_SELECTORS.balanceOfBatch +
    ownersOffset.slice(2) +
    tokenIdsOffset.slice(2) +
    ownersTail.slice(2) +
    tokenIdsTail.slice(2);
  const provider = getProvider();
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "balanceOfBatch returned no data" };
  }
  return { ok: true, value: decodeBalanceBatch(out.value) };
}

/** ERC-1155 `uri(tokenId)`. Caller substitutes `{id}` via
 *  `substituteErc1155IdPlaceholder` before resolving the URI. */
export async function getMultiTokenUri(
  contract: string,
  tokenId: bigint,
): Promise<RpcOutcome<string>> {
  const provider = getProvider();
  const data = ERC1155_SELECTORS.uri + encodeUint256(tokenId).slice(2);
  const out = await capture(() => provider.rpcClient.ethCall({ to: contract, data }));
  if (!out.ok || typeof out.value !== "string") {
    return { ok: false, error: out.error ?? "uri returned no data" };
  }
  return { ok: true, value: decodeUriString(out.value) };
}

/**
 * Substitute the literal `{id}` placeholder in an ERC-1155 URI with the
 * 64-char lowercase-hex zero-padded token id (per EIP-1155 §metadata).
 * Idempotent for URIs without the placeholder.
 */
export function substituteErc1155IdPlaceholder(
  uri: string,
  tokenId: bigint,
): string {
  if (!uri.includes("{id}")) return uri;
  const padded = tokenId.toString(16).padStart(64, "0");
  return uri.replace(/\{id\}/g, padded);
}

/** ERC-165 `supportsInterface(0xd9b67a26)` check. */
export async function supportsErc1155(contract: string): Promise<boolean> {
  const provider = getProvider();
  const interfaceIdPadded = (INTERFACE_ID_ERC1155.slice(2) + "0".repeat(56)).slice(0, 64);
  const data = ERC1155_SELECTORS.supportsInterface + interfaceIdPadded;
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
 * Build a `safeTransferFrom(from, to, tokenId, amount, data)`
 * TransactionRequest. `data` defaults to empty bytes — wallet flows
 * never need to carry receiver-hook payload.
 *
 * Calldata layout for (address, address, uint256, uint256, bytes):
 *   static head: from(32) | to(32) | id(32) | amount(32) | dataOffset(32)
 *   dynamic tail: dataLength(32) | dataBytes(padded)
 *
 * dataOffset is always 5*32 = 0xa0 = 160 (5 static words above).
 */
export function encodeSafeTransferFrom1155(args: {
  from: string;
  contract: string;
  to: string;
  tokenId: bigint;
  amount: bigint;
  data?: string;
}): TransactionRequest {
  const dataBytes = args.data && args.data !== "0x"
    ? getBytes(args.data)
    : new Uint8Array(0);
  const dataLenWord = encodeUint256(BigInt(dataBytes.length));
  // Pad the bytes to a 32-byte multiple.
  const paddedLen = Math.ceil(dataBytes.length / 32) * 32;
  const padded = new Uint8Array(paddedLen);
  padded.set(dataBytes);
  const calldata = hexlify(
    concat([
      getBytes(ERC1155_SELECTORS.safeTransferFrom),
      getBytes(encodeAddress(args.from)),
      getBytes(encodeAddress(args.to)),
      getBytes(encodeUint256(args.tokenId)),
      getBytes(encodeUint256(args.amount)),
      getBytes(encodeUint256(160n)),
      getBytes(dataLenWord),
      padded,
    ]),
  );
  return { type: 2, from: args.from, to: args.contract, data: calldata, value: 0n };
}

/**
 * Build a `safeBatchTransferFrom(from, to, ids[], amounts[], data)`
 * TransactionRequest. `ids` and `amounts` must be the same length.
 *
 * Calldata layout for (address, address, uint256[], uint256[], bytes):
 *   static head: from(32) | to(32) | idsOffset(32) | amountsOffset(32) | dataOffset(32)
 *   ids tail:    length(32) | id0 | id1 | …
 *   amounts tail: length(32) | a0 | a1 | …
 *   data tail:   length(32) | bytes (padded)
 */
export function encodeSafeBatchTransferFrom1155(args: {
  from: string;
  contract: string;
  to: string;
  tokenIds: bigint[];
  amounts: bigint[];
  data?: string;
}): TransactionRequest {
  if (args.tokenIds.length !== args.amounts.length) {
    throw new Error("tokenIds.length !== amounts.length");
  }
  const n = BigInt(args.tokenIds.length);
  const dataBytes = args.data && args.data !== "0x"
    ? getBytes(args.data)
    : new Uint8Array(0);
  const paddedLen = Math.ceil(dataBytes.length / 32) * 32;
  const padded = new Uint8Array(paddedLen);
  padded.set(dataBytes);

  // Offsets are measured from start of args section (after selector).
  // 5 static head words = 160 bytes; ids tail starts at 160.
  const idsOffsetBytes = 160n;
  const idsTailBytes = BigInt(32 + args.tokenIds.length * 32);
  const amountsOffsetBytes = idsOffsetBytes + idsTailBytes;
  const amountsTailBytes = BigInt(32 + args.amounts.length * 32);
  const dataOffsetBytes = amountsOffsetBytes + amountsTailBytes;

  const idsTail = concat([
    getBytes(encodeUint256(n)),
    ...args.tokenIds.map((id) => getBytes(encodeUint256(id))),
  ]);
  const amountsTail = concat([
    getBytes(encodeUint256(n)),
    ...args.amounts.map((a) => getBytes(encodeUint256(a))),
  ]);
  const dataTail = concat([
    getBytes(encodeUint256(BigInt(dataBytes.length))),
    padded,
  ]);

  const calldata = hexlify(
    concat([
      getBytes(ERC1155_SELECTORS.safeBatchTransferFrom),
      getBytes(encodeAddress(args.from)),
      getBytes(encodeAddress(args.to)),
      getBytes(encodeUint256(idsOffsetBytes)),
      getBytes(encodeUint256(amountsOffsetBytes)),
      getBytes(encodeUint256(dataOffsetBytes)),
      idsTail,
      amountsTail,
      dataTail,
    ]),
  );
  return { type: 2, from: args.from, to: args.contract, data: calldata, value: 0n };
}
