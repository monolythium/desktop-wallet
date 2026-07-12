// Tests for the durable warm-start head cache.
//
// The Tauri plugin-store is faked in-memory (the reconcile-test pattern): a
// module-level Map with a JSON round-trip, so the test stays honest about what
// survives a reload. Covers per-scope round-trip, the no-cross-scope-bleed rule,
// and malformed-shape rejection (fail to a cold start).

import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => {
  class FakeStore {
    static async load(): Promise<FakeStore> {
      return new FakeStore();
    }
    async get<T>(key: string): Promise<T | undefined> {
      const raw = backing.get(key);
      return raw === undefined ? undefined : (JSON.parse(JSON.stringify(raw)) as T);
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.set(key, value);
    }
    async save(): Promise<void> {}
  }
  return { Store: FakeStore };
});

import {
  __resetChainHealthStoreForTests,
  loadWarmStartHead,
  parseWarmStartHead,
  saveWarmStartHead,
} from "../chain-health-store";

beforeEach(() => {
  backing.clear();
  __resetChainHealthStoreForTests();
});

describe("chain-health warm-start store", () => {
  it("round-trips a head for a scope, surviving a reload", async () => {
    await saveWarmStartHead("0xa", "0x10f2c", { height: 5, headId: "0xh", advancedAtMs: 100 });
    __resetChainHealthStoreForTests(); // drop the in-memory cache → re-read from the backing "disk"
    expect(await loadWarmStartHead("0xa", "0x10f2c")).toEqual({ height: 5, headId: "0xh", advancedAtMs: 100 });
  });

  it("never surfaces one scope's head under another (no cross-scope bleed)", async () => {
    await saveWarmStartHead("0xa", "0x10f2c", { height: 5, headId: "0xA", advancedAtMs: 1 });
    expect(await loadWarmStartHead("0xb", "0x10f2c")).toBeNull(); // different address
    expect(await loadWarmStartHead("0xa", "0xbeef")).toBeNull(); // different chain
    expect(await loadWarmStartHead("0xa", "0x10f2c")).toEqual({ height: 5, headId: "0xA", advancedAtMs: 1 });
  });

  it("returns null for an empty store (cold start)", async () => {
    expect(await loadWarmStartHead("0xa", "0x10f2c")).toBeNull();
  });

  it("parseWarmStartHead rejects malformed shapes", () => {
    expect(parseWarmStartHead(null)).toBeNull();
    expect(parseWarmStartHead({})).toBeNull();
    expect(parseWarmStartHead({ height: "5", headId: "0xh", advancedAtMs: 1 })).toBeNull();
    expect(parseWarmStartHead({ height: 5, headId: "", advancedAtMs: 1 })).toBeNull();
    expect(parseWarmStartHead({ height: 5, headId: "0xh", advancedAtMs: Number.NaN })).toBeNull();
    expect(parseWarmStartHead({ height: 5, headId: "0xh", advancedAtMs: 1 })).toEqual({
      height: 5,
      headId: "0xh",
      advancedAtMs: 1,
    });
  });
});
