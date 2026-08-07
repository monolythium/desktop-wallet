import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = new Map<string, unknown>();

vi.mock("../wallet-store", () => {
  class FakeStore {
    static async load(_file: string): Promise<FakeStore> {
      return new FakeStore();
    }
    async get<T>(key: string): Promise<T | undefined> {
      const value = backing.get(key);
      return value === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(value)) as T);
    }
    async set(key: string, value: unknown): Promise<void> {
      backing.set(key, JSON.parse(JSON.stringify(value)));
    }
    async save(): Promise<void> {
      /* no-op */
    }
  }
  return { WalletStore: FakeStore };
});

import { activityCacheKey } from "../activity-cache";
import {
  __resetActivityCacheStoreForTests,
  readConfirmedCache,
  writeConfirmedCache,
} from "../activity-cache-store";
import { __setGenesisIdentityResolverForTests } from "../chain-identity";
import type { LiveAddressActivityRow } from "../live";

const GENESIS_A = `0x${"11".repeat(32)}`;
const GENESIS_B = `0x${"22".repeat(32)}`;
const SCOPE = activityCacheKey("mono1self", "0x10f2c");
let genesisIdentity = GENESIS_A;

function row(): LiveAddressActivityRow {
  return {
    blockHeight: 12n,
    txIndex: 1,
    logIndex: 0,
    kind: "transfer",
    direction: "in",
    counterparty: "mono1from",
    tokenId: null,
    amount: "3",
    cluster: null,
    weightBps: null,
    subKind: null,
    blockTimestampSeconds: 1_700_000_000n,
    txHash: "0xabc",
    clusterName: null,
  };
}

beforeEach(() => {
  backing.clear();
  genesisIdentity = GENESIS_A;
  __setGenesisIdentityResolverForTests(async () => genesisIdentity);
  __resetActivityCacheStoreForTests();
});

describe("activity cache genesis scoping", () => {
  it("does not paint confirmed rows from the prior block 0", async () => {
    await writeConfirmedCache(SCOPE, [row()], 123);
    expect((await readConfirmedCache(SCOPE))?.rows).toHaveLength(1);

    genesisIdentity = GENESIS_B;

    expect(await readConfirmedCache(SCOPE)).toBeNull();
    await writeConfirmedCache(SCOPE, [row()], 456);
    expect((await readConfirmedCache(SCOPE))?.lastFetchedAtMs).toBe(456);
  });

  it("fails closed on the legacy chain-id-only root schema", async () => {
    backing.set("state", {
      version: 1,
      confirmed: {
        [SCOPE]: {
          schemaVersion: 0,
          confirmed: [],
          lastFetchedAtMs: 999,
        },
      },
    });
    __resetActivityCacheStoreForTests();

    expect(await readConfirmedCache(SCOPE)).toBeNull();
  });
});
