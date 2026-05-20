// ERC-1155 SDK seam — happy + error paths, batch readers, calldata
// layout verification.

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import { Interface, AbiCoder } from "ethers";
import {
  ERC1155_SELECTORS,
  INTERFACE_ID_ERC1155,
  encodeSafeBatchTransferFrom1155,
  encodeSafeTransferFrom1155,
  getMultiTokenBalance,
  getMultiTokenBalanceBatch,
  getMultiTokenUri,
  substituteErc1155IdPlaceholder,
  supportsErc1155,
} from "../erc1155";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

const CONTRACT = "0x495f947276749ce646f68ac8c248420045cb7b5e";

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
    const ok = (r: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id, result: r }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const er = (m: string) =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: m },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    if (body.method === "eth_chainId") return ok("0x10f2c");
    if (body.method === "eth_call") {
      const params = body.params as Array<{ to: string; data: string }>;
      const selector = (params[0]?.data ?? "").slice(0, 10).toLowerCase();
      const v = fx.calls[selector];
      if (v === undefined || v === "error") return er(`no fixture ${selector}`);
      return ok(v);
    }
    return er(`unhandled: ${body.method}`);
  };
}

function installProvider(fx: Fixture): void {
  setProviderForTest(
    new MonolythiumProvider(
      new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
    ),
  );
}

beforeEach(() => resetProviderForTest());

describe("erc1155 · selectors", () => {
  it("pins canonical ERC-1155 selectors", () => {
    // EIP-1155 canonical selectors.
    expect(ERC1155_SELECTORS.balanceOf).toBe("0x00fdd58e");
    expect(ERC1155_SELECTORS.balanceOfBatch).toBe("0x4e1273f4");
    expect(ERC1155_SELECTORS.uri).toBe("0x0e89341c");
    expect(ERC1155_SELECTORS.safeTransferFrom).toBe("0xf242432a");
    expect(ERC1155_SELECTORS.safeBatchTransferFrom).toBe("0x2eb2c2d6");
    expect(INTERFACE_ID_ERC1155).toBe("0xd9b67a26");
  });
});

describe("erc1155 · readers", () => {
  it("decodes balanceOf", async () => {
    installProvider({
      calls: {
        [ERC1155_SELECTORS.balanceOf]:
          "0x" + (12n).toString(16).padStart(64, "0"),
      },
    });
    const out = await getMultiTokenBalance(CONTRACT, TEST_ADDRESS, 1n);
    expect(out.value).toBe(12n);
  });

  it("decodes balanceOfBatch", async () => {
    // ABI-encode [3, 1, 2] as uint256[]
    const coder = AbiCoder.defaultAbiCoder();
    const ret = coder.encode(["uint256[]"], [[3n, 1n, 2n]]);
    installProvider({ calls: { [ERC1155_SELECTORS.balanceOfBatch]: ret } });
    const out = await getMultiTokenBalanceBatch(
      CONTRACT,
      [TEST_ADDRESS, TEST_ADDRESS, TEST_ADDRESS],
      [1n, 2n, 3n],
    );
    expect(out.value).toEqual([3n, 1n, 2n]);
  });

  it("rejects mismatched array lengths in balanceOfBatch", async () => {
    installProvider({ calls: {} });
    const out = await getMultiTokenBalanceBatch(CONTRACT, [TEST_ADDRESS], [1n, 2n]);
    expect(out.ok).toBe(false);
  });

  it("decodes uri()", async () => {
    installProvider({
      calls: {
        [ERC1155_SELECTORS.uri]: encodeString("ipfs://collection/{id}.json"),
      },
    });
    const out = await getMultiTokenUri(CONTRACT, 42n);
    expect(out.value).toBe("ipfs://collection/{id}.json");
  });
});

describe("erc1155 · substituteErc1155IdPlaceholder", () => {
  it("substitutes the {id} placeholder with 64-char hex", () => {
    expect(substituteErc1155IdPlaceholder("ipfs://x/{id}.json", 1n)).toBe(
      "ipfs://x/" + "0".repeat(63) + "1.json",
    );
  });

  it("is idempotent when no placeholder present", () => {
    expect(substituteErc1155IdPlaceholder("ipfs://x/static.json", 1n)).toBe(
      "ipfs://x/static.json",
    );
  });

  it("handles multiple {id} occurrences", () => {
    const out = substituteErc1155IdPlaceholder("/{id}/{id}", 5n);
    const padded = "0".repeat(63) + "5";
    expect(out).toBe(`/${padded}/${padded}`);
  });
});

describe("erc1155 · supportsErc1155", () => {
  it("returns true on supportsInterface(0xd9b67a26)", async () => {
    installProvider({
      calls: {
        [ERC1155_SELECTORS.supportsInterface]:
          "0x" + "1".padStart(64, "0"),
      },
    });
    expect(await supportsErc1155(CONTRACT)).toBe(true);
  });

  it("returns false on revert", async () => {
    installProvider({ calls: {} });
    expect(await supportsErc1155(CONTRACT)).toBe(false);
  });
});

describe("erc1155 · encoders", () => {
  it("safeTransferFrom1155 calldata matches the ethers Interface encoding", () => {
    const tx = encodeSafeTransferFrom1155({
      from: TEST_ADDRESS,
      contract: CONTRACT,
      to: "0x000000000000000000000000000000000000dead",
      tokenId: 7n,
      amount: 3n,
    });
    const iface = new Interface([
      "function safeTransferFrom(address,address,uint256,uint256,bytes)",
    ]);
    const expected = iface.encodeFunctionData("safeTransferFrom", [
      TEST_ADDRESS,
      "0x000000000000000000000000000000000000dead",
      7n,
      3n,
      "0x",
    ]);
    expect((tx.data as string).toLowerCase()).toBe(expected.toLowerCase());
  });

  it("safeBatchTransferFrom1155 calldata matches the ethers Interface encoding", () => {
    const tx = encodeSafeBatchTransferFrom1155({
      from: TEST_ADDRESS,
      contract: CONTRACT,
      to: "0x000000000000000000000000000000000000dead",
      tokenIds: [1n, 2n, 3n],
      amounts: [10n, 20n, 30n],
    });
    const iface = new Interface([
      "function safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
    ]);
    const expected = iface.encodeFunctionData("safeBatchTransferFrom", [
      TEST_ADDRESS,
      "0x000000000000000000000000000000000000dead",
      [1n, 2n, 3n],
      [10n, 20n, 30n],
      "0x",
    ]);
    expect((tx.data as string).toLowerCase()).toBe(expected.toLowerCase());
  });

  it("rejects mismatched batch array lengths", () => {
    expect(() =>
      encodeSafeBatchTransferFrom1155({
        from: TEST_ADDRESS,
        contract: CONTRACT,
        to: "0x000000000000000000000000000000000000dead",
        tokenIds: [1n],
        amounts: [10n, 20n],
      }),
    ).toThrow();
  });
});
