// Removing a vault must both drop its catalog row AND purge its scoped state
// (the growth-bug fix). scope-cleanup is mocked so this asserts the wiring: the
// removed vault's own addressHex is handed to purgeVaultScopes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const purgeVaultScopes = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../scope-cleanup", () => ({ purgeVaultScopes }));

const backing = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => {
  class FakeStore {
    constructor(private file: string) {}
    static async load(file: string): Promise<FakeStore> {
      return new FakeStore(file);
    }
    async get<T>(k: string): Promise<T | undefined> {
      const raw = backing.get(`${this.file}::${k}`);
      return raw === undefined ? undefined : (JSON.parse(JSON.stringify(raw)) as T);
    }
    async set(k: string, v: unknown): Promise<void> {
      backing.set(`${this.file}::${k}`, v);
    }
    async save(): Promise<void> {}
  }
  return { Store: FakeStore };
});

import { loadCatalog, removeVaultFromCatalog } from "../vaultCatalog";

beforeEach(() => {
  backing.clear();
  vi.clearAllMocks();
});

describe("removeVaultFromCatalog", () => {
  it("deletes the catalog row and purges only that vault's scoped state", async () => {
    backing.set("vaults.v1.json::state", {
      version: 1,
      vaults: {
        "kc:lyth:aaa:v1": { slot: "kc:lyth:aaa:v1", name: "A", addressHex: "0xaaa", createdAt: 1, kind: "local" },
        "kc:lyth:bbb:v1": { slot: "kc:lyth:bbb:v1", name: "B", addressHex: "0xbbb", createdAt: 2, kind: "local" },
      },
      activeSlot: "kc:lyth:aaa:v1",
    });

    await removeVaultFromCatalog("kc:lyth:aaa:v1");

    // The removed vault's scoped state is purged with ITS OWN address only.
    expect(purgeVaultScopes).toHaveBeenCalledTimes(1);
    expect(purgeVaultScopes).toHaveBeenCalledWith("0xaaa");

    // The catalog row is gone; the other vault remains.
    const catalog = await loadCatalog();
    expect(Object.keys(catalog.vaults)).toEqual(["kc:lyth:bbb:v1"]);
    expect(catalog.activeSlot).toBe("kc:lyth:bbb:v1");
  });

  it("is a no-op for an unknown slot", async () => {
    backing.set("vaults.v1.json::state", { version: 1, vaults: {}, activeSlot: null });
    await removeVaultFromCatalog("kc:lyth:missing:v1");
    expect(purgeVaultScopes).not.toHaveBeenCalled();
  });
});
