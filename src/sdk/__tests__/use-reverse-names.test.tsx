// The reverse-name hook tiers.
//
// The tier split exists so a long list cannot fan a full 4-endpoint quorum per
// row. G3 is the subtle one: a cache write notifies subscribers, and if a
// subscriber re-fires resolution the loop is infinite AND silent — it looks
// like network churn rather than a crash.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

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

const resolves = vi.hoisted(() => ({ calls: [] as string[], result: null as string | null }));
vi.mock("../reverse-name", async (orig) => ({
  ...(await orig<typeof import("../reverse-name")>()),
  loadReverseName: vi.fn(async (a: string) => {
    resolves.calls.push(a);
    return resolves.result;
  }),
}));

import {
  EAGER_REVERSE_NAME_MAX,
  selectReverseNamesToResolve,
  useReverseName,
  useReverseNamesCached,
  useReverseNamesEager,
} from "../use-reverse-names";
import {
  primeReverseNameCache,
  reverseNameCacheSnapshot,
  reverseNameKey,
  writeReverseName,
  REVERSE_NAME_TTL_MS,
  __resetReverseNameCacheForTest,
} from "../reverse-name-cache";

const A = "mono1aaa";
const B = "mono1bbb";
const NAME = "alice.mono";

function state(entries: Record<string, { name: string | null; ts: number }>) {
  return { version: 1 as const, reverse: entries };
}

beforeEach(async () => {
  backing.clear();
  localStorage.clear();
  chainMock.key = "0x10f2c";
  resolves.calls = [];
  resolves.result = null;
  __resetReverseNameCacheForTest();
  await primeReverseNameCache();
});

describe("selectReverseNamesToResolve", () => {
  it("de-duplicates by lowercased address, preserving order", () => {
    expect(
      selectReverseNamesToResolve([A, A.toUpperCase(), B], state({}), 1_000, 30, "0x10f2c"),
    ).toEqual([A, B]);
  });

  it("skips a fresh hit", () => {
    const s = state({ [reverseNameKey(A, "0x10f2c")]: { name: NAME, ts: 1_000 } });
    expect(selectReverseNamesToResolve([A, B], s, 1_500, 30, "0x10f2c")).toEqual([B]);
  });

  it("skips a fresh cached MISS (that is why the miss is cached)", () => {
    const s = state({ [reverseNameKey(A, "0x10f2c")]: { name: null, ts: 1_000 } });
    expect(selectReverseNamesToResolve([A, B], s, 1_500, 30, "0x10f2c")).toEqual([B]);
  });

  it("includes a STALE entry", () => {
    const s = state({ [reverseNameKey(A, "0x10f2c")]: { name: NAME, ts: 0 } });
    expect(
      selectReverseNamesToResolve([A], s, REVERSE_NAME_TTL_MS + 1, 30, "0x10f2c"),
    ).toEqual([A]);
  });

  it("caps at 30, keeping the TOP rows", () => {
    const many = Array.from({ length: 100 }, (_, i) => `mono1addr${i}`);
    const out = selectReverseNamesToResolve(many, state({}), 1_000, EAGER_REVERSE_NAME_MAX, "0x10f2c");
    expect(out).toHaveLength(30);
    expect(out[0]).toBe("mono1addr0");
    expect(out[29]).toBe("mono1addr29");
  });

  it("ignores blanks", () => {
    expect(selectReverseNamesToResolve(["", "  ", A], state({}), 1_000, 30, "0x10f2c")).toEqual([A]);
  });

  it("an entry cached on ANOTHER chain does not count as resolved", () => {
    const s = state({ [reverseNameKey(A, "0x539")]: { name: NAME, ts: 1_000 } });
    expect(selectReverseNamesToResolve([A], s, 1_500, 30, "0x10f2c")).toEqual([A]);
  });
});

