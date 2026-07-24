// H3 — chain-scope isolation. Activating a chain rescopes every per-(address,
// chain) store via scopeChainKey(); a fresh chain must start EMPTY (no leak from
// the previous chain) and switching back must restore the prior scope intact.
// Exercised end-to-end against the real warm-start store (a representative
// per-(address, chain) store) driven through setActiveChain.

import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => {
  class FakeStore {
    constructor(private readonly file: string) {}
    static async load(file: string): Promise<FakeStore> {
      return new FakeStore(file);
    }
    async get<T>(key: string): Promise<T | undefined> {
      const v = backing.get(`${this.file}:${key}`);
      return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.set(`${this.file}:${key}`, JSON.parse(JSON.stringify(value)));
    }
    async save(): Promise<void> {
      /* no-op */
    }
  }
  return { Store: FakeStore };
});

vi.mock("../build-mode", () => ({ isHardenedBuild: () => false }));
vi.mock("../client", async (orig) => ({
  ...(await orig<typeof import("../client")>()),
  currentEndpoint: () => "https://rpc.monolythium.com",
  setEndpoint: () => {},
  isKnownEndpoint: () => true,
  resolveActiveEndpoint: () => "https://rpc.monolythium.com",
}));

import { BUILTIN_CHAIN_ID, __resetChainsForTests, addUserChain, scopeChainKey, setActiveChain } from "../chains";
import { __resetChainHealthStoreForTests, loadWarmStartHead, saveWarmStartHead } from "../chain-health-store";
import {
  loadLastKnownBalance,
  saveLastKnownBalance,
  __resetLastKnownBalanceCacheForTest,
} from "../last-known-balance";

beforeEach(() => {
  backing.clear();
  __resetChainHealthStoreForTests();
  __resetLastKnownBalanceCacheForTest();
  __resetChainsForTests();
  localStorage.clear();
});

describe("chain scope isolation (H3)", () => {
  it("a fresh custom chain starts EMPTY; returning to the builtin restores it intact", async () => {
    const ADDR = "0xwallet";
    const HEAD = { height: 42, headId: "0xhead", advancedAtMs: 100 };

    // Builtin scope: persist a warm-start head.
    expect(scopeChainKey()).toBe("0x10f2c");
    await saveWarmStartHead(ADDR, scopeChainKey(), HEAD);
    expect(await loadWarmStartHead(ADDR, scopeChainKey())).toEqual(HEAD);

    // Activate a custom chain → a fresh, EMPTY scope (no leak from the builtin).
    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(setActiveChain("0x539").ok).toBe(true);
    expect(scopeChainKey()).toBe("0x539");
    expect(await loadWarmStartHead(ADDR, scopeChainKey())).toBeNull();

    // Persist a head under the custom scope, then switch back to the builtin.
    await saveWarmStartHead(ADDR, scopeChainKey(), { height: 7, headId: "0xcustom", advancedAtMs: 200 });
    expect(setActiveChain(BUILTIN_CHAIN_ID).ok).toBe(true);
    expect(scopeChainKey()).toBe("0x10f2c");
    // The builtin head is intact — the custom chain's head never bled across.
    expect(await loadWarmStartHead(ADDR, scopeChainKey())).toEqual(HEAD);

    // And the custom scope still holds its own head, distinct from the builtin's.
    expect(setActiveChain("0x539").ok).toBe(true);
    expect(await loadWarmStartHead(ADDR, scopeChainKey())).toEqual({ height: 7, headId: "0xcustom", advancedAtMs: 200 });
  });
});

describe("chain scope isolation — the last-known BALANCE (H1)", () => {
  // The balance store is the highest-stakes member of this family: a leak here
  // does not show a stale warning, it shows another network's BALANCE labelled
  // as the user's. The record carries its own chainIdHex as defence in depth,
  // but that check is only meaningful because reads and writes both derive the
  // chain component from scopeChainKey() — with a fixed builtin constant on
  // both sides it would compare against itself and always pass.
  it("a custom chain never shows the builtin chain's remembered balance", async () => {
    const ADDR = "mono1wallet";
    const BUILTIN_BALANCE = "5000000000000000000"; // 5 LYTH

    expect(scopeChainKey()).toBe("0x10f2c");
    await saveLastKnownBalance(ADDR, BUILTIN_BALANCE, 1_000);
    expect(await loadLastKnownBalance(ADDR)).toBe(BUILTIN_BALANCE);

    // Activate a custom chain → no seed at all, so the hero shows a skeleton
    // rather than the builtin chain's figure.
    addUserChain({ chainId: "0x539", name: "Local", rpc: "http://localhost:8545" });
    expect(setActiveChain("0x539").ok).toBe(true);
    expect(scopeChainKey()).toBe("0x539");
    expect(await loadLastKnownBalance(ADDR)).toBeNull();

    // Each chain keeps its own figure.
    await saveLastKnownBalance(ADDR, "9000000000000000000", 2_000);
    expect(await loadLastKnownBalance(ADDR)).toBe("9000000000000000000");

    expect(setActiveChain(BUILTIN_CHAIN_ID).ok).toBe(true);
    expect(await loadLastKnownBalance(ADDR)).toBe(BUILTIN_BALANCE);
  });
});

// Still-exists half. The behavioural checks above are only meaningful because the
// protected paths derive the chain from scopeChainKey() on BOTH sides. A
// regression that hardcoded the id — even same-cased — would make a custom chain
// reuse the builtin's scope and bring the leaks back, yet a behavioural check
// might not notice if both sides matched the same literal. So pin the source
// directly: the scoping call must still be present, and no chain literal may
// stand in for it.
const SDK_SRC = import.meta.glob("/src/sdk/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const sdkSource = (name: string): string =>
  Object.entries(SDK_SRC).find(([p]) => p.endsWith(`/${name}`))?.[1] ?? "";

describe("chain scope isolation — the scoping call still exists", () => {
  it("the warm-start and balance paths derive the chain from scopeChainKey(), not a literal", () => {
    for (const file of ["last-known-balance.ts", "useChainHealth.ts"]) {
      const src = sdkSource(file);
      expect(src.length, `${file} not found by the scan`).toBeGreaterThan(0);
      expect(src, file).toContain("scopeChainKey(");
      expect(src, file).not.toContain("BUILTIN_CHAIN_ID");
    }
  });
});
