// Naming-registry SDK seam — happy + error paths for each reader.
//
// The chain-gap surfaces (`lyth_resolveName`, `lyth_listOwnedNames`,
// `lyth_getNameDetails`) are explicitly exercised in two modes:
//
//   - "future shape" — the mock answers with a real payload, the seam
//     decodes it normally.
//   - "method not found" — the mock answers with JSON-RPC code -32601,
//     the seam returns the synthesised fallback (primary-only / null /
//     etc.) per the Phase 3 GAP plan.

import { beforeEach, describe, expect, it } from "vitest";
import { MonolythiumProvider, RpcClient } from "@monolythium/core-sdk";
import { keccak256, toUtf8Bytes } from "ethers";
import {
  NAME_REGISTRY_PRECOMPILE,
  NAMING_SELECTORS,
  NAMING_SIGNATURES,
  NamingEncoderError,
  encodeAcceptTransfer,
  encodeCancelTransfer,
  encodeProposeTransfer,
  encodeRegister,
  getNameDetails,
  isNameAvailable,
  listOwnedNames,
  lookupAddress,
  parseName,
  resolveName,
  validateLabel,
} from "../naming";
import { resetProviderForTest, setProviderForTest } from "../client";
import { TEST_ADDRESS } from "../../__tests__/helpers/fixtures";

interface NamingFixture {
  /** `lyth_resolveName` table: canonical name → address hex (or null
   *  to emit JSON-RPC "method not found"). `undefined` value emits a
   *  successful null. */
  resolve?: Record<string, string | null | "method-not-found">;
  /** `lyth_getAddressLabel` table: lowercased address → label payload. */
  addressLabel?: Record<
    string,
    {
      address: string;
      category: string;
      displayName: string | null;
      updatedAtBlock: number;
    } | null
  >;
  /** `lyth_listOwnedNames` table; "method-not-found" simulates the gap. */
  ownedNames?: Record<
    string,
    | "method-not-found"
    | Array<{
        name: string;
        owner: string;
        registeredAtHeight?: number;
        feePaidLyth?: number;
        transferState?: unknown;
      }>
  >;
  /** `lyth_getNameDetails` table; "method-not-found" simulates the gap. */
  nameDetails?: Record<
    string,
    | "method-not-found"
    | {
        name: string;
        owner: string;
        registeredAtHeight?: number;
        feePaidLyth?: number;
        transferState?: unknown;
      }
  >;
}

function makeFetch(fx: NamingFixture): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse((init as { body: string }).body);
    const id = body.id ?? 0;
    const method = body.method as string;
    const params = (body.params ?? []) as unknown[];
    const rpcError = (code: number, message: string) =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const ok = (result: unknown) =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id, result }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    switch (method) {
      case "eth_chainId":
        return ok("0x10f2c");
      case "lyth_resolveName": {
        const name = params[0] as string;
        const entry = fx.resolve?.[name];
        if (entry === "method-not-found") return rpcError(-32601, "method not found");
        if (entry === undefined || entry === null) return ok(null);
        return ok(entry);
      }
      case "lyth_getAddressLabel": {
        const addr = (params[0] as string).toLowerCase();
        const entry = fx.addressLabel?.[addr];
        if (entry === undefined) return ok(null);
        return ok(entry);
      }
      case "lyth_listOwnedNames": {
        const addr = (params[0] as string).toLowerCase();
        const entry = fx.ownedNames?.[addr];
        if (entry === undefined) return ok([]);
        if (entry === "method-not-found") return rpcError(-32601, "method not found");
        return ok(entry);
      }
      case "lyth_getNameDetails": {
        const name = params[0] as string;
        const entry = fx.nameDetails?.[name];
        if (entry === undefined) return ok(null);
        if (entry === "method-not-found") return rpcError(-32601, "method not found");
        return ok(entry);
      }
      default:
        return rpcError(-32601, `unhandled: ${method}`);
    }
  };
}

function installProvider(fx: NamingFixture): void {
  const provider = new MonolythiumProvider(
    new RpcClient("http://test.invalid", { fetch: makeFetch(fx) }),
  );
  setProviderForTest(provider);
}

beforeEach(() => {
  resetProviderForTest();
});

