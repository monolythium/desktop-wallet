// The default-deny local wipe.
//
// A reset promises the device is clean. Before this, it deleted the vaults and
// left everything else: contacts, who this wallet had paid, resolved
// counterparty names, transaction history, network configuration. "The wallet is
// gone" and "the wallet is gone but the next person can read who you paid" are
// different promises, and only one of them was being kept.
//
// The store list is the fragile part and the reason this file exists. Store
// files are not prefixed keys, so nothing enumerates them — each must be named,
// and a store that is not named survives. The specification this implements
// listed four when ten existed.

import { describe, expect, it, vi, beforeEach } from "vitest";

const clear = vi.hoisted(() => vi.fn(async () => {}));
const save = vi.hoisted(() => vi.fn(async () => {}));
const load = vi.hoisted(() => vi.fn(async (_file: string) => ({ clear, save })));

vi.mock("../wallet-store", () => ({ WalletStore: { load } }));

import {
  STORE_IDS,
  WIPE_EXCEPT_KEYS,
  walletKeysToWipe,
  wipeAllLocalWalletState,
} from "../wipe-local-state";
import { STORAGE_KEY_UPDATE_CHECK } from "../update-check";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  load.mockImplementation(async (_file: string) => ({ clear, save }));
});

describe("W1 — every store is registered", () => {
  // The list now holds store IDENTIFIERS rather than file names: the frontend
  // no longer names a path, and Rust owns the identifier-to-file mapping (a
  // Rust test pins that each identifier still resolves to the file already on
  // disk). What this file guards is unchanged — a store absent from the list
  // survives a reset — so every assertion below is the same assertion against
  // the new vocabulary.
  it("names all ten stores", () => {
    expect(STORE_IDS).toHaveLength(10);
  });

  it("includes the five a literal reading of the spec would have missed", () => {
    // Each holds something a user would not want left behind.
    expect(STORE_IDS).toContain("sent-recipients"); // who was paid
    expect(STORE_IDS).toContain("names"); // counterparty identities
    expect(STORE_IDS).toContain("pending-tx"); // transaction history
    expect(STORE_IDS).toContain("balance"); // last-known balances
    expect(STORE_IDS).toContain("agents"); // agent sub-vaults
  });

  it("includes the four the spec did name", () => {
    expect(STORE_IDS).toContain("addressbook");
    expect(STORE_IDS).toContain("notifications");
    expect(STORE_IDS).toContain("activity");
    expect(STORE_IDS).toContain("chain-health");
  });

  it("includes the vault catalog", () => {
    expect(STORE_IDS).toContain("vaults");
  });

  it("registers each store exactly once", () => {
    expect(new Set(STORE_IDS).size).toBe(STORE_IDS.length);
  });

  it("clears every registered store", async () => {
    const out = await wipeAllLocalWalletState();
    expect(load).toHaveBeenCalledTimes(STORE_IDS.length);
    for (const id of STORE_IDS) {
      expect(load).toHaveBeenCalledWith(id);
    }
    expect(clear).toHaveBeenCalledTimes(STORE_IDS.length);
    expect(save).toHaveBeenCalledTimes(STORE_IDS.length);
    expect(out.storesCleared).toBe(STORE_IDS.length);
    expect(out.storesFailed).toEqual([]);
  });

});

