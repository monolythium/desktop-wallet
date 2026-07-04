import { describe, expect, it, vi } from "vitest";

// vault.ts imports the Tauri invoke boundary at module load; stub it so this
// pure-logic test never touches a real IPC channel. isWrongPasswordFailure
// itself invokes nothing.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { VaultCallError, isWrongPasswordFailure } from "../vault";

describe("isWrongPasswordFailure — brute-force-lockout discriminator", () => {
  it("is true only for a wrong-password vault error", () => {
    expect(isWrongPasswordFailure(new VaultCallError({ code: "wrong_password" }))).toBe(true);
  });

  it("is false for operational vault errors (must not escalate the lockout)", () => {
    expect(
      isWrongPasswordFailure(new VaultCallError({ code: "backend", message: "keyring down" })),
    ).toBe(false);
    expect(
      isWrongPasswordFailure(
        new VaultCallError({ code: "invalid_argument", message: "empty password" }),
      ),
    ).toBe(false);
  });

  it("is false for non-vault failures", () => {
    expect(isWrongPasswordFailure(new Error("boom"))).toBe(false);
    expect(isWrongPasswordFailure({ code: "wrong_password" })).toBe(false);
    expect(isWrongPasswordFailure(null)).toBe(false);
    expect(isWrongPasswordFailure(undefined)).toBe(false);
  });
});
