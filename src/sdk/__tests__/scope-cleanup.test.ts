// The coordinator that removeVaultFromCatalog calls: convert the vault's stored
// addressHex to the bech32m the scoped stores key on, then fan out to all three
// purges. The store purges are mocked so this isolates the conversion + fan-out.

import { afterEach, describe, expect, it, vi } from "vitest";

const purges = vi.hoisted(() => ({
  n: vi.fn(async () => {}),
  a: vi.fn(async () => {}),
  c: vi.fn(async () => {}),
}));
vi.mock("../notifications-store", () => ({ purgeScopesForAddress: purges.n }));
vi.mock("../activity-cache-store", () => ({ purgeScopesForAddress: purges.a }));
vi.mock("../chain-health-store", () => ({ purgeScopesForAddress: purges.c }));

import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { purgeVaultScopes } from "../scope-cleanup";

const HEX = `0x${"ab".repeat(20)}`; // a 20-byte address
const BECH = addressToTypedBech32("user", HEX).toLowerCase();

afterEach(() => vi.clearAllMocks());

describe("purgeVaultScopes", () => {
  it("converts addressHex → bech32m and fans out to all three scoped stores", async () => {
    await purgeVaultScopes(HEX);
    expect(purges.n).toHaveBeenCalledWith(BECH);
    expect(purges.a).toHaveBeenCalledWith(BECH);
    expect(purges.c).toHaveBeenCalledWith(BECH);
  });

  it("does nothing for a null address (a vault never unlocked)", async () => {
    await purgeVaultScopes(null);
    expect(purges.n).not.toHaveBeenCalled();
    expect(purges.a).not.toHaveBeenCalled();
    expect(purges.c).not.toHaveBeenCalled();
  });

  it("never throws on an unparseable address", async () => {
    await expect(purgeVaultScopes("not-a-hex-address")).resolves.toBeUndefined();
    expect(purges.n).not.toHaveBeenCalled();
  });
});