function CachedProbe({ addresses }: { addresses: string[] }) {
  const map = useReverseNamesCached(addresses);
  return <span data-testid="out">{JSON.stringify([...map.entries()])}</span>;
}
function EagerProbe({ addresses }: { addresses: string[] }) {
  const map = useReverseNamesEager(addresses);
  return <span data-testid="out">{JSON.stringify([...map.entries()])}</span>;
}
function SingleProbe({ address }: { address: string }) {
  const name = useReverseName(address);
  return <span data-testid="out">{name ?? "(none)"}</span>;
}
const out = () => screen.getByTestId("out").textContent ?? "";

describe("useReverseNamesCached — never resolves", () => {
  it("triggers ZERO resolves, however many rows", async () => {
    render(<CachedProbe addresses={Array.from({ length: 50 }, (_, i) => `mono1a${i}`)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolves.calls).toEqual([]);
  });

  it("surfaces warm entries", async () => {
    await writeReverseName(A, NAME, Date.now());
    render(<CachedProbe addresses={[A]} />);
    expect(out()).toContain(NAME);
  });

  it("omits an entry cached on another chain", async () => {
    await writeReverseName(A, NAME, Date.now());
    chainMock.key = "0x539";
    render(<CachedProbe addresses={[A]} />);
    expect(out()).not.toContain(NAME);
  });
});

describe("useReverseNamesEager", () => {
  it("fires a bounded resolve set once per address-set change", async () => {
    const { rerender } = render(<EagerProbe addresses={[A, B]} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolves.calls.sort()).toEqual([A, B]);

    // Same set again — no new resolves.
    const before = resolves.calls.length;
    rerender(<EagerProbe addresses={[A, B]} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolves.calls).toHaveLength(before);
  });

  it("caps the fan-out at 30 even for a 100-row feed", async () => {
    render(<EagerProbe addresses={Array.from({ length: 100 }, (_, i) => `mono1a${i}`)} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolves.calls).toHaveLength(EAGER_REVERSE_NAME_MAX);
  });

  it("skips addresses that are already warm", async () => {
    await writeReverseName(A, NAME, Date.now());
    render(<EagerProbe addresses={[A, B]} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resolves.calls).toEqual([B]);
  });

  it("G3 — a cache-write notification does NOT re-fire resolution (no loop)", async () => {
    render(<EagerProbe addresses={[A, B]} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const afterFirstPass = resolves.calls.length;
    expect(afterFirstPass).toBeGreaterThan(0);

    // Simulate several cache writes — each notifies every subscriber.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await writeReverseName(`mono1other${i}`, NAME, Date.now());
      });
    }

    // The subscription RE-READ only; it never re-triggered a resolve.
    expect(resolves.calls).toHaveLength(afterFirstPass);
  });
});

describe("useReverseName", () => {
  it("returns null while unresolved", async () => {
    render(<SingleProbe address={A} />);
    expect(out()).toBe("(none)");
  });

  it("renders a warm entry with no resolve", async () => {
    await writeReverseName(A, NAME, Date.now());
    render(<SingleProbe address={A} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(out()).toBe(NAME);
    expect(resolves.calls).toEqual([]);
  });

  it("updates when the cache write lands", async () => {
    render(<SingleProbe address={A} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(out()).toBe("(none)");

    await act(async () => {
      await writeReverseName(A, NAME, Date.now());
    });
    expect(out()).toBe(NAME);
  });

  it("an empty address resolves nothing", async () => {
    render(<SingleProbe address="   " />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(out()).toBe("(none)");
    expect(resolves.calls).toEqual([]);
  });

  it("a cached MISS reads as no name (not as unresolved churn)", async () => {
    await writeReverseName(A, null, Date.now());
    render(<SingleProbe address={A} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(out()).toBe("(none)");
    expect(resolves.calls).toEqual([]);
  });
});

describe("the snapshot is referentially usable", () => {
  it("returns a stable object between writes", () => {
    const a = reverseNameCacheSnapshot();
    expect(reverseNameCacheSnapshot()).toBe(a);
  });
});
