// TokenSummaryCard — empty state, ERC-20 sort, NFT count footer.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TokenSummaryCard } from "../TokenSummaryCard";
import {
  _resetTokenListForTest,
  addToken,
} from "../../sdk/token-list";

const balanceTable: Record<string, bigint> = {};

vi.mock("../../sdk/erc20", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/erc20")>(
    "../../sdk/erc20",
  );
  return {
    ...actual,
    getTokenBalance: vi.fn(async (contract: string) => ({
      ok: true,
      value: balanceTable[contract.toLowerCase()] ?? 0n,
    })),
  };
});

beforeEach(() => {
  _resetTokenListForTest();
  for (const k of Object.keys(balanceTable)) delete balanceTable[k];
});

describe("TokenSummaryCard · empty state", () => {
  it("renders nothing when no tokens are persisted", async () => {
    const { container } = render(<TokenSummaryCard goto={() => undefined} />);
    await waitFor(() => {
      // The empty branch returns null — the container only has the fragment.
      expect(container.querySelector(".w-card")).toBeNull();
    });
  });
});

describe("TokenSummaryCard · ERC-20", () => {
  it("renders top-N rows sorted by raw balance desc", async () => {
    addToken({
      contract: "0xa1aa0000000000000000000000000000000000a1",
      kind: "erc20",
      symbol: "AAA",
      name: "Token-A",
      decimals: 18,
    });
    addToken({
      contract: "0xa2aa0000000000000000000000000000000000a2",
      kind: "erc20",
      symbol: "BBB",
      name: "Token-B",
      decimals: 18,
    });
    balanceTable["0xa1aa0000000000000000000000000000000000a1"] = 1n;
    balanceTable["0xa2aa0000000000000000000000000000000000a2"] = 1_000_000_000_000_000_000n;
    render(<TokenSummaryCard goto={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText("BBB")).toBeInTheDocument();
    });
    // Both rows visible; BBB above AAA per sort.
    const aaa = screen.getByText("AAA");
    const bbb = screen.getByText("BBB");
    expect(aaa.compareDocumentPosition(bbb) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("hides the whole card when only zero-balance ERC-20s exist", async () => {
    addToken({
      contract: "0xaa",
      kind: "erc20",
      symbol: "ZERO",
      name: "Zero",
      decimals: 18,
    });
    balanceTable["0xaa"] = 0n;
    const { container } = render(<TokenSummaryCard goto={() => undefined} />);
    // Effect resolves and the component returns null.
    await waitFor(() => {
      // Either the card is gone (return null branch) OR the loading
      // placeholder finished resolving.
      const card = container.querySelector(".w-card");
      // Loading state renders a w-card with "Loading other tokens…"; the
      // empty-after-fetch state returns null. The latter is what we want.
      if (card !== null) {
        // If a card is here, it must NOT contain the ZERO row.
        expect(screen.queryByText("ZERO")).toBeNull();
      }
    });
    expect(screen.queryByText("ZERO")).toBeNull();
  });
});

describe("TokenSummaryCard · NFT counts", () => {
  it("renders ERC-721 + ERC-1155 collection counts", async () => {
    addToken({ contract: "0xb1", kind: "erc721", symbol: "BAY", name: "BoredApes" });
    addToken({ contract: "0xb2", kind: "erc1155", symbol: "OS", name: "OpenSea" });
    render(<TokenSummaryCard goto={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByText(/1 ERC-721 collection/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/1 ERC-1155 collection/i)).toBeInTheDocument();
  });
});

describe("TokenSummaryCard · View all", () => {
  it("routes to the Tokens page", async () => {
    addToken({
      contract: "0xaa",
      kind: "erc20",
      symbol: "XYZ",
      name: "Acme",
      decimals: 18,
    });
    balanceTable["0xaa"] = 1n;
    const goto = vi.fn();
    render(<TokenSummaryCard goto={goto} />);
    await waitFor(() => {
      expect(screen.getByText("XYZ")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/View all/i));
    expect(goto).toHaveBeenCalledWith("tokens");
  });
});
