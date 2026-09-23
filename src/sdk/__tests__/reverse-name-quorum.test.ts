// The reverse-name quorum law and its persisted cache.
//
// The safety property is the counting: a name is not orderable, so there is no
// majority-of-different-values and no "closest". Any two differing definitive
// answers is a disagreement, and only an exact-match hit is ever displayable.
// A single operator can therefore never put a name beside an address.

import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../wallet-store", () => ({
  WalletStore: {
    load: vi.fn(async () => ({
      get: vi.fn(async (k: string) => backing.get(k)),
      set: vi.fn(async (k: string, v: unknown) => {
        backing.set(k, JSON.parse(JSON.stringify(v)));
      }),
      save: vi.fn(async () => {}),
    })),
  },
}));

const chainMock = vi.hoisted(() => ({ key: "0x10f2c" }));
vi.mock("../chains", async (orig) => ({
  ...(await orig<typeof import("../chains")>()),
  scopeChainKey: () => chainMock.key,
}));

const fleetMock = vi.hoisted(() => ({ urls: ["https://a", "https://b", "https://c"] }));
vi.mock("../fleet", () => ({
  activeFleet: () => fleetMock.urls.map((url) => ({ url, label: url, region: null, tier: "x" })),
}));

import {
  isStructurallyValidName,
  loadReverseName,
  resolveReverseNameQuorum,
  reverseNameVerdict,
  type ReverseEndpointAnswer,
} from "../reverse-name";
import {
  evictExpiredReverseNames,
  readCachedReverseName,
  reverseNameKey,
  REVERSE_NAME_TTL_MS,
  primeReverseNameCache,
  writeReverseName,
  invalidateReverseName,
  __resetReverseNameCacheForTest,
} from "../reverse-name-cache";

const ADDR = "mono1alice";
const NAME = "alice.mono";
const OTHER = "bob.mono";

const hit = (n: string): ReverseEndpointAnswer => ({ status: "name", name: n });
const miss: ReverseEndpointAnswer = { status: "none" };
const dead: ReverseEndpointAnswer = { status: "no-answer" };

beforeEach(() => {
  backing.clear();
  localStorage.clear();
  chainMock.key = "0x10f2c";
  fleetMock.urls = ["https://a", "https://b", "https://c"];
  __resetReverseNameCacheForTest();
});

describe("G1 — the quorum branch table", () => {
  it("2-of-3 identical (one peer down) → confirmed hit", () => {
    expect(reverseNameVerdict([hit(NAME), hit(NAME), dead])).toEqual({
      status: "confirmed-hit",
      name: NAME,
    });
  });

  it("all three identical → confirmed hit", () => {
    expect(reverseNameVerdict([hit(NAME), hit(NAME), hit(NAME)])).toEqual({
      status: "confirmed-hit",
      name: NAME,
    });
  });

  it("two nulls → confirmed miss", () => {
    expect(reverseNameVerdict([miss, miss, dead])).toEqual({ status: "confirmed-miss" });
  });

  it("two DIFFERENT names → disagreement, never a pick", () => {
    expect(reverseNameVerdict([hit(NAME), hit(OTHER)])).toEqual({ status: "disagreement" });
  });

  it("a 2-vs-1 name split is STILL a disagreement (no majority rule)", () => {
    expect(reverseNameVerdict([hit(NAME), hit(NAME), hit(OTHER)])).toEqual({
      status: "disagreement",
    });
  });

  it("a hit-vs-miss split is a disagreement, not a hit", () => {
    expect(reverseNameVerdict([hit(NAME), miss])).toEqual({ status: "disagreement" });
    expect(reverseNameVerdict([hit(NAME), hit(NAME), miss])).toEqual({ status: "disagreement" });
  });

  it("a SINGLE definitive answer is insufficient — no lone operator can name", () => {
    expect(reverseNameVerdict([hit(NAME), dead, dead])).toEqual({ status: "insufficient" });
    expect(reverseNameVerdict([miss, dead])).toEqual({ status: "insufficient" });
  });

  it("no answers at all → insufficient", () => {
    expect(reverseNameVerdict([dead, dead, dead])).toEqual({ status: "insufficient" });
    expect(reverseNameVerdict([])).toEqual({ status: "insufficient" });
  });
});

describe("G1 — structurally invalid values are not votes", () => {
  it("rejects values the registry parser refuses", () => {
    expect(isStructurallyValidName("alice.mono")).toBe(true);
    expect(isStructurallyValidName("ALICE.MONO")).toBe(false);
    expect(isStructurallyValidName("alice.eth")).toBe(false);
    expect(isStructurallyValidName("not a name")).toBe(false);
    expect(isStructurallyValidName("")).toBe(false);
  });

  it("two operators agreeing on an INVALID value still yields no name", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ result: { name: "NOT A NAME!" } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const verdict = await resolveReverseNameQuorum(ADDR, { fetchImpl });
    // Both answers were discarded, so there is no quorum at all.
    expect(verdict).toEqual({ status: "insufficient" });
  });
});

