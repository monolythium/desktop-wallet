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

beforeEach(() => {
  backing.clear();
  __resetChainHealthStoreForTests();
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
