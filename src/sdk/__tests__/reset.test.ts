import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the destructive Tauri-backed dependencies so the test exercises the
// orchestration (iterate slots → delete blob → drop catalog entry → reload)
// without touching a real keychain or reloading the test runner.
const deleteAccount = vi.fn();
const removeVaultFromCatalog = vi.fn();
const loadCatalog = vi.fn();
vi.mock("../keychain", () => ({ deleteAccount: (...a: unknown[]) => deleteAccount(...a) }));
vi.mock("../vaultCatalog", () => ({
  loadCatalog: (...a: unknown[]) => loadCatalog(...a),
  removeVaultFromCatalog: (...a: unknown[]) => removeVaultFromCatalog(...a),
  // The reset now also sweeps every store file, and the wipe reads each file
  // name from its owning module rather than restating it. No assertion here
  // changes — the mock just carries the export the real module gained.
  STORE_ID: "vaults",
}));

import {
  RESET_CONFIRM_WORD,
  resetConfirmMatches,
  resetWalletOnThisDevice,
} from "../reset";

describe("resetConfirmMatches", () => {
  it("matches the confirm word ignoring case and surrounding whitespace", () => {
    expect(RESET_CONFIRM_WORD).toBe("RESET");
    expect(resetConfirmMatches("RESET")).toBe(true);
    expect(resetConfirmMatches("  reset ")).toBe(true);
    expect(resetConfirmMatches("Reset")).toBe(true);
  });

  it("rejects anything else, so a wipe never fires on a partial/wrong word", () => {
    expect(resetConfirmMatches("")).toBe(false);
    expect(resetConfirmMatches("RESE")).toBe(false);
    expect(resetConfirmMatches("DELETE")).toBe(false);
    expect(resetConfirmMatches("reset wallet")).toBe(false);
  });
});

describe("resetWalletOnThisDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteAccount.mockResolvedValue(undefined);
    removeVaultFromCatalog.mockResolvedValue(undefined);
    vi.stubGlobal("location", { reload: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("wipes every catalog slot (blob then catalog entry) then reloads", async () => {
    loadCatalog.mockResolvedValue({ vaults: { "mono.0": {}, "mono.1": {} } });

    await resetWalletOnThisDevice();

    expect(deleteAccount.mock.calls).toEqual([["mono.0"], ["mono.1"]]);
    expect(removeVaultFromCatalog.mock.calls).toEqual([["mono.0"], ["mono.1"]]);
    expect((window.location.reload as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("still reloads (→ onboarding) when the catalog is empty or unreadable", async () => {
    loadCatalog.mockResolvedValue(null);

    await resetWalletOnThisDevice();

    expect(deleteAccount).not.toHaveBeenCalled();
    expect((window.location.reload as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
