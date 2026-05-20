// NFT enumeration projection tests.

import { describe, expect, it } from "vitest";
import {
  projectOwnedTokenIds,
  projectedTokenIds,
} from "../nft-projection";
import type { TokenActivityRow } from "../token-activity";

const CONTRACT = "0xbbb0000000000000000000000000000000000002";
const HOLDER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

function row(over: Partial<TokenActivityRow>): TokenActivityRow {
  return {
    blockNumber: 1n,
    txHash: "0xtx",
    logIndex: 0,
    contract: CONTRACT,
    kind: "erc721",
    direction: "in",
    counterparty: "0xaaa",
    amount: 0n,
    tokenId: 1n,
    ...over,
  };
}

describe("nft-projection · ERC-721", () => {
  it("adds tokenIds on incoming transfers", () => {
    const rows: TokenActivityRow[] = [
      row({ tokenId: 1n, blockNumber: 1n }),
      row({ tokenId: 2n, blockNumber: 2n }),
      row({ tokenId: 3n, blockNumber: 3n }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(Array.from(out.erc721)).toEqual([1n, 2n, 3n]);
  });

  it("removes tokenIds on outgoing transfers", () => {
    const rows: TokenActivityRow[] = [
      row({ tokenId: 1n, blockNumber: 1n, direction: "in" }),
      row({ tokenId: 2n, blockNumber: 2n, direction: "in" }),
      row({ tokenId: 1n, blockNumber: 3n, direction: "out" }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(Array.from(out.erc721)).toEqual([2n]);
  });

  it("handles a flip (in then out then in)", () => {
    const rows: TokenActivityRow[] = [
      row({ tokenId: 5n, blockNumber: 1n, direction: "in" }),
      row({ tokenId: 5n, blockNumber: 2n, direction: "out" }),
      row({ tokenId: 5n, blockNumber: 3n, direction: "in" }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc721.has(5n)).toBe(true);
  });

  it("filters to the requested contract", () => {
    const rows: TokenActivityRow[] = [
      row({ tokenId: 1n, contract: CONTRACT }),
      row({ tokenId: 99n, contract: "0xdeadbeef" }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc721.has(1n)).toBe(true);
    expect(out.erc721.has(99n)).toBe(false);
  });

  it("ignores self-transfers (net zero)", () => {
    const rows: TokenActivityRow[] = [
      row({ tokenId: 1n, blockNumber: 1n, direction: "in" }),
      row({ tokenId: 1n, blockNumber: 2n, direction: "self" }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc721.has(1n)).toBe(true);
  });
});

describe("nft-projection · ERC-1155", () => {
  it("accumulates amounts on incoming transfers", () => {
    const rows: TokenActivityRow[] = [
      row({ kind: "erc1155", tokenId: 1n, amount: 3n, direction: "in", blockNumber: 1n }),
      row({ kind: "erc1155", tokenId: 1n, amount: 2n, direction: "in", blockNumber: 2n }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc1155.get(1n)).toBe(5n);
  });

  it("subtracts amounts on outgoing transfers", () => {
    const rows: TokenActivityRow[] = [
      row({ kind: "erc1155", tokenId: 1n, amount: 10n, direction: "in", blockNumber: 1n }),
      row({ kind: "erc1155", tokenId: 1n, amount: 3n, direction: "out", blockNumber: 2n }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc1155.get(1n)).toBe(7n);
  });

  it("drops the entry when balance reaches zero", () => {
    const rows: TokenActivityRow[] = [
      row({ kind: "erc1155", tokenId: 1n, amount: 5n, direction: "in", blockNumber: 1n }),
      row({ kind: "erc1155", tokenId: 1n, amount: 5n, direction: "out", blockNumber: 2n }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc1155.has(1n)).toBe(false);
  });

  it("handles multiple distinct tokenIds independently", () => {
    const rows: TokenActivityRow[] = [
      row({ kind: "erc1155", tokenId: 1n, amount: 3n, direction: "in", blockNumber: 1n }),
      row({ kind: "erc1155", tokenId: 2n, amount: 7n, direction: "in", blockNumber: 2n }),
      row({ kind: "erc1155", tokenId: 1n, amount: 1n, direction: "out", blockNumber: 3n }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    expect(out.erc1155.get(1n)).toBe(2n);
    expect(out.erc1155.get(2n)).toBe(7n);
  });
});

describe("nft-projection · replay order", () => {
  it("replays oldest-first regardless of input order", () => {
    // Cursor stores newest-first; pass rows that way.
    const rows: TokenActivityRow[] = [
      row({ tokenId: 1n, blockNumber: 3n, direction: "out" }),
      row({ tokenId: 1n, blockNumber: 2n, direction: "in" }),
      row({ tokenId: 1n, blockNumber: 1n, direction: "in" }),
    ];
    const out = projectOwnedTokenIds(rows, HOLDER, CONTRACT);
    // Sequence in chronological order: in@1 (adds), in@2 (no-op, already in
    // set), out@3 (removes). Final: not owned.
    expect(out.erc721.has(1n)).toBe(false);
  });
});

describe("nft-projection · projectedTokenIds helper", () => {
  it("returns sorted token ids for ERC-721", () => {
    const rows: TokenActivityRow[] = [
      row({ tokenId: 5n }),
      row({ tokenId: 2n }),
      row({ tokenId: 10n }),
    ];
    const ids = projectedTokenIds(rows, HOLDER, CONTRACT, "erc721");
    expect(ids).toEqual([2n, 5n, 10n]);
  });

  it("returns sorted token ids for ERC-1155 (non-zero balance only)", () => {
    const rows: TokenActivityRow[] = [
      row({ kind: "erc1155", tokenId: 5n, amount: 3n, direction: "in", blockNumber: 1n }),
      row({ kind: "erc1155", tokenId: 2n, amount: 4n, direction: "in", blockNumber: 2n }),
      row({ kind: "erc1155", tokenId: 5n, amount: 3n, direction: "out", blockNumber: 3n }),
    ];
    const ids = projectedTokenIds(rows, HOLDER, CONTRACT, "erc1155");
    // 5n hit zero and is gone; 2n stays.
    expect(ids).toEqual([2n]);
  });
});