describe("naming · parseName", () => {
  it("parses human names", () => {
    expect(parseName("alice.mono")).toEqual({
      tld: "human",
      label: "alice",
      parent: null,
      canonical: "alice.mono",
    });
  });
  it("parses agent names with parent", () => {
    expect(parseName("bob.agent.alice.mono")).toEqual({
      tld: "agent",
      label: "bob",
      parent: "alice",
      canonical: "bob.agent.alice.mono",
    });
  });
  it("parses cluster / contract / system names", () => {
    expect(parseName("edge-validators.cluster.mono")?.tld).toBe("cluster");
    expect(parseName("lyth-bridge.contract.mono")?.tld).toBe("contract");
    expect(parseName("foundation.system.mono")?.tld).toBe("system");
  });
  it("rejects mixed case + missing suffix + bad TLDs", () => {
    expect(parseName("Alice.mono")).toBeNull();
    expect(parseName("alice.eth")).toBeNull();
    expect(parseName("alice.bogus.mono")).toBeNull();
    expect(parseName("alice.agent.mono")).toBeNull(); // missing parent
  });
});

describe("naming · validateLabel", () => {
  it("accepts normal labels", () => {
    expect(validateLabel("alice")).toEqual({ ok: true });
    expect(validateLabel("edge-validators")).toEqual({ ok: true });
    expect(validateLabel("a1b2c3")).toEqual({ ok: true });
  });
  it("rejects empty + over-length", () => {
    expect(validateLabel("")).toMatchObject({ ok: false });
    expect(validateLabel("a".repeat(64))).toMatchObject({ ok: false });
  });
  it("rejects mixed-case", () => {
    expect(validateLabel("Alice")).toMatchObject({ ok: false });
  });
  it("rejects hyphen edge cases", () => {
    expect(validateLabel("-alice")).toMatchObject({ ok: false });
    expect(validateLabel("alice-")).toMatchObject({ ok: false });
    expect(validateLabel("ali--ce")).toMatchObject({ ok: false });
  });
  it("rejects address-looking prefixes", () => {
    expect(validateLabel("0xdead")).toMatchObject({ ok: false });
    expect(validateLabel("mono1abc")).toMatchObject({ ok: false });
  });
});