describe("the fan-out", () => {
  it("case-normalises before comparison", async () => {
    let i = 0;
    const bodies = ["Alice.Mono", "alice.mono", "ALICE.MONO"];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { name: bodies[i++] } }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await resolveReverseNameQuorum(ADDR, { fetchImpl })).toEqual({
      status: "confirmed-hit",
      name: "alice.mono",
    });
  });

  it("is capped at REVERSE_MAX_ENDPOINTS", async () => {
    fleetMock.urls = ["https://a", "https://b", "https://c", "https://d", "https://e", "https://f"];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { name: null } }), { status: 200 }),
    ) as unknown as typeof fetch;

    await resolveReverseNameQuorum(ADDR, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("an empty fleet is insufficient, not a crash", async () => {
    fleetMock.urls = [];
    expect(await resolveReverseNameQuorum(ADDR)).toEqual({ status: "insufficient" });
  });

  it("a single-RPC chain can never reach quorum (the honest custom-chain case)", async () => {
    fleetMock.urls = ["https://only-one"];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { name: NAME } }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await resolveReverseNameQuorum(ADDR, { fetchImpl })).toEqual({ status: "insufficient" });
  });

  it("an HTTP error or JSON-RPC error is a non-answer", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: -1 } }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await resolveReverseNameQuorum(ADDR, { fetchImpl })).toEqual({ status: "insufficient" });
  });
});

describe("G2 — only DEFINITIVE outcomes are cached", () => {
  it("caches a confirmed hit", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, NAME, 1_000);
    expect(readCachedReverseName(ADDR, 1_000)).toEqual({ name: NAME, ts: 1_000 });
  });

  it("caches a confirmed MISS (so a bare address stops re-probing)", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, null, 1_000);
    expect(readCachedReverseName(ADDR, 1_000)).toEqual({ name: null, ts: 1_000 });
  });

  it("a DISAGREEMENT writes nothing", async () => {
    let i = 0;
    const names = [NAME, OTHER, NAME];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { name: names[i++] } }), { status: 200 }),
    ) as unknown as typeof fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);

    expect(await loadReverseName(ADDR)).toBeNull();
    expect(readCachedReverseName(ADDR, Date.now())).toBeNull();
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it("an INSUFFICIENT quorum writes nothing", async () => {
    fleetMock.urls = ["https://only-one"];
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ result: { name: NAME } }), { status: 200 }),
    ) as unknown as typeof fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);

    expect(await loadReverseName(ADDR)).toBeNull();
    expect(readCachedReverseName(ADDR, Date.now())).toBeNull();
    vi.mocked(globalThis.fetch).mockRestore();
  });

  it("a TRANSPORT failure writes nothing (a frozen wrong absence would be worse)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);

    expect(await loadReverseName(ADDR)).toBeNull();
    expect(readCachedReverseName(ADDR, Date.now())).toBeNull();
    vi.mocked(globalThis.fetch).mockRestore();
  });
});

describe("the cache TTL", () => {
  it("expires INCLUSIVELY at the boundary", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, NAME, 1_000);
    expect(readCachedReverseName(ADDR, 1_000 + REVERSE_NAME_TTL_MS - 1)).not.toBeNull();
    expect(readCachedReverseName(ADDR, 1_000 + REVERSE_NAME_TTL_MS)).toBeNull();
  });

  it("eviction returns the SAME object when nothing expired", () => {
    const state = { version: 1 as const, reverse: { k: { name: NAME, ts: 1_000 } } };
    expect(evictExpiredReverseNames(state, 1_500)).toBe(state);
  });

  it("eviction drops only the expired entries", () => {
    const state = {
      version: 1 as const,
      reverse: { fresh: { name: NAME, ts: 1_000 }, stale: { name: OTHER, ts: 0 } },
    };
    const out = evictExpiredReverseNames(state, REVERSE_NAME_TTL_MS + 500);
    expect(out).not.toBe(state);
    expect(Object.keys(out.reverse)).toEqual(["fresh"]);
  });
});

describe("C3 — the cache is CHAIN-SCOPED", () => {
  it("keys include the active chain", () => {
    expect(reverseNameKey(ADDR, "0x10f2c")).toBe(`mono.name.reverse.${ADDR}.0x10f2c.v1`);
    expect(reverseNameKey(ADDR, "0x539")).not.toBe(reverseNameKey(ADDR, "0x10f2c"));
  });

  it("a name confirmed on the builtin chain does NOT surface on a custom chain", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, NAME, 1_000);
    expect(readCachedReverseName(ADDR, 1_000)?.name).toBe(NAME);

    chainMock.key = "0x539"; // custom chain active
    expect(readCachedReverseName(ADDR, 1_000)).toBeNull();

    chainMock.key = "0x10f2c";
    expect(readCachedReverseName(ADDR, 1_000)?.name).toBe(NAME);
  });

  it("each chain keeps its own entry", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, NAME, 1_000);
    chainMock.key = "0x539";
    await writeReverseName(ADDR, OTHER, 1_000);

    expect(readCachedReverseName(ADDR, 1_000)?.name).toBe(OTHER);
    chainMock.key = "0x10f2c";
    expect(readCachedReverseName(ADDR, 1_000)?.name).toBe(NAME);
  });
});

describe("invalidation", () => {
  it("drops exactly that address's entry on the active chain", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, NAME, 1_000);
    await writeReverseName("mono1bob", OTHER, 1_000);

    await invalidateReverseName(ADDR);
    expect(readCachedReverseName(ADDR, 1_000)).toBeNull();
    expect(readCachedReverseName("mono1bob", 1_000)?.name).toBe(OTHER);
  });
});

describe("loadReverseName", () => {
  it("a fresh cache entry short-circuits with NO network", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, NAME, Date.now());
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await loadReverseName(ADDR)).toBe(NAME);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("a cached MISS also short-circuits", async () => {
    await primeReverseNameCache();
    await writeReverseName(ADDR, null, Date.now());
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await loadReverseName(ADDR)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("never throws, whatever happens", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(loadReverseName(ADDR)).resolves.toBeNull();
    await expect(loadReverseName("")).resolves.toBeNull();
    vi.mocked(globalThis.fetch).mockRestore();
  });
});
