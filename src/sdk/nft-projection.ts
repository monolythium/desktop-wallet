// NFT enumeration projection — closes Phase 4 #D14.
//
// Replays Transfer / TransferSingle / TransferBatch events into a
// per-(collection, owner) → Set<tokenId> map. NFTs the user has sent
// OUT subtract from the owned set; the result is a usable enumeration
// even for ERC-1155 + non-Enumerable ERC-721 collections.
//
// Data source: the Phase 4 Commit 16 incremental log cursor's payload
// (stored as serialized TokenActivityRow). The cursor already covers
// both Transfer (ERC-20 / ERC-721) and TransferSingle / TransferBatch
// (ERC-1155); this module just projects the activity rows into a
// shape the gallery panel needs.
//
// API:
//
//   projectOwnedTokenIds(rows, holder, contract)
//     → { erc721: Set<bigint>; erc1155: Map<bigint, bigint> }
//
// For ERC-721 the set is the tokenIds currently owned. For ERC-1155
// the map is tokenId → quantity (a positive number) — zero balances
// are dropped from the map.

import type { TokenActivityRow } from "./token-activity";

export interface ProjectedOwnership {
  /** ERC-721 tokenIds currently owned by `holder` on `contract`. */
  erc721: Set<bigint>;
  /** ERC-1155 tokenId → current quantity. Zero balances dropped. */
  erc1155: Map<bigint, bigint>;
}

/**
 * Project Transfer logs into per-(holder, contract) ownership. Rows
 * are filtered to the requested contract and replayed in chronological
 * order (the cursor stores newest-first; we reverse here for replay).
 *
 * Ownership semantics:
 *   - ERC-721: in-transfer adds tokenId; out-transfer removes it;
 *     self-transfer is a no-op
 *   - ERC-1155: in-transfer adds amount; out-transfer subtracts;
 *     map entry dropped when it reaches 0
 *
 * `holder` is the lowercased 0x address; we match `direction` from
 * the activity row (already classified at scan time).
 */
export function projectOwnedTokenIds(
  rows: TokenActivityRow[],
  _holder: string,
  contract: string,
): ProjectedOwnership {
  const erc721 = new Set<bigint>();
  const erc1155 = new Map<bigint, bigint>();
  const contractLc = contract.toLowerCase();

  // Replay chronologically (oldest first). Cursor stores newest-first.
  const replay = rows
    .filter((r) => r.contract === contractLc)
    .slice()
    .sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber < b.blockNumber ? -1 : 1;
      }
      return a.logIndex - b.logIndex;
    });

  for (const row of replay) {
    if (row.kind === "erc721") {
      if (row.tokenId === null) continue;
      if (row.direction === "in") {
        erc721.add(row.tokenId);
      } else if (row.direction === "out") {
        erc721.delete(row.tokenId);
      }
      // self-transfer: net zero, no-op
    } else if (row.kind === "erc1155") {
      if (row.tokenId === null) continue;
      const current = erc1155.get(row.tokenId) ?? 0n;
      if (row.direction === "in") {
        erc1155.set(row.tokenId, current + row.amount);
      } else if (row.direction === "out") {
        const next = current - row.amount;
        if (next <= 0n) {
          erc1155.delete(row.tokenId);
        } else {
          erc1155.set(row.tokenId, next);
        }
      }
    }
    // ERC-20 rows are skipped — they don't carry tokenIds.
  }

  return { erc721, erc1155 };
}

/**
 * Convenience helper for the NftCollectionPanel — projects + returns
 * the owned tokenIds for a single collection.
 *
 * For ERC-721 collections: returns the sorted list of owned tokenIds.
 * For ERC-1155: returns the list of tokenIds with non-zero balance,
 * caller fetches per-id balance separately if needed (the projection
 * IS the balance, but the gallery still does a fresh on-chain
 * balanceOf to handle multi-window divergence).
 */
export function projectedTokenIds(
  rows: TokenActivityRow[],
  holder: string,
  contract: string,
  kind: "erc721" | "erc1155",
): bigint[] {
  const ownership = projectOwnedTokenIds(rows, holder, contract);
  const ids = kind === "erc721"
    ? Array.from(ownership.erc721)
    : Array.from(ownership.erc1155.keys());
  ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids;
}
