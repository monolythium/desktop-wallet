// AddCustomToken — kind auto-detection + add flow.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddCustomToken } from "../AddCustomToken";
import { _resetTokenListForTest, listTokens } from "../../sdk/token-list";

const ERC20_CONTRACT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const ERC721_CONTRACT = "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d";
const ERC1155_CONTRACT = "0x495f947276749ce646f68ac8c248420045cb7b5e";

let supports721 = false;
let supports1155 = false;
let meta: { name: string; symbol: string; decimals: number } | null = null;

vi.mock("../../sdk/erc721", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/erc721")>("../../sdk/erc721");
  return {
    ...actual,
    supportsErc721: vi.fn(async () => supports721),
  };
});

vi.mock("../../sdk/erc1155", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/erc1155")>("../../sdk/erc1155");
  return {
    ...actual,
    supportsErc1155: vi.fn(async () => supports1155),
  };
});

vi.mock("../../sdk/erc20", async () => {
  const actual = await vi.importActual<typeof import("../../sdk/erc20")>("../../sdk/erc20");
  return {
    ...actual,
    getTokenMetadata: vi.fn(async () =>
      meta === null
        ? { ok: false, error: "metadata unavailable" }
        : { ok: true, value: meta },
    ),
  };
});

beforeEach(() => {
  _resetTokenListForTest();
  supports721 = false;
  supports1155 = false;
  meta = null;
});

describe("AddCustomToken · detection", () => {
  it("classifies as ERC-721 when supportsInterface returns true", async () => {
    supports721 = true;
    meta = { name: "BoredApes", symbol: "BAYC", decimals: 18 };
    render(<AddCustomToken onAdded={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Contract address/i), {
      target: { value: ERC721_CONTRACT },
    });
    await waitFor(() => {
      expect(screen.getByText("ERC-721")).toBeInTheDocument();
    });
    expect(screen.getByText("BAYC")).toBeInTheDocument();
  });

  it("classifies as ERC-1155 when supportsInterface returns true", async () => {
    supports1155 = true;
    meta = { name: "OpenSea Items", symbol: "OS", decimals: 0 };
    render(<AddCustomToken onAdded={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Contract address/i), {
      target: { value: ERC1155_CONTRACT },
    });
    await waitFor(() => {
      expect(screen.getByText("ERC-1155")).toBeInTheDocument();
    });
  });

  it("falls back to ERC-20 when neither ERC-165 surface responds", async () => {
    meta = { name: "Tether USD", symbol: "USDT", decimals: 6 };
    render(<AddCustomToken onAdded={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Contract address/i), {
      target: { value: ERC20_CONTRACT },
    });
    await waitFor(() => {
      expect(screen.getByText("ERC-20")).toBeInTheDocument();
    });
    expect(screen.getByText("USDT")).toBeInTheDocument();
    expect(screen.getByText(/decimals: 6/i)).toBeInTheDocument();
  });

  it("rejects invalid address input", async () => {
    render(<AddCustomToken onAdded={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Contract address/i), {
      target: { value: "definitely-not-an-address" },
    });
    await waitFor(() => {
      expect(screen.getByText(/✗/)).toBeInTheDocument();
    });
  });

  it("rejects an address that responds to nothing as not-a-token", async () => {
    render(<AddCustomToken onAdded={() => undefined} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Contract address/i), {
      target: { value: ERC20_CONTRACT },
    });
    await waitFor(() => {
      expect(screen.getByText(/may not be a token contract/i)).toBeInTheDocument();
    });
  });
});

describe("AddCustomToken · submit", () => {
  it("calls onAdded after persisting the new token", async () => {
    meta = { name: "Tether USD", symbol: "USDT", decimals: 6 };
    const onAdded = vi.fn();
    render(<AddCustomToken onAdded={onAdded} onCancel={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/Contract address/i), {
      target: { value: ERC20_CONTRACT },
    });
    await waitFor(() => {
      expect(screen.getByText("USDT")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Add to my list/i));
    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(listTokens()).toHaveLength(1);
    expect(listTokens()[0]?.symbol).toBe("USDT");
  });
});
