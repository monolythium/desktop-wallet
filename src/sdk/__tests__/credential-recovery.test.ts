// Guard: "could not look" never reads as "nothing there".
//
// This is the failure direction the whole item turns on. An orphaned vault and
// a failed enumeration look identical if both produce an empty list — and the
// wallet would then tell a funded user, in good faith, that they have no
// wallet. That is the defect this fixes, wearing a different face.
//
// The Rust side asserts the same property structurally (`unsupported` and
// `unavailable` carry no `accounts` field at all). This side asserts it
// behaviourally across the seam, because the seam is where a `catch` could
// quietly turn a thrown error into `[]`.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock.fn }));

const listVaultsMock = vi.hoisted(() => ({ fn: vi.fn() }));
const registerVaultMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../vaultCatalog", () => ({
  listVaults: listVaultsMock.fn,
  registerVault: registerVaultMock.fn,
}));

import { findOrphanedSlots, listStoredAccounts } from "../credential-recovery";

beforeEach(() => {
  invokeMock.fn.mockReset();
  listVaultsMock.fn.mockReset();
  registerVaultMock.fn.mockReset();
  listVaultsMock.fn.mockResolvedValue([]);
});

describe("listStoredAccounts", () => {
  it("passes an enumeration through, including a definitive empty one", async () => {
    // The control: an empty list IS a valid answer — but only under
    // `enumerated`. Without this, an implementation that always reported
    // `unavailable` would pass every other test here.
    invokeMock.fn.mockResolvedValue({ outcome: "enumerated", accounts: [] });
    expect(await listStoredAccounts()).toEqual({ outcome: "enumerated", accounts: [] });
  });

  it("turns a thrown IPC call into `unavailable`, never an empty list", async () => {
    invokeMock.fn.mockRejectedValue(new Error("denied"));
    const scan = await listStoredAccounts();
    expect(
      scan.outcome,
      "a failed enumeration was reported as an answer; an orphaned vault would look absent",
    ).toBe("unavailable");
    expect(scan).not.toHaveProperty("accounts");
  });

  it("preserves the unsupported outcome rather than flattening it", async () => {
    invokeMock.fn.mockResolvedValue({ outcome: "unsupported", platform: "linux" });
    const scan = await listStoredAccounts();
    expect(scan.outcome).toBe("unsupported");
    expect(scan).not.toHaveProperty("accounts");
  });
});

describe("findOrphanedSlots", () => {
  it("compares against the catalog as it reads right now", async () => {
    listVaultsMock.fn.mockResolvedValue([{ slot: "kc:lyth:aaaa:v1" }]);
    invokeMock.fn.mockResolvedValue({ outcome: "enumerated", accounts: [] });
    await findOrphanedSlots();
    expect(invokeMock.fn).toHaveBeenCalledWith("keychain_orphaned_slots", {
      catalogSlots: ["kc:lyth:aaaa:v1"],
    });
  });

  it("refuses to answer when the CATALOG cannot be read", async () => {
    // The torn-write case. An unreadable catalog is not an empty catalog:
    // treating it as empty would report every real vault as an orphan, which
    // is a different false statement but a false statement all the same.
    listVaultsMock.fn.mockRejectedValue(new Error("corrupt"));
    const scan = await findOrphanedSlots();
    expect(
      scan.outcome,
      "an unreadable catalog was treated as an empty one",
    ).toBe("unavailable");
    expect(invokeMock.fn, "the store was queried against a catalog that failed to load").
      not.toHaveBeenCalled();
  });

  it("turns a thrown enumeration into `unavailable`, never an empty list", async () => {
    listVaultsMock.fn.mockResolvedValue([]);
    invokeMock.fn.mockRejectedValue(new Error("denied"));
    expect((await findOrphanedSlots()).outcome).toBe("unavailable");
  });
});
