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
import {
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
