// Token-kind classification with ERC-165 + structural fallback.
//
// Phase 4 detection (ERC-20 vs ERC-721 vs ERC-1155) relied on
// `supportsInterface(...)` returning true for one of the NFT
// interface IDs. A small but real population of older / proxy /
// minimal-proxy collections reverts on `supportsInterface` (or
// returns false even for `0x80ac58cd`); Phase 4 misclassified those
// as ERC-20. Phase 5 #D16 closes the gap with a structural fallback:
//
//   1. supportsInterface(0x80ac58cd) → erc721
//   2. supportsInterface(0xd9b67a26) → erc1155
//   3. Fallback heuristic:
//        - has `decimals()` that doesn't revert → erc20
//        - else has `ownerOf(0)` that returns 32-byte word → erc721
//        - else has `uri(0)` that returns a string → erc1155
//        - else: unknown (with explicit reason)
//
// Returns a `TokenClassification` with both the inferred kind and
// the confidence + reasoning. Callers (add-custom-token form) can
// surface "unknown — chain-gap" to the user rather than silently
// misclassifying.

import { ERC20_SELECTORS } from "./erc20";
import { ERC721_SELECTORS, supportsErc721 } from "./erc721";
import { ERC1155_SELECTORS, supportsErc1155 } from "./erc1155";
import { getProvider } from "./client";

export type ClassifyKind = "erc20" | "erc721" | "erc1155" | "unknown";

export interface TokenClassification {
  kind: ClassifyKind;
  /** "erc165" — direct supportsInterface hit; "heuristic" — structural
   *  fallback; "unknown" — nothing detected (#D16 cleared posture). */
  source: "erc165" | "heuristic" | "unknown";
  /** Human-readable reasoning the UI can surface to the user. */
  reason: string;
}

/**
 * Classify a contract address. First tries ERC-165 supportsInterface
 * for both NFT IDs; falls back to the structural probe described
 * above.
 */
export async function classifyContract(
  contract: string,
): Promise<TokenClassification> {
  // 1. ERC-165 primary path.
  const [is721, is1155] = await Promise.all([
    supportsErc721(contract),
    supportsErc1155(contract),
  ]);
  if (is721) {
    return {
      kind: "erc721",
      source: "erc165",
      reason: "supportsInterface(0x80ac58cd) returned true",
    };
  }
  if (is1155) {
    return {
      kind: "erc1155",
      source: "erc165",
      reason: "supportsInterface(0xd9b67a26) returned true",
    };
  }
  // 2. Structural fallback.
  const provider = getProvider();
  const client = provider.rpcClient;
  // Probe `decimals()` — present on ERC-20, absent on every NFT
  // standard.
  let hasDecimals = false;
  try {
    const v = await client.ethCall({ to: contract, data: ERC20_SELECTORS.decimals });
    // A genuine ERC-20 returns a 32-byte word with a uint8 decimals
    // value; <= 36 to filter random garbage from proxy reverts that
    // happen to return a non-empty hex string.
    if (typeof v === "string" && v !== "0x" && v.length === 66) {
      const raw = BigInt(v);
      hasDecimals = raw <= 36n;
    }
  } catch {
    hasDecimals = false;
  }
  if (hasDecimals) {
    return {
      kind: "erc20",
      source: "heuristic",
      reason: "decimals() responded with a plausible uint8",
    };
  }
  // Probe `ownerOf(0)` — ERC-721 with tokenId 0 (or any id). If the
  // call returns a 32-byte word that looks like an address it's
  // ERC-721. If it reverts, fall through.
  let hasOwnerOf = false;
  try {
    const data = ERC721_SELECTORS.ownerOf + "0".repeat(64);
    const v = await client.ethCall({ to: contract, data });
    if (typeof v === "string" && v.length === 66) {
      hasOwnerOf = true;
    }
  } catch {
    hasOwnerOf = false;
  }
  if (hasOwnerOf) {
    return {
      kind: "erc721",
      source: "heuristic",
      reason: "ownerOf(0) returned a 32-byte word",
    };
  }
  // Probe `uri(0)` — ERC-1155 metadata extension.
  let hasUri = false;
  try {
    const data = ERC1155_SELECTORS.uri + "0".repeat(64);
    const v = await client.ethCall({ to: contract, data });
    if (typeof v === "string" && v.length > 2) {
      hasUri = true;
    }
  } catch {
    hasUri = false;
  }
  if (hasUri) {
    return {
      kind: "erc1155",
      source: "heuristic",
      reason: "uri(0) returned a non-empty response",
    };
  }
  return {
    kind: "unknown",
    source: "unknown",
    reason:
      "no ERC-165 / ERC-20 / ERC-721 / ERC-1155 surface responded — this address may not be a token contract",
  };
}
