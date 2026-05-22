// Phase 8 SLH-DSA backup TS bindings — error mapping + wire-shape
// mapping + BIP-39 helpers + command surface + hook.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  _statusFromWireForTest,
  backupMnemonicToEntropy,
  entropyToBackupMnemonic,
  slhActivateRecovery,
  slhEnrollBackup,
  slhGetBackupStatus,
  slhRemoveBackup,
  slhTestRecovery,
  SlhCallError,
  useSlhBackup,
} from "../slh-backup";

beforeEach(() => {
  invokeMock.mockReset();
});

// ─── Wire-shape mapping ──────────────────────────────────────────────

describe("slh-backup · status wire mapping", () => {
  it("maps not_enrolled", () => {
    expect(_statusFromWireForTest({ kind: "not_enrolled" })).toEqual({
      kind: "not_enrolled",
    });
  });

  it("maps enrolled with created_at", () => {
    expect(
      _statusFromWireForTest({ kind: "enrolled", created_at: 100 }),
    ).toEqual({ kind: "enrolled", createdAt: 100 });
  });

  it("maps activated with both timestamps", () => {
    expect(
      _statusFromWireForTest({
        kind: "activated",
        created_at: 100,
        activated_at: 200,
      }),
    ).toEqual({ kind: "activated", createdAt: 100, activatedAt: 200 });
  });
});

// ─── BIP-39 helpers ──────────────────────────────────────────────────

describe("slh-backup · BIP-39 helpers", () => {
  it("entropyToBackupMnemonic produces a 24-word phrase", () => {
    const ent = new Uint8Array(32);
    for (let i = 0; i < 32; i++) ent[i] = i;
    const m = entropyToBackupMnemonic(ent);
    expect(m.split(" ")).toHaveLength(24);
  });

  it("entropyToBackupMnemonic rejects non-32-byte entropy", () => {
    expect(() => entropyToBackupMnemonic(new Uint8Array(16))).toThrow(
      SlhCallError,
    );
  });

  it("backupMnemonicToEntropy is the inverse of entropyToBackupMnemonic", () => {
    const ent = new Uint8Array(32);
    for (let i = 0; i < 32; i++) ent[i] = (i * 7 + 3) & 0xff;
    const m = entropyToBackupMnemonic(ent);
    const decoded = backupMnemonicToEntropy(m);
    expect(Array.from(decoded)).toEqual(Array.from(ent));
  });

  it("backupMnemonicToEntropy throws malformed on bad input", () => {
    try {
      backupMnemonicToEntropy("not a valid mnemonic at all");
      expect.unreachable();
    } catch (cause) {
      expect((cause as SlhCallError).cause.code).toBe("malformed");
    }
  });
});

// ─── Command wrappers ───────────────────────────────────────────────

describe("slh-backup · slhGetBackupStatus", () => {
  it("invokes the command and maps the response", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "enrolled",
      created_at: 100,
    });
    const out = await slhGetBackupStatus("v1");
    expect(invokeMock).toHaveBeenCalledWith("slh_get_backup_status", {
      vaultId: "v1",
    });
    expect(out).toEqual({ kind: "enrolled", createdAt: 100 });
  });

  it("wraps errors", async () => {
    invokeMock.mockRejectedValueOnce({ code: "vault_not_found", id: "x" });
    try {
      await slhGetBackupStatus("x");
      expect.unreachable();
    } catch (cause) {
      expect((cause as SlhCallError).cause.code).toBe("vault_not_found");
    }
  });
});