describe("naming · resolveName", () => {
  it("returns the address when the chain emits it", async () => {
    installProvider({
      resolve: { "alice.mono": TEST_ADDRESS },
    });
    const out = await resolveName("alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value?.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  it("returns null on method-not-found (chain gap)", async () => {
    installProvider({
      resolve: { "alice.mono": "method-not-found" },
    });
    const out = await resolveName("alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toBeNull();
  });

  it("rejects malformed names without an RPC roundtrip", async () => {
    installProvider({});
    const out = await resolveName("ALICE.mono");
    expect(out.ok).toBe(false);
    expect(out.error).toContain("§22.8");
  });
});

describe("naming · lookupAddress", () => {
  it("returns the parsed §22.8 binding when the label is hierarchical", async () => {
    installProvider({
      addressLabel: {
        [TEST_ADDRESS.toLowerCase()]: {
          address: TEST_ADDRESS,
          category: "user",
          displayName: "alice.mono",
          updatedAtBlock: 100,
        },
      },
    });
    const out = await lookupAddress(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({
      name: "alice.mono",
      category: "human",
      owner: TEST_ADDRESS.toLowerCase(),
    });
  });

  it("returns null when the label is the legacy pragmatic taxonomy", async () => {
    installProvider({
      addressLabel: {
        [TEST_ADDRESS.toLowerCase()]: {
          address: TEST_ADDRESS,
          category: "treasury",
          displayName: "Mono Foundation Treasury",
          updatedAtBlock: 50,
        },
      },
    });
    const out = await lookupAddress(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toBeNull();
  });

  it("returns null when no label exists", async () => {
    installProvider({});
    const out = await lookupAddress(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toBeNull();
  });
});

describe("naming · listOwnedNames", () => {
  it("decodes a future-shape chain payload", async () => {
    installProvider({
      ownedNames: {
        [TEST_ADDRESS.toLowerCase()]: [
          { name: "alice.mono", owner: TEST_ADDRESS, registeredAtHeight: 42, feePaidLyth: 0.5 },
          { name: "bot.agent.alice.mono", owner: TEST_ADDRESS },
        ],
      },
    });
    const out = await listOwnedNames(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toHaveLength(2);
    expect(out.value?.[0]?.name).toBe("alice.mono");
    expect(out.value?.[0]?.registeredAtHeight).toBe(42n);
    expect(out.value?.[0]?.feePaidLyth).toBe(0.5);
    expect(out.value?.[1]?.category).toBe("agent");
  });

  it("falls back to primary-only when the chain method is missing", async () => {
    installProvider({
      ownedNames: { [TEST_ADDRESS.toLowerCase()]: "method-not-found" },
      addressLabel: {
        [TEST_ADDRESS.toLowerCase()]: {
          address: TEST_ADDRESS,
          category: "user",
          displayName: "alice.mono",
          updatedAtBlock: 100,
        },
      },
    });
    const out = await listOwnedNames(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toHaveLength(1);
    expect(out.value?.[0]?.name).toBe("alice.mono");
    expect(out.value?.[0]?.chainGap).toContain("not yet emitted");
  });

  it("returns empty when no names exist at all", async () => {
    installProvider({
      ownedNames: { [TEST_ADDRESS.toLowerCase()]: "method-not-found" },
    });
    const out = await listOwnedNames(TEST_ADDRESS);
    expect(out.ok).toBe(true);
    expect(out.value).toEqual([]);
  });
});

describe("naming · getNameDetails", () => {
  it("decodes a future-shape chain payload", async () => {
    installProvider({
      nameDetails: {
        "alice.mono": {
          name: "alice.mono",
          owner: TEST_ADDRESS,
          registeredAtHeight: 100,
          feePaidLyth: 1.25,
        },
      },
    });
    const out = await getNameDetails("alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value?.owner).toBe(TEST_ADDRESS);
    expect(out.value?.registeredAtHeight).toBe(100n);
    expect(out.value?.feePaidLyth).toBe(1.25);
    expect(out.value?.transferState).toEqual({ kind: "active" });
  });

  it("falls back to owner-only when chain method is missing but resolve works", async () => {
    installProvider({
      nameDetails: { "alice.mono": "method-not-found" },
      resolve: { "alice.mono": TEST_ADDRESS },
    });
    const out = await getNameDetails("alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value?.chainGap).toContain("owner only");
  });

  it("returns null when name doesn't exist on chain", async () => {
    installProvider({
      nameDetails: { "alice.mono": "method-not-found" },
      resolve: { "alice.mono": "method-not-found" },
    });
    const out = await getNameDetails("alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toBeNull();
  });
});

describe("naming · isNameAvailable", () => {
  it("rejects format violations without RPC", async () => {
    installProvider({});
    const out = await isNameAvailable("Alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({
      available: false,
      reservedBy: "format-rule",
    });
  });

  it("rejects foundation-reserved labels", async () => {
    installProvider({});
    const out = await isNameAvailable("foundation.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({
      available: false,
      reservedBy: "foundation",
    });
  });

  it("rejects the system.* TLD outright", async () => {
    installProvider({});
    const out = await isNameAvailable("anything.system.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({
      available: false,
      reservedBy: "structural",
    });
  });

  it("flags already-registered names", async () => {
    installProvider({
      resolve: { "alice.mono": TEST_ADDRESS },
    });
    const out = await isNameAvailable("alice.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({
      available: false,
      reservedBy: "registered",
    });
  });

  it("returns available when nothing rejects", async () => {
    installProvider({
      resolve: { "fresh-handle.mono": "method-not-found" },
    });
    const out = await isNameAvailable("fresh-handle.mono");
    expect(out.ok).toBe(true);
    expect(out.value).toMatchObject({ available: true });
  });
});

describe("naming · selectors", () => {
  it("derives the 4-byte selector from the keccak of each signature", () => {
    for (const [op, sig] of Object.entries(NAMING_SIGNATURES)) {
      const expected = keccak256(toUtf8Bytes(sig)).slice(0, 10);
      expect(NAMING_SELECTORS[op as keyof typeof NAMING_SELECTORS]).toBe(expected);
    }
  });
});

describe("naming · encodeRegister", () => {
  it("builds a register tx for a human name", () => {
    const tx = encodeRegister({
      from: TEST_ADDRESS,
      name: "alice.mono",
      category: "human",
    });
    expect(tx.to).toBe(NAME_REGISTRY_PRECOMPILE);
    expect(tx.value).toBe(0n);
    expect(tx.from).toBe(TEST_ADDRESS);
    const data = tx.data as string;
    expect(data.startsWith(NAMING_SELECTORS.register)).toBe(true);
    // The category byte is the last byte of the second 32-byte head word.
    // Selector(4) + head(64) + tail. We grab the byte at offset 4 + 32 + 32 - 1.
    const categoryWord = data.slice(2 + (4 + 32) * 2, 2 + (4 + 64) * 2);
    expect(parseInt(categoryWord.slice(-2), 16)).toBe(0); // human = 0
  });

  it("emits the correct category byte for agent", () => {
    const tx = encodeRegister({
      from: TEST_ADDRESS,
      name: "bot.agent.alice.mono",
      category: "agent",
    });
    const data = tx.data as string;
    const categoryWord = data.slice(2 + (4 + 32) * 2, 2 + (4 + 64) * 2);
    expect(parseInt(categoryWord.slice(-2), 16)).toBe(1); // agent = 1
  });

  it("rejects the system TLD", () => {
    expect(() =>
      encodeRegister({
        from: TEST_ADDRESS,
        name: "foundation.system.mono",
        category: "system",
      }),
    ).toThrow(NamingEncoderError);
  });

  it("rejects bad names with a typed error", () => {
    try {
      encodeRegister({ from: TEST_ADDRESS, name: "BAD.mono", category: "human" });
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(NamingEncoderError);
      expect((cause as NamingEncoderError).code).toBe("invalid_name");
    }
  });

  it("rejects mismatched category vs TLD", () => {
    try {
      encodeRegister({
        from: TEST_ADDRESS,
        name: "alice.mono",
        category: "agent",
      });
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(NamingEncoderError);
      expect((cause as NamingEncoderError).code).toBe("invalid_name");
    }
  });
});

describe("naming · encodeProposeTransfer", () => {
  it("builds a transfer-propose tx with the recipient padded as address", () => {
    const tx = encodeProposeTransfer({
      from: TEST_ADDRESS,
      name: "alice.mono",
      recipient: TEST_ADDRESS,
    });
    expect(tx.to).toBe(NAME_REGISTRY_PRECOMPILE);
    const data = tx.data as string;
    expect(data.startsWith(NAMING_SELECTORS.proposeTransfer)).toBe(true);
    // Recipient word ends in the lowercased TEST_ADDRESS hex.
    const recipientWord = data.slice(2 + (4 + 32) * 2, 2 + (4 + 64) * 2);
    expect(recipientWord.toLowerCase()).toContain(
      TEST_ADDRESS.toLowerCase().slice(2),
    );
  });

  it("accepts bech32m recipients", () => {
    const tx = encodeProposeTransfer({
      from: TEST_ADDRESS,
      name: "alice.mono",
      recipient: "mono17w0adeg64ky0daxwd2ugyuneellmjgnxk794yy",
    });
    const data = tx.data as string;
    expect(data.startsWith(NAMING_SELECTORS.proposeTransfer)).toBe(true);
  });

  it("rejects invalid recipients with a typed error", () => {
    try {
      encodeProposeTransfer({
        from: TEST_ADDRESS,
        name: "alice.mono",
        recipient: "not-a-real-address",
      });
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(NamingEncoderError);
      expect((cause as NamingEncoderError).code).toBe("invalid_recipient");
    }
  });
});

describe("naming · encodeAcceptTransfer / encodeCancelTransfer", () => {
  it("builds accept-transfer calldata", () => {
    const tx = encodeAcceptTransfer({
      from: TEST_ADDRESS,
      name: "alice.mono",
    });
    const data = tx.data as string;
    expect(data.startsWith(NAMING_SELECTORS.acceptTransfer)).toBe(true);
    // Offset word + length word + utf8(alice.mono) padded.
    expect(data.length).toBeGreaterThan(2 + 8 + 64 + 64);
  });

  it("builds cancel-transfer calldata", () => {
    const tx = encodeCancelTransfer({
      from: TEST_ADDRESS,
      name: "alice.mono",
    });
    const data = tx.data as string;
    expect(data.startsWith(NAMING_SELECTORS.cancelTransfer)).toBe(true);
  });

  it("rejects malformed names from both", () => {
    expect(() => encodeAcceptTransfer({ from: TEST_ADDRESS, name: "BAD" })).toThrow(
      NamingEncoderError,
    );
    expect(() => encodeCancelTransfer({ from: TEST_ADDRESS, name: "BAD" })).toThrow(
      NamingEncoderError,
    );
  });
});
