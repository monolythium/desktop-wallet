import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock only the Tauri boundary; the SDK crypto is real (deterministic) so the
// payload<->phrase round-trip is genuinely exercised.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import { generateMnemonic } from "@monolythium/core-sdk/crypto";
import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  createAndStoreVault,
  fetchAndUnlockVault,
  revealRecoveryPhrase,
} from "../keychain";

beforeEach(() => {
  invoke.mockReset();
});

describe("createAndStoreVault seals a v2 vault with the recovery payload", () => {
  it("passes the seed and the matching 32-byte BIP-39 entropy to vault_seal_v2", async () => {
    const mnemonic = generateMnemonic();
    const expectedPayload = Array.from(mnemonicToEntropy(mnemonic, wordlist));

    const calls: Record<string, any> = {};
    invoke.mockImplementation(async (cmd: string, args: unknown) => {
      calls[cmd] = args;
      if (cmd === "vault_seal_v2") return [10, 20, 30]; // opaque blob bytes
      if (cmd === "keychain_store") return undefined;
      throw new Error(`unexpected command: ${cmd}`);
    });

    const out = await createAndStoreVault("kc:test:v1", "pw-correct", {
      importMnemonic: mnemonic,
    });

    expect(out.mnemonic).toBe(mnemonic);
    expect(out.addressHex).toMatch(/^0x[0-9a-f]{40}$/);

    const sealArgs = calls["vault_seal_v2"];
    expect(sealArgs.password).toBe("pw-correct");
    expect(sealArgs.seedBytes).toHaveLength(32);
    expect(sealArgs.payloadBytes).toHaveLength(32);
    expect(sealArgs.payloadBytes).toEqual(expectedPayload);

    // The blob returned by vault_seal_v2 is what gets persisted.
    expect(calls["keychain_store"].account).toBe("kc:test:v1");
    expect(calls["keychain_store"].secret).toEqual([10, 20, 30]);
  });
});

describe("fetchAndUnlockVault keeps the signing contract", () => {
  it("returns the raw 32-byte seed for a v2 blob (unchanged)", async () => {
    const fakeSeed = Array.from({ length: 32 }, (_, i) => i);
    invoke.mockImplementation(async (cmd: string, args: any) => {
      if (cmd === "keychain_unlock") return [9, 9, 9];
      if (cmd === "vault_unlock") {
        expect(args.blobBytes).toEqual([9, 9, 9]);
        return fakeSeed;
      }
      throw new Error(`unexpected command: ${cmd}`);
    });

    const seed = await fetchAndUnlockVault("kc:test:v1", "pw");
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed).toHaveLength(32);
    expect(Array.from(seed)).toEqual(fakeSeed);
  });
});

describe("revealRecoveryPhrase", () => {
  it("maps a returned payload back to the exact 24-word phrase", async () => {
    const mnemonic = generateMnemonic();
    const payload = Array.from(mnemonicToEntropy(mnemonic, wordlist));
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "keychain_unlock") return [1, 2, 3];
      if (cmd === "vault_reveal") return { kind: "payload", payload };
      throw new Error(`unexpected command: ${cmd}`);
    });

    const out = await revealRecoveryPhrase("kc:test:v1", "pw");
    expect(out.revealable).toBe(true);
    // Round-trip: the BIP-39 entropy re-encodes to the original phrase.
    expect(out.mnemonic).toBe(mnemonic);
  });

  it("reports not-revealable for a seed-only vault (no fabricated phrase)", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "keychain_unlock") return [1, 2, 3];
      if (cmd === "vault_reveal") return { kind: "no_recovery_material" };
      throw new Error(`unexpected command: ${cmd}`);
    });

    const out = await revealRecoveryPhrase("kc:test:v1", "pw");
    expect(out.revealable).toBe(false);
    expect(out.mnemonic).toBeUndefined();
  });

  it("sanity: BIP-39 entropy re-encodes to the same phrase", () => {
    const mnemonic = generateMnemonic();
    const payload = mnemonicToEntropy(mnemonic, wordlist);
    expect(entropyToMnemonic(payload, wordlist)).toBe(mnemonic);
  });
});