describe("slh-backup · slhEnrollBackup", () => {
  it("rejects weak passwords client-side before invoke", async () => {
    try {
      await slhEnrollBackup({ vaultId: "v1", recoveryPassword: "short" });
      expect.unreachable();
    } catch (cause) {
      expect((cause as SlhCallError).cause.code).toBe(
        "recovery_password_too_weak",
      );
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes the command and turns entropy into a 24-word mnemonic", async () => {
    // 32 zero bytes encoded as base64url-no-pad.
    const entropy = new Uint8Array(32);
    let bin = "";
    for (let i = 0; i < entropy.length; i++) bin += String.fromCharCode(entropy[i]!);
    const entropyB64 = btoa(bin)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    invokeMock.mockResolvedValueOnce({
      entropy_b64: entropyB64,
      public_key_b64: "pub",
      created_at: 100,
    });
    const out = await slhEnrollBackup({
      vaultId: "v1",
      recoveryPassword: "strong-recovery-pw",
    });
    expect(invokeMock).toHaveBeenCalledWith("slh_enroll_backup", {
      vaultId: "v1",
      recoveryPassword: "strong-recovery-pw",
    });
    expect(out.mnemonic.split(" ")).toHaveLength(24);
    expect(out.publicKey).toBe("pub");
    expect(out.createdAt).toBe(100);
  });
});

describe("slh-backup · slhTestRecovery", () => {
  it("returns false on bad mnemonic without invoking", async () => {
    const ok = await slhTestRecovery({
      vaultId: "v1",
      recoveryPassword: "x",
      mnemonic: "garbage words here invalid",
    });
    expect(ok).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes the command with the entropy bytes derived from the mnemonic", async () => {
    const ent = new Uint8Array(32);
    for (let i = 0; i < 32; i++) ent[i] = i;
    const m = entropyToBackupMnemonic(ent);
    invokeMock.mockResolvedValueOnce(true);
    const ok = await slhTestRecovery({
      vaultId: "v1",
      recoveryPassword: "pw",
      mnemonic: m,
    });
    expect(ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      "slh_test_recovery",
      expect.objectContaining({
        vaultId: "v1",
        recoveryPassword: "pw",
      }),
    );
  });
});

describe("slh-backup · slhActivateRecovery", () => {
  it("returns activated status on success", async () => {
    const ent = new Uint8Array(32);
    for (let i = 0; i < 32; i++) ent[i] = i;
    const m = entropyToBackupMnemonic(ent);
    invokeMock.mockResolvedValueOnce({
      kind: "activated",
      created_at: 100,
      activated_at: 200,
    });
    const out = await slhActivateRecovery({
      vaultId: "v1",
      recoveryPassword: "strong-recovery-pw",
      mnemonic: m,
    });
    expect(out).toEqual({
      kind: "activated",
      createdAt: 100,
      activatedAt: 200,
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "slh_activate_recovery",
      expect.objectContaining({
        vaultId: "v1",
        recoveryPassword: "strong-recovery-pw",
      }),
    );
  });

  it("throws malformed for invalid mnemonic", async () => {
    try {
      await slhActivateRecovery({
        vaultId: "v1",
        recoveryPassword: "pw",
        mnemonic: "not real bip39 phrase",
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as SlhCallError).cause.code).toBe("malformed");
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("surfaces wrong_recovery_password typed", async () => {
    const ent = new Uint8Array(32);
    for (let i = 0; i < 32; i++) ent[i] = i;
    const m = entropyToBackupMnemonic(ent);
    invokeMock.mockRejectedValueOnce({ code: "wrong_recovery_password" });
    try {
      await slhActivateRecovery({
        vaultId: "v1",
        recoveryPassword: "wrong",
        mnemonic: m,
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as SlhCallError).cause.code).toBe(
        "wrong_recovery_password",
      );
    }
  });
});

describe("slh-backup · slhRemoveBackup", () => {
  it("invokes the command with both passwords", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await slhRemoveBackup({
      vaultId: "v1",
      masterPassword: "mp",
      recoveryPassword: "rp",
    });
    expect(invokeMock).toHaveBeenCalledWith("slh_remove_backup", {
      vaultId: "v1",
      masterPassword: "mp",
      recoveryPassword: "rp",
    });
  });

  it("surfaces wrong_master_password typed", async () => {
    invokeMock.mockRejectedValueOnce({ code: "wrong_master_password" });
    try {
      await slhRemoveBackup({
        vaultId: "v1",
        masterPassword: "wrong",
        recoveryPassword: "rp",
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as SlhCallError).cause.code).toBe(
        "wrong_master_password",
      );
    }
  });
});

// ─── Hook ──────────────────────────────────────────────────────────

describe("useSlhBackup hook", () => {
  it("loads the status for the given vault", async () => {
    invokeMock.mockResolvedValueOnce({
      kind: "enrolled",
      created_at: 100,
    });
    const { result } = renderHook(() => useSlhBackup("v1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.backup).toEqual({
      kind: "enrolled",
      createdAt: 100,
    });
  });

  it("returns idle + not_enrolled when vaultId is null", async () => {
    const { result } = renderHook(() => useSlhBackup(null));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.backup).toEqual({ kind: "not_enrolled" });
  });

  it("surfaces errors via the api", async () => {
    invokeMock.mockRejectedValueOnce({ code: "vault_locked" });
    const { result } = renderHook(() => useSlhBackup("v1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.cause.code).toBe("vault_locked");
  });

  it("refreshes after enroll", async () => {
    // Initial: not_enrolled.
    invokeMock.mockResolvedValueOnce({ kind: "not_enrolled" });
    const { result } = renderHook(() => useSlhBackup("v1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Enroll resolves to entropy + pubkey.
    const ent = new Uint8Array(32);
    let bin = "";
    for (let i = 0; i < ent.length; i++) bin += String.fromCharCode(ent[i]!);
    const entB64 = btoa(bin)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    invokeMock.mockResolvedValueOnce({
      entropy_b64: entB64,
      public_key_b64: "pub",
      created_at: 200,
    });
    // refresh after enroll returns enrolled status.
    invokeMock.mockResolvedValueOnce({
      kind: "enrolled",
      created_at: 200,
    });
    await act(async () => {
      const r = await result.current.enroll("strong-recovery-pw");
      expect(r.publicKey).toBe("pub");
    });
    expect(result.current.backup).toEqual({
      kind: "enrolled",
      createdAt: 200,
    });
  });
});
