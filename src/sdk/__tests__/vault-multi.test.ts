// Multi-vault TS bindings — error mapping + wire-shape normalization
// + every command's invoke surface.

import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  MultiVaultCallError,
  _vaultSummaryFromWireForTest,
  createVaultMulti,
  deleteVault,
  listVaults,
  lockVault,
  migrateLegacyVault,
  renameVault,
  selectVault,
  unlockVaultMulti,
} from "../vault-multi";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("vault-multi · _vaultSummaryFromWire", () => {
  it("maps snake_case wire fields into camelCase", () => {
    const out = _vaultSummaryFromWireForTest({
      id: "abc",
      label: "P",
      address: "0xaaaa",
      created_at: 1000,
      is_active: true,
    });
    expect(out).toEqual({
      id: "abc",
      label: "P",
      address: "0xaaaa",
      createdAt: 1000,
      isActive: true,
    });
  });
});

describe("vault-multi · listVaults", () => {
  it("maps wire summaries into camelCase", async () => {
    invokeMock.mockResolvedValueOnce([
      { id: "1", label: "P", address: "0xa", created_at: 100, is_active: true },
      { id: "2", label: "W", address: "0xb", created_at: 200, is_active: false },
    ]);
    const out = await listVaults();
    expect(out).toHaveLength(2);
    expect(out[0]?.label).toBe("P");
    expect(out[0]?.isActive).toBe(true);
    expect(out[1]?.createdAt).toBe(200);
    expect(invokeMock).toHaveBeenCalledWith("vaults_list");
  });

  it("wraps backend errors as MultiVaultCallError", async () => {
    invokeMock.mockRejectedValueOnce({ code: "backend", message: "io failure" });
    try {
      await listVaults();
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(MultiVaultCallError);
      expect((cause as MultiVaultCallError).cause.code).toBe("backend");
    }
  });
});

describe("vault-multi · selectVault", () => {
  it("passes camelCased vaultId to the Tauri command", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "1",
      label: "P",
      address: "0xa",
      created_at: 100,
      is_active: true,
    });
    await selectVault("1");
    expect(invokeMock).toHaveBeenCalledWith("vault_select", { vaultId: "1" });
  });

  it("surfaces a not_found error with the missing id", async () => {
    invokeMock.mockRejectedValueOnce({ code: "not_found", id: "missing" });
    try {
      await selectVault("missing");
      expect.unreachable();
    } catch (cause) {
      const err = cause as MultiVaultCallError;
      expect(err.cause.code).toBe("not_found");
      expect((err.cause as { id: string }).id).toBe("missing");
    }
  });
});

describe("vault-multi · unlockVaultMulti", () => {
  it("rejects empty password locally without calling invoke", async () => {
    try {
      await unlockVaultMulti("");
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(MultiVaultCallError);
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns the active vault on success", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "1",
      label: "P",
      address: "0xa",
      created_at: 100,
      is_active: true,
    });
    const out = await unlockVaultMulti("hunter2");
    expect(out.isActive).toBe(true);
  });

  it("maps wrong_password from Rust", async () => {
    invokeMock.mockRejectedValueOnce({ code: "wrong_password" });
    try {
      await unlockVaultMulti("bad");
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("wrong_password");
    }
  });
});

describe("vault-multi · lockVault", () => {
  it("invokes vault_lock with no args", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await lockVault();
    expect(invokeMock).toHaveBeenCalledWith("vault_lock");
  });
});

describe("vault-multi · createVaultMulti", () => {
  it("rejects bad inputs locally", async () => {
    try {
      await createVaultMulti({
        label: "",
        password: "x",
        seed: new Uint8Array(32),
        address: "0xa",
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects seed of wrong length", async () => {
    try {
      await createVaultMulti({
        label: "P",
        password: "p",
        seed: new Uint8Array(16),
        address: "0xa",
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
  });

  it("passes a 32-byte seed as an Array<number> via invoke", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "1",
      label: "P",
      address: "0xa",
      created_at: 100,
      is_active: true,
    });
    const seed = new Uint8Array(32);
    seed[0] = 0xab;
    seed[31] = 0xcd;
    await createVaultMulti({ label: "P", password: "p", seed, address: "0xa" });
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_create_multi",
      expect.objectContaining({
        label: "P",
        password: "p",
        address: "0xa",
        seed: expect.arrayContaining([0xab, 0xcd]),
      }),
    );
    const passedSeed = (invokeMock.mock.calls[0]?.[1] as { seed: number[] }).seed;
    expect(passedSeed).toHaveLength(32);
  });
});

describe("vault-multi · renameVault", () => {
  it("rejects empty label locally", async () => {
    try {
      await renameVault("1", "");
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes vault_rename with camelCased args", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await renameVault("1", "New");
    expect(invokeMock).toHaveBeenCalledWith("vault_rename", {
      vaultId: "1",
      newLabel: "New",
    });
  });
});

describe("vault-multi · deleteVault", () => {
  it("invokes vault_delete with vaultId + confirmToken", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await deleteVault("1", "abcd");
    expect(invokeMock).toHaveBeenCalledWith("vault_delete", {
      vaultId: "1",
      confirmToken: "abcd",
    });
  });

  it("maps invalid_argument when token mismatch is signaled", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "invalid_argument",
      message: "confirmation token does not match",
    });
    try {
      await deleteVault("1", "wrong");
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
  });
});

describe("vault-multi · migrateLegacyVault", () => {
  it("rejects wrong-length seed locally", async () => {
    try {
      await migrateLegacyVault({
        seed: new Uint8Array(16),
        password: "hunter2",
        label: "Primary",
        address: "0xaaaa",
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects empty password locally", async () => {
    try {
      await migrateLegacyVault({
        seed: new Uint8Array(32),
        password: "",
        label: "P",
        address: "0xa",
      });
      expect.unreachable();
    } catch (cause) {
      expect((cause as MultiVaultCallError).cause.code).toBe("invalid_argument");
    }
  });

  it("invokes vault_migrate_legacy with the right args", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "new",
      label: "Primary",
      address: "0xaaaa",
      created_at: 1000,
      is_active: true,
    });
    const seed = new Uint8Array(32);
    seed[0] = 0xab;
    const out = await migrateLegacyVault({
      seed,
      password: "hunter2",
      label: "Primary",
      address: "0xaaaa",
    });
    expect(out.id).toBe("new");
    expect(invokeMock).toHaveBeenCalledWith(
      "vault_migrate_legacy",
      expect.objectContaining({
        password: "hunter2",
        label: "Primary",
        address: "0xaaaa",
        seed: expect.any(Array),
      }),
    );
  });
});

describe("vault-multi · error fallback", () => {
  it("wraps a non-shaped string error as backend", async () => {
    invokeMock.mockRejectedValueOnce("Some IPC string");
    try {
      await listVaults();
      expect.unreachable();
    } catch (cause) {
      const e = cause as MultiVaultCallError;
      expect(e.cause.code).toBe("backend");
      expect((e.cause as { message: string }).message).toBe("Some IPC string");
    }
  });
});
