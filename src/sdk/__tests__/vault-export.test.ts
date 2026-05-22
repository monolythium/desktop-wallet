// vault-export — typed wrappers + error-normalization tests.

import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  VaultExportCallError,
  vaultExportBlob,
  vaultImportBlob,
} from "../vault-export";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("vault-export · wrappers", () => {
  it("export forwards camelCase args to the Rust command", async () => {
    invokeMock.mockResolvedValueOnce('{"type":"monolythium.vault.export.v1"}');
    const r = await vaultExportBlob({
      vaultId: "v-1",
      masterPassword: "master",
      exportPassword: "export",
    });
    expect(r).toMatch(/monolythium\.vault\.export\.v1/);
    expect(invokeMock).toHaveBeenCalledWith("vault_export_blob", {
      vaultId: "v-1",
      masterPassword: "master",
      exportPassword: "export",
    });
  });

  it("import forwards camelCase args + null label fallback", async () => {
    invokeMock.mockResolvedValueOnce("new-id");
    const r = await vaultImportBlob({
      envelopeText: "{...}",
      exportPassword: "x",
      masterPassword: "m",
    });
    expect(r).toBe("new-id");
    expect(invokeMock).toHaveBeenCalledWith("vault_import_blob", {
      envelopeText: "{...}",
      exportPassword: "x",
      masterPassword: "m",
      labelOverride: null,
    });
  });

  it("import passes label override through when supplied", async () => {
    invokeMock.mockResolvedValueOnce("new-id");
    await vaultImportBlob({
      envelopeText: "{}",
      exportPassword: "x",
      masterPassword: "m",
      labelOverride: "Renamed",
    });
    expect(invokeMock).toHaveBeenCalledWith("vault_import_blob", {
      envelopeText: "{}",
      exportPassword: "x",
      masterPassword: "m",
      labelOverride: "Renamed",
    });
  });

  it("flattens the Rust `vault` wrapper error shape", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "vault",
      "0": { code: "wrong_password", message: "wrong password" },
    });
    await expect(
      vaultExportBlob({ vaultId: "v", masterPassword: "x", exportPassword: "x" }),
    ).rejects.toBeInstanceOf(VaultExportCallError);

    invokeMock.mockRejectedValueOnce({
      code: "vault",
      "0": { code: "wrong_password", message: "wrong password" },
    });
    try {
      await vaultExportBlob({ vaultId: "v", masterPassword: "x", exportPassword: "x" });
    } catch (cause) {
      const err = cause as VaultExportCallError;
      expect(err.cause.code).toBe("wrong_password");
      expect(err.cause.message).toMatch(/wrong password/i);
    }
  });

  it("preserves invalid_envelope code for import failures", async () => {
    invokeMock.mockRejectedValueOnce({
      code: "invalid_envelope",
      message: "not valid JSON",
    });
    try {
      await vaultImportBlob({
        envelopeText: "garbage",
        exportPassword: "x",
        masterPassword: "x",
      });
      throw new Error("should have thrown");
    } catch (cause) {
      const err = cause as VaultExportCallError;
      expect(err.cause.code).toBe("invalid_envelope");
    }
  });
});
