// The last-known balance store.
//
// This cache displays a NUMBER the user reads as their balance, so its
// rejection rules matter more than its happy path. The scope check is only
// meaningful because reads and writes both take their chain component from
// scopeChainKey() — if both used a fixed builtin constant, the record's own
// chainIdHex would be compared against itself and a custom chain would show the
// builtin chain's balance.

import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = vi.hoisted(() => ({ data: new Map<string, unknown>(), failSave: false }));
vi.mock("../wallet-store", () => ({
  WalletStore: {
    load: vi.fn(async () => ({
      get: vi.fn(async (k: string) => backing.data.get(k)),
      set: vi.fn(async (k: string, v: unknown) => {
        if (backing.failSave) throw new Error("disk full");
        backing.data.set(k, v);
      }),
      save: vi.fn(async () => {
        if (backing.failSave) throw new Error("disk full");
      }),
    })),
  },
}));

const chainMock = vi.hoisted(() => ({ key: "0x10f2c" }));
vi.mock("../chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chains")>()),
  scopeChainKey: () => chainMock.key,
}));

import {
  balanceScopeKey,
  loadLastKnownBalance,
  purgeScopesForAddress,
  saveLastKnownBalance,
  selectSeedBalance,
  __resetLastKnownBalanceCacheForTest,
} from "../last-known-balance";

const ADDR = "mono1aaa";
const OTHER = "mono1bbb";
const FIVE = "5000000000000000000";

function scopes(): Record<string, unknown> {
  return (backing.data.get("state") as { balances: Record<string, unknown> } | undefined)?.balances ?? {};
}

beforeEach(() => {
  backing.data.clear();
  backing.failSave = false;
  chainMock.key = "0x10f2c";
  __resetLastKnownBalanceCacheForTest();
});

describe("round trip", () => {
  it("saves and reads back the exact lythoshi string", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1_700_000_000_000);
    expect(await loadLastKnownBalance(ADDR)).toBe(FIVE);
  });

  it("stores the record under the scoped key", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    expect(Object.keys(scopes())).toEqual([balanceScopeKey(ADDR, "0x10f2c")]);
  });

  it("a cold store yields null (→ skeleton, never a figure)", async () => {
    expect(await loadLastKnownBalance(ADDR)).toBeNull();
  });
});

describe("H1 — the chain scope is real, not self-confirming", () => {
  it("a record written on one chain does NOT surface on another", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    expect(await loadLastKnownBalance(ADDR)).toBe(FIVE);

    // Switch to a custom chain — the seed must not follow.
    chainMock.key = "0xaa36a7";
    __resetLastKnownBalanceCacheForTest();
    expect(await loadLastKnownBalance(ADDR)).toBeNull();
  });

  it("each chain keeps its own figure, and they do not cross", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    chainMock.key = "0xaa36a7";
    __resetLastKnownBalanceCacheForTest();
    await saveLastKnownBalance(ADDR, "9000000000000000000", 2);

    expect(await loadLastKnownBalance(ADDR)).toBe("9000000000000000000");
    chainMock.key = "0x10f2c";
    __resetLastKnownBalanceCacheForTest();
    expect(await loadLastKnownBalance(ADDR)).toBe(FIVE);
  });

  it("one wallet's balance never surfaces under another", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    expect(await loadLastKnownBalance(OTHER)).toBeNull();
  });
});

describe("selectSeedBalance — tolerant rejection", () => {
  const good = { balanceLythoshi: FIVE, address: ADDR, chainIdHex: "0x10f2c", savedAtMs: 1 };

  it("accepts a well-formed, in-scope record", () => {
    expect(selectSeedBalance(good, ADDR, "0x10f2c")).toBe(FIVE);
  });

  it("rejects a mismatched address or chain", () => {
    expect(selectSeedBalance(good, OTHER, "0x10f2c")).toBeNull();
    expect(selectSeedBalance(good, ADDR, "0xaa36a7")).toBeNull();
  });

  it("rejects a non-integer balance shape", () => {
    for (const bad of ["12.5", "0x10", "-5", "", "5e18", "5 "]) {
      expect(selectSeedBalance({ ...good, balanceLythoshi: bad }, ADDR, "0x10f2c")).toBeNull();
    }
  });

  it("rejects wrong field types and missing fields", () => {
    expect(selectSeedBalance({ ...good, balanceLythoshi: 5 }, ADDR, "0x10f2c")).toBeNull();
    expect(selectSeedBalance({ ...good, address: 1 }, ADDR, "0x10f2c")).toBeNull();
    expect(selectSeedBalance({ ...good, savedAtMs: "x" }, ADDR, "0x10f2c")).toBeNull();
    expect(selectSeedBalance({ ...good, savedAtMs: Number.NaN }, ADDR, "0x10f2c")).toBeNull();
    expect(selectSeedBalance({ balanceLythoshi: FIVE }, ADDR, "0x10f2c")).toBeNull();
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(selectSeedBalance(bad, ADDR, "0x10f2c")).toBeNull();
    }
  });
});

describe("the write law", () => {
  it("refuses a non-integer balance so it can never be read back as a figure", async () => {
    await saveLastKnownBalance(ADDR, "12.5", 1);
    await saveLastKnownBalance(ADDR, "0x10", 1);
    expect(await loadLastKnownBalance(ADDR)).toBeNull();
    expect(Object.keys(scopes())).toEqual([]);
  });

  it("accepts an honest zero", async () => {
    await saveLastKnownBalance(ADDR, "0", 1);
    expect(await loadLastKnownBalance(ADDR)).toBe("0");
  });

  it("a failed write leaves the prior record untouched", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    backing.failSave = true;
    await saveLastKnownBalance(ADDR, "9000000000000000000", 2);
    backing.failSave = false;
    __resetLastKnownBalanceCacheForTest();
    expect(await loadLastKnownBalance(ADDR)).toBe(FIVE);
  });

  it("a later confirmed read overwrites the record", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    await saveLastKnownBalance(ADDR, "7000000000000000000", 2);
    expect(await loadLastKnownBalance(ADDR)).toBe("7000000000000000000");
  });
});

describe("purge hygiene", () => {
  it("removes exactly this address's records, across chains", async () => {
    await saveLastKnownBalance(ADDR, FIVE, 1);
    chainMock.key = "0xaa36a7";
    await saveLastKnownBalance(ADDR, "9000000000000000000", 2);
    chainMock.key = "0x10f2c";
    await saveLastKnownBalance(OTHER, "1000000000000000000", 3);

    await purgeScopesForAddress(ADDR);

    expect(Object.keys(scopes())).toEqual([balanceScopeKey(OTHER, "0x10f2c")]);
  });

  it("a prefix-sharing address is never purged by mistake", async () => {
    // "mono1a" must not purge "mono1aa" — the trailing dot in the prefix.
    await saveLastKnownBalance("mono1a", FIVE, 1);
    await saveLastKnownBalance("mono1aa", "9000000000000000000", 2);

    await purgeScopesForAddress("mono1a");

    expect(Object.keys(scopes())).toEqual([balanceScopeKey("mono1aa", "0x10f2c")]);
  });
});
