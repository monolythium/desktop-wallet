// The coordinator that removeVaultFromCatalog calls: convert the vault's stored
// addressHex to the bech32m the scoped stores key on, then fan out to EVERY
// scoped store's purge. The purges are mocked so this isolates the conversion +
// fan-out.
//
// This test asserts ALL of the coordinator's purges are invoked — not a
// hand-picked subset. The scoped-store invariant (scoped-store-invariant.test.ts)
// cross-checks that every store scope-cleanup.ts imports is referenced here, so a
// store added to the coordinator cannot silently skip this test. Removing any one
// purge call from the coordinator turns the matching assertion below red.

import { afterEach, describe, expect, it, vi } from "vitest";

// One mock per scoped store the coordinator fans out to. Keyed by the store the
// purge belongs to, so the assertions read as a coverage checklist.
const purges = vi.hoisted(() => ({
  notifications: vi.fn(async () => {}),
  activity: vi.fn(async () => {}),
  chainHealth: vi.fn(async () => {}),
  sentRecipients: vi.fn(async () => {}),
  lastKnownBalance: vi.fn(async () => {}),
  reverseNames: vi.fn(async () => {}),
  pendingTxs: vi.fn(async () => {}),
  nameNudge: vi.fn(() => {}),
}));
vi.mock("../notifications-store", () => ({ purgeScopesForAddress: purges.notifications }));
vi.mock("../activity-cache-store", () => ({ purgeScopesForAddress: purges.activity }));
vi.mock("../chain-health-store", () => ({ purgeScopesForAddress: purges.chainHealth }));
vi.mock("../sent-recipients-store", () => ({ purgeScopesForAddress: purges.sentRecipients }));
vi.mock("../last-known-balance", () => ({ purgeScopesForAddress: purges.lastKnownBalance }));
vi.mock("../reverse-name-cache", () => ({ purgeScopesForAddress: purges.reverseNames }));
vi.mock("../pending-tx-store", () => ({ purgeScopesForAddress: purges.pendingTxs }));
vi.mock("../has-name", () => ({ purgeNameNudgeForAddress: purges.nameNudge }));

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { purgeVaultScopes } from "../scope-cleanup";

const HEX = `0x${"ab".repeat(20)}`; // a 20-byte address
const BECH = addressToTypedBech32("user", HEX).toLowerCase();

const ALL = Object.entries(purges);

afterEach(() => vi.clearAllMocks());

describe("purgeVaultScopes", () => {
  it("converts addressHex → bech32m and fans out to EVERY scoped store", async () => {
    await purgeVaultScopes(HEX);
    // Every purge in the coordinator must have been called with the bech32m
    // address. Removing any one call from scope-cleanup.ts fails its line here.
    for (const [name, fn] of ALL) {
      expect(fn, `${name} purge not invoked`).toHaveBeenCalledWith(BECH);
    }
  });

  it("does nothing for a null address (a vault never unlocked)", async () => {
    await purgeVaultScopes(null);
    for (const [name, fn] of ALL) {
      expect(fn, `${name} purge should not run`).not.toHaveBeenCalled();
    }
  });

  it("never throws on an unparseable address", async () => {
    await expect(purgeVaultScopes("not-a-hex-address")).resolves.toBeUndefined();
    for (const [, fn] of ALL) expect(fn).not.toHaveBeenCalled();
  });
});
