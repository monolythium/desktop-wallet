// ERC-721 SDK seam — happy + error paths for each reader, encoder
// round-trip, ERC-165 detection.

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import {
  ERC721_SELECTORS,
  INTERFACE_ID_ERC721,
  encodeSafeTransferFrom,
  encodeTransferFrom,
  getNftBalance,
  getNftCollectionMetadata,
  getNftOwner,
  getNftTokenOfOwnerByIndex,
  getNftTokenUri,
  supportsErc721,
} from "../erc721";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

const CONTRACT = "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d"; // BAYC-like

function encodeString(s: string): string {
  const utf8 = Buffer.from(s, "utf8");
  const len = utf8.length.toString(16).padStart(64, "0");
  const padLen = Math.ceil(utf8.length / 32) * 32 || 32;
  const padded = Buffer.alloc(padLen);
  utf8.copy(padded);
  return "0x" + "20".padStart(64, "0") + len + padded.toString("hex");
}

interface Fixture {
  calls: Record<string, string | "error">;
}

function makeFetch(fx: Fixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const method = body.method as string;
    const ok = (result: unknown) =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const err = (msg: string) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: msg },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (method === "eth_chainId") return ok("0x10f2c");
    if (method === "eth_call") {
      const params = body.params as Array<{ to: string; data: string }>;
      const data = (params[0]?.data ?? "").toLowerCase();
      const selector = data.slice(0, 10);
      const v = fx.calls[selector];
      if (v === undefined || v === "error") {
        return err(`no fixture for ${selector}`);
      }
      return ok(v);
    }
    return err(`unhandled: ${method}`);
  };
}

function installProvider(fx: Fixture): void {
  setProviderForTest(
    new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
    ),
  );
}

beforeEach(() => {
  resetProviderForTest();
});

describe("erc721 · selectors", () => {
  it("pins the canonical ERC-721 selectors", () => {
    expect(ERC721_SELECTORS.balanceOf).toBe("0x70a08231");
    expect(ERC721_SELECTORS.ownerOf).toBe("0x6352211e");
    expect(ERC721_SELECTORS.tokenURI).toBe("0xc87b56dd");
    expect(ERC721_SELECTORS.transferFrom).toBe("0x23b872dd");
    // safeTransferFrom has TWO valid signatures with the same name (3-arg + 4-arg).
    // We pin the 3-arg variant.
    expect(ERC721_SELECTORS.safeTransferFrom).toBe("0x42842e0e");
    expect(ERC721_SELECTORS.supportsInterface).toBe("0x01ffc9a7");
  });
});

describe("erc721 · getNftCollectionMetadata", () => {
  it("returns name + symbol on the happy path", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.name]: encodeString("BoredApes"),
        [ERC721_SELECTORS.symbol]: encodeString("BAYC"),
      },
    });
    const out = await getNftCollectionMetadata(CONTRACT);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ name: "BoredApes", symbol: "BAYC" });
  });

  it("returns ok:false when both reads fail", async () => {
    installProvider({ calls: {} });
    const out = await getNftCollectionMetadata(CONTRACT);
    expect(out.ok).toBe(false);
  });
});

describe("erc721 · getNftBalance", () => {
  it("decodes the uint256 balance", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.balanceOf]: "0x" + (7n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getNftBalance(CONTRACT, TEST_ADDRESS);
    expect(out.value).toBe(7n);
  });
});

describe("erc721 · getNftOwner", () => {
  it("decodes the right-aligned address from the 32-byte word", async () => {
    const ownerLc = TEST_ADDRESS.toLowerCase();
    installProvider({
      calls: {
        [ERC721_SELECTORS.ownerOf]:
          "0x" + "0".repeat(24) + ownerLc.slice(2),
      },
    });
    const out = await getNftOwner(CONTRACT, 1n);
    expect(out.value).toBe(ownerLc);
  });
});

describe("erc721 · getNftTokenUri", () => {
  it("decodes the Solidity string", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.tokenURI]: encodeString("ipfs://Qm.../1.json"),
      },
    });
    const out = await getNftTokenUri(CONTRACT, 1n);
    expect(out.value).toBe("ipfs://Qm.../1.json");
  });
});

describe("erc721 · getNftTokenOfOwnerByIndex", () => {
  it("decodes the tokenId at an index", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.tokenOfOwnerByIndex]:
          "0x" + (1234n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getNftTokenOfOwnerByIndex(CONTRACT, TEST_ADDRESS, 0n);
    expect(out.value).toBe(1234n);
  });
});

describe("erc721 · supportsErc721", () => {
  it("returns true when supportsInterface returns 1", async () => {
    installProvider({
      calls: {
        [ERC721_SELECTORS.supportsInterface]:
          "0x" + "1".padStart(64, "0"),
      },
    });
    expect(await supportsErc721(CONTRACT)).toBe(true);
  });

  it("returns false on revert / no data", async () => {
    installProvider({ calls: {} });
    expect(await supportsErc721(CONTRACT)).toBe(false);
  });

  it("uses the canonical interface ID 0x80ac58cd", () => {
    expect(INTERFACE_ID_ERC721).toBe("0x80ac58cd");
  });
});

describe("erc721 · encoders", () => {
  it("builds safeTransferFrom calldata", () => {
    const tx = encodeSafeTransferFrom({
      from: TEST_ADDRESS,
      contract: CONTRACT,
      to: "0x000000000000000000000000000000000000dead",
      tokenId: 1n,
    });
    expect(tx.to).toBe(CONTRACT);
    expect(tx.value).toBe(0n);
    const data = tx.data as string;
    expect(data.startsWith(ERC721_SELECTORS.safeTransferFrom)).toBe(true);
    // selector(4) + from(32) + to(32) + tokenId(32) = 100 bytes → 200 hex + 2 prefix
    expect(data.length).toBe(2 + 8 + 64 * 3);
  });

  it("builds transferFrom calldata", () => {
    const tx = encodeTransferFrom({
      from: TEST_ADDRESS,
      contract: CONTRACT,
      to: "0x000000000000000000000000000000000000dead",
      tokenId: 42n,
    });
    expect((tx.data as string).startsWith(ERC721_SELECTORS.transferFrom)).toBe(true);
  });
});
