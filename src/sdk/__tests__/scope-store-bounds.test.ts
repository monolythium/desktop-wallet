// The two store-growth bug fixes: the notified-set dedupe cap, and per-vault
// scope pruning across the notification / activity-cache / chain-health stores
// with NO cross-vault damage (the trailing-dot prefix guard). The Tauri
// plugin-store is faked in-memory, namespaced by store file so the three stores
// stay isolated.

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { NOTIFIED_SET_CAP, appendNotifiedIdCapped } from "../notifications";
import {
  __resetNotificationsStoreForTests,
  purgeScopesForAddress as purgeNotifications,
} from "../notifications-store";
import {
  __resetActivityCacheStoreForTests,
  purgeScopesForAddress as purgeActivity,
} from "../activity-cache-store";
import {
  __resetChainHealthStoreForTests,
  purgeScopesForAddress as purgeChainHealth,
} from "../chain-health-store";
import { __setGenesisIdentityResolverForTests } from "../chain-identity";

const GENESIS = `0x${"11".repeat(32)}`;

beforeEach(() => {
  backing.clear();
  __setGenesisIdentityResolverForTests(async () => GENESIS);
  __resetNotificationsStoreForTests();
  __resetActivityCacheStoreForTests();
  __resetChainHealthStoreForTests();
});

const scopesOf = (file: string, field: string): Record<string, unknown> =>
  (backing.get(`${file}::state`) as Record<string, Record<string, unknown>>)[field] ?? {};

describe("appendNotifiedIdCapped — the dedupe-set bound", () => {
  it("caps to NOTIFIED_SET_CAP, keeps the newest, and retains recent ids for dedupe", () => {
    let ids: string[] = [];
    for (let i = 0; i < NOTIFIED_SET_CAP + 50; i++) ids = appendNotifiedIdCapped(ids, `id${i}`);
    expect(ids.length).toBe(NOTIFIED_SET_CAP);
    expect(ids[ids.length - 1]).toBe(`id${NOTIFIED_SET_CAP + 49}`); // newest kept
    expect(ids.includes("id0")).toBe(false); // oldest evicted
    // A recently-seen id is still present, so dedupe within the window still works.
    expect(ids.includes(`id${NOTIFIED_SET_CAP + 40}`)).toBe(true);
  });
});

describe("purgeScopesForAddress — drops exactly one vault's scopes, no cross-vault damage", () => {
  it("notifications: removes this address's history / notified-set / watermark, leaves others (incl. a longer address that shares the prefix)", async () => {
    backing.set("notifications.v1.json::state", {
      version: 2,
      genesisIdentity: GENESIS,
      scopes: {
        "mono.notifications.history.mono1a.0x10f2c.v1": { schemaVersion: 0, entries: [] },
        "mono.notifications.notified.mono1a.0x10f2c.v1": { schemaVersion: 0, ids: ["x"] },
        "mono.notifications.incoming-watermark.mono1a.0x10f2c.v1": { blockHeight: 1, txIndex: 0, logIndex: 0 },
        "mono.notifications.history.mono1b.0x10f2c.v1": { schemaVersion: 0, entries: [{ id: "keep" }] },
        "mono.notifications.history.mono1aa.0x10f2c.v1": { schemaVersion: 0, entries: [{ id: "keep2" }] },
      },
    });
    await purgeNotifications("mono1a");
    expect(Object.keys(scopesOf("notifications.v1.json", "scopes")).sort()).toEqual([
      "mono.notifications.history.mono1aa.0x10f2c.v1", // longer address survives (trailing-dot guard)
      "mono.notifications.history.mono1b.0x10f2c.v1",
    ]);
  });

  it("activity cache: removes this address's entries, leaves others", async () => {
    backing.set("activity.v1.json::state", {
      version: 2,
      genesisIdentity: GENESIS,
      confirmed: {
        "mono.activity.mono1a.0x10f2c.v1": { a: 1 },
        "mono.activity.mono1b.0x10f2c.v1": { b: 1 },
        "mono.activity.mono1aa.0x10f2c.v1": { c: 1 },
      },
    });
    await purgeActivity("mono1a");
    expect(Object.keys(scopesOf("activity.v1.json", "confirmed")).sort()).toEqual([
      "mono.activity.mono1aa.0x10f2c.v1",
      "mono.activity.mono1b.0x10f2c.v1",
    ]);
  });

  it("chain-health: removes this address's warm-start heads, leaves others", async () => {
    backing.set("chain-health.v1.json::state", {
      version: 1,
      heads: {
        "mono.chain-health.head.mono1a.0x10f2c.v1": { height: 1, headId: "h", advancedAtMs: 0 },
        "mono.chain-health.head.mono1b.0x10f2c.v1": { height: 2, headId: "h2", advancedAtMs: 0 },
      },
    });
    await purgeChainHealth("mono1a");
    expect(Object.keys(scopesOf("chain-health.v1.json", "heads"))).toEqual([
      "mono.chain-health.head.mono1b.0x10f2c.v1",
    ]);
  });
});