describe("the localStorage sweep", () => {
  it("removes wallet-owned keys and keeps foreign ones", () => {
    const keys = [
      "wallet.route",
      "wallet.rpcEndpoint",
      "wallet.myNames.mono1abc",
      "wallet.nameNudge.mono1abc",
      "some-other-app.setting",
      "unprefixed",
    ];
    expect(walletKeysToWipe(keys)).toEqual([
      "wallet.route",
      "wallet.rpcEndpoint",
      "wallet.myNames.mono1abc",
      "wallet.nameNudge.mono1abc",
    ]);
  });

  it("catches key families nobody remembered to list", () => {
    // The whole point of sweeping by prefix rather than by enumeration.
    const future = ["wallet.somethingInventedNextYear.v3"];
    expect(walletKeysToWipe(future)).toEqual(future);
  });

  it("G5 — the update-check cache is swept, and is not an exception", () => {
    // The first key added since the wipe shipped, so it is the first real test
    // of the register-or-it-survives discipline. It is device state, not a
    // display preference: a reset should clear it, at the cost of one extra
    // update check on the next launch.
    expect(walletKeysToWipe([STORAGE_KEY_UPDATE_CHECK])).toEqual([
      STORAGE_KEY_UPDATE_CHECK,
    ]);
    expect(WIPE_EXCEPT_KEYS).not.toContain(STORAGE_KEY_UPDATE_CHECK);
  });

  it("keeps the display preferences", () => {
    expect(walletKeysToWipe([...WIPE_EXCEPT_KEYS])).toEqual([]);
  });

  it("W3 — language and currency survive alongside theme, layout and rail", () => {
    // Same pre-wallet Welcome panel, same absence of identity linkage. Keeping
    // the palette while dropping the language would be an arbitrary split.
    expect(WIPE_EXCEPT_KEYS).toContain("wallet.theme");
    expect(WIPE_EXCEPT_KEYS).toContain("wallet.layout");
    expect(WIPE_EXCEPT_KEYS).toContain("wallet.sidebarCollapsed");
    expect(WIPE_EXCEPT_KEYS).toContain("wallet.language");
    expect(WIPE_EXCEPT_KEYS).toContain("wallet.displayCurrency");
    expect(WIPE_EXCEPT_KEYS).toHaveLength(5);
  });

  it("sweeps the real store end to end", async () => {
    localStorage.setItem("wallet.route", "home");
    localStorage.setItem("wallet.rpcEndpoint", "https://op");
    localStorage.setItem("wallet.developerMode", "true");
    localStorage.setItem("wallet.chains.user", "[]");
    localStorage.setItem("wallet.myNames.mono1abc", "[]");
    localStorage.setItem("wallet.theme", "dusk");
    localStorage.setItem("wallet.language", "en");
    localStorage.setItem("wallet.displayCurrency", "EUR");
    localStorage.setItem("other.app", "keep");

    const out = await wipeAllLocalWalletState();

    expect(localStorage.getItem("wallet.route")).toBeNull();
    expect(localStorage.getItem("wallet.rpcEndpoint")).toBeNull();
    expect(localStorage.getItem("wallet.developerMode")).toBeNull();
    expect(localStorage.getItem("wallet.chains.user")).toBeNull();
    expect(localStorage.getItem("wallet.myNames.mono1abc")).toBeNull();
    // Survivors.
    expect(localStorage.getItem("wallet.theme")).toBe("dusk");
    expect(localStorage.getItem("wallet.language")).toBe("en");
    expect(localStorage.getItem("wallet.displayCurrency")).toBe("EUR");
    expect(localStorage.getItem("other.app")).toBe("keep");
    expect(out.keysRemoved).toBe(5);
  });

  it("removes every wallet key even when they outnumber the survivors", async () => {
    // Guards the collect-then-delete ordering: removing while enumerating
    // reindexes localStorage and skips keys.
    for (let i = 0; i < 20; i++) localStorage.setItem(`wallet.k${i}`, "v");
    localStorage.setItem("wallet.theme", "dusk");

    await wipeAllLocalWalletState();

    for (let i = 0; i < 20; i++) {
      expect(localStorage.getItem(`wallet.k${i}`)).toBeNull();
    }
    expect(localStorage.getItem("wallet.theme")).toBe("dusk");
  });
});

describe("G4 — one failing store does not stop the rest", () => {
  it("keeps clearing after a store throws on load", async () => {
    const failing = STORE_IDS[3]!;
    load.mockImplementation(async (file: string) => {
      if (file === failing) throw new Error("store unavailable");
      return { clear, save };
    });

    const out = await wipeAllLocalWalletState();

    expect(out.storesFailed).toEqual([failing]);
    expect(out.storesCleared).toBe(STORE_IDS.length - 1);
    // Every other store was still attempted.
    expect(load).toHaveBeenCalledTimes(STORE_IDS.length);
  });

  it("keeps going when a store throws on clear", async () => {
    const failing = STORE_IDS[0]!;
    load.mockImplementation(async (file: string) => ({
      clear:
        file === failing
          ? vi.fn(async () => {
              throw new Error("clear failed");
            })
          : clear,
      save,
    }));

    const out = await wipeAllLocalWalletState();
    expect(out.storesFailed).toEqual([failing]);
    expect(out.storesCleared).toBe(STORE_IDS.length - 1);
  });

  it("still sweeps localStorage after a store failure", async () => {
    // The failure must not cost the second half of the wipe.
    load.mockImplementation(async (file: string) => {
      if (file === STORE_IDS[0]) throw new Error("nope");
      return { clear, save };
    });
    localStorage.setItem("wallet.route", "home");

    const out = await wipeAllLocalWalletState();
    expect(localStorage.getItem("wallet.route")).toBeNull();
    expect(out.keysRemoved).toBe(1);
  });

  it("never throws, whatever fails", async () => {
    load.mockImplementation(async () => {
      throw new Error("everything is broken");
    });
    await expect(wipeAllLocalWalletState()).resolves.toEqual({
      storesCleared: 0,
      storesFailed: [...STORE_IDS],
      keysRemoved: 0,
    });
  });
});
