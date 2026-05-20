// Tokens page — rendering with discovered tokens and the empty state.
//
// The SDK seams are mocked so the page renders against a deterministic
// portfolio rather than the live testnet.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Tokens } from "../Tokens";
import {
  _resetTokenListForTest,
  addToken,
  listVisibleTokens,
} from "../../sdk/token-list";

// Mock the discovery so it returns nothing — relies on already-persisted
// tokens.
vi.mock("../../sdk/token-discovery", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/token-discovery")>(
    "../../sdk/token-discovery",
  );
  return {
    ...actual,
    discoverTokens: vi.fn(async () => ({ ok: true, value: [] })),
  };
});

// Mock the ERC-20 readers — for the persisted tokens we surface a
// fake balance so the row renders.
vi.mock("../../sdk/erc20", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/erc20")>(
    "../../sdk/erc20",
  );
  return {
    ...actual,
    getTokenBalance: vi.fn(async () => ({ ok: true, value: 1_000_000_000_000_000_000n })),
    getTokenMetadata: vi.fn(async () => ({
      ok: true,
      value: { name: "Foo", symbol: "FOO", decimals: 18 },
    })),
  };
});

// Identity hook resolves to bech32m sync fallback; mock lookupAddress
// so it doesn't hit the network.
vi.mock("../../sdk/naming", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/naming")>("../../sdk/naming");
  return {
    ...actual,
    lookupAddress: vi.fn(async () => ({ ok: true, value: null })),
  };
});

beforeEach(() => {
  _resetTokenListForTest();
});

describe("Tokens · empty state", () => {
  it("renders the empty state when no tokens are persisted", async () => {
    render(<Tokens />);
    await waitFor(() => {
      expect(screen.getByText(/No tokens detected/i)).toBeInTheDocument();
    });
  });
});

describe("Tokens · rendering", () => {
  it("renders ERC-20 holdings with symbol + name", async () => {
    addToken({
      contract: "0xaaa0000000000000000000000000000000000001",
      kind: "erc20",
      symbol: "FOO",
      name: "Foo Token",
      decimals: 18,
    });
    render(<Tokens />);
    await waitFor(() => {
      expect(screen.getByText("FOO")).toBeInTheDocument();
    });
    expect(screen.getByText(/Foo Token/i)).toBeInTheDocument();
    expect(screen.getByText(/ERC-20 holdings/i)).toBeInTheDocument();
  });

  it("renders a separate ERC-721 section for NFT collections", async () => {
    addToken({
      contract: "0xbbb0000000000000000000000000000000000002",
      kind: "erc721",
      symbol: "BAY",
      name: "BoredApes",
    });
    render(<Tokens />);
    await waitFor(() => {
      expect(screen.getByText(/ERC-721 collections/i)).toBeInTheDocument();
    });
    expect(screen.getByText("BAY")).toBeInTheDocument();
  });

  it("renders both ERC-20 and ERC-1155 when mixed", async () => {
    addToken({
      contract: "0xa1", kind: "erc20", symbol: "A", name: "A", decimals: 18,
    });
    addToken({
      contract: "0xa2", kind: "erc1155", symbol: "C", name: "C",
    });
    render(<Tokens />);
    await waitFor(() => {
      expect(screen.getByText(/ERC-20 holdings/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/ERC-1155 collections/i)).toBeInTheDocument();
  });

  it("renders the chain-gap USD placeholder (em-dash) on each ERC-20 row", async () => {
    addToken({
      contract: "0xa1", kind: "erc20", symbol: "FOO", name: "Foo Token", decimals: 18,
    });
    render(<Tokens />);
    await waitFor(() => {
      expect(screen.getByText("FOO")).toBeInTheDocument();
    });
    // Phase 5 (#D13 closure): chain-gap USD placeholder is "— USD"
    // with a tooltip explaining the deferral.
    const cells = screen.getAllByText(/— USD/);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0]?.getAttribute("title")).toMatch(/Price oracle pending/i);
  });
});

describe("Tokens · post-hide token-list state", () => {
  // We don't drive the actual click here (the page uses window.confirm,
  // which jsdom returns false for by default); just verify the listing
  // surface stays consistent after a direct hide call.
  it("hidden tokens disappear from the visible list", async () => {
    addToken({
      contract: "0xa1", kind: "erc20", symbol: "X", name: "X", decimals: 18, hidden: true,
    });
    expect(listVisibleTokens()).toEqual([]);
  });
});
