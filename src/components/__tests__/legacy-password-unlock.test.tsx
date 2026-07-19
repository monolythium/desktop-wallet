// S1 — the creation policy must never reach the unlock path.
//
// Raising the floor to 15 code points and deleting the composition rules
// changes what a NEW password may be. It cannot be allowed to change what an
// EXISTING password is allowed to be. Every vault already on disk was created
// under the old 12-character policy, and a user who cannot get in has no way to
// change the password that would let them.
//
// Applying `isPasswordValid` at a verify surface would therefore not "enforce a
// policy" — it would permanently brick every wallet created before this change,
// with the recovery phrase as the only way back. There is no error message that
// makes that acceptable, so the boundary is tested rather than assumed.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const fetchAndUnlockVault = vi.hoisted(() => vi.fn(async () => new Uint8Array(32)));
const getActiveAccount = vi.hoisted(() => vi.fn(() => "primary"));
const unlock = vi.hoisted(() => vi.fn());
const recordWrongUnlockAttempt = vi.hoisted(() => vi.fn(() => ({ lockoutUntil: 0 })));
const readLockoutState = vi.hoisted(() => vi.fn(() => ({ lockoutUntil: 0, failCount: 0 })));
const resetWalletOnThisDevice = vi.hoisted(() => vi.fn(async () => {}));
const resetPhraseProofMatches = vi.hoisted(() => vi.fn(() => true));
const resetConfirmMatches = vi.hoisted(() => vi.fn((s: string) => s === "RESET"));

vi.mock("../../sdk/keychain", () => ({
  fetchAndUnlockVault,
  getActiveAccount,
  KeychainCallError: class KeychainCallError extends Error {},
}));
vi.mock("../../sdk/vault", () => ({ isWrongPasswordFailure: () => true }));
vi.mock("../../sdk/auto-lock", () => ({ useAutoLock: () => ({ unlock }) }));
vi.mock("../../sdk/active-wallet", () => ({
  loadActiveWallet: async () => ({ status: "ready", addressHex: "0xabc" }),
}));
vi.mock("../../sdk/reset", () => ({
  resetWalletOnThisDevice,
  resetPhraseProofMatches,
  resetConfirmMatches,
  NON_CUSTODIAL_RESET_NOTE:
    "Monolythium is non-custodial: no one — including Monolythium — can recover your wallet, password, or funds for you.",
}));
vi.mock("../../sdk/unlock-lockout", () => ({
  readLockoutState,
  recordWrongUnlockAttempt,
  lockoutRemainingMs: (until: number, now: number) => Math.max(0, until - now),
}));

import { UnlockGate } from "../UnlockGate";
import { isPasswordValid } from "../../lib/password-validation";

/** A password a real user created under the OLD 12-char + composition policy. */
const LEGACY_PASSWORD = "Abcdefghijk1!";

beforeEach(() => {
  vi.clearAllMocks();
  readLockoutState.mockReturnValue({ lockoutUntil: 0, failCount: 0 });
  resetPhraseProofMatches.mockReturnValue(true);
  fetchAndUnlockVault.mockResolvedValue(new Uint8Array(32));
});

async function typeAndSubmit(value: string) {
  const input = screen.getByLabelText(/password/i, { selector: "input" });
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    screen.getByRole("button", { name: /unlock/i }).click();
  });
}

describe("S1 — a legacy password still unlocks", () => {
  it("the new policy WOULD reject it (so the danger is real)", () => {
    // 13 characters: fine under the old rules, short under the new floor.
    expect(isPasswordValid(LEGACY_PASSWORD)).toBe(false);
  });

  it("passes it straight to the vault, unvalidated", async () => {
    render(<UnlockGate />);
    await typeAndSubmit(LEGACY_PASSWORD);

    expect(fetchAndUnlockVault).toHaveBeenCalledTimes(1);
    expect(fetchAndUnlockVault).toHaveBeenCalledWith("primary", LEGACY_PASSWORD);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it("passes an even shorter legacy password through", async () => {
    render(<UnlockGate />);
    await typeAndSubmit("Short1!");
    expect(fetchAndUnlockVault).toHaveBeenCalledWith("primary", "Short1!");
  });

  it("passes the exact bytes typed, including a trailing space", async () => {
    // Trimming here would silently change the secret and fail a valid unlock.
    render(<UnlockGate />);
    await typeAndSubmit("Abcdefghijk1! ");
    expect(fetchAndUnlockVault).toHaveBeenCalledWith("primary", "Abcdefghijk1! ");
  });

  it("the button is gated on emptiness only — never on the policy", async () => {
    render(<UnlockGate />);
    const button = screen.getByRole("button", { name: /unlock/i });
    // Empty: disabled.
    expect((button as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByLabelText(/password/i, { selector: "input" });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "x");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // One character — far below the floor — and the button is live.
    expect(
      (screen.getByRole("button", { name: /unlock/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("S1 — the policy module is imported only by creation surfaces", () => {
  it("no verify surface pulls in password-validation", async () => {
    // A structural net beside the behavioural test above: if a future edit wires
    // the policy into a verify surface, this catches it even if that surface has
    // no test of its own.
    const sources = import.meta.glob("../../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const VERIFY_SURFACES = [
      "UnlockGate.tsx",
      "OperationsDrawer.tsx",
    ];

    for (const [path, src] of Object.entries(sources)) {
      if (path.includes("__tests__")) continue;
      if (!VERIFY_SURFACES.some((f) => path.endsWith(f))) continue;
      // Exact import specifier, not a loose word match.
      expect(src, `${path} must not import the creation policy`).not.toContain(
        "lib/password-validation",
      );
    }
  });

  it("the scan actually looked at both verify surfaces", () => {
    // Guards against the loop above passing because it matched nothing.
    const sources = import.meta.glob("../../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const seen = Object.keys(sources).filter(
      (p) =>
        !p.includes("__tests__") &&
        (p.endsWith("UnlockGate.tsx") || p.endsWith("OperationsDrawer.tsx")),
    );
    expect(seen).toHaveLength(2);
  });
});

describe("G2 — the reset escape hatch survives an active lockout", () => {
  it("is reachable while a 30-minute window is running", async () => {
    // The forgot-password path never decrypts, and a password-lost user has no
    // other way back. A lockout that blocked it would be a permanent trap.
    readLockoutState.mockReturnValue({
      lockoutUntil: Date.now() + 30 * 60_000,
      failCount: 20,
    });
    render(<UnlockGate />);

    // The unlock control is locked out...
    expect(
      (screen.getByRole("button", { name: /locked/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/Too many wrong attempts/)).toBeTruthy();

    // ...but the escape hatch opens.
    const forgot = screen.getByRole("button", { name: /forgot your password/i });
    expect((forgot as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      forgot.click();
    });
    expect(screen.getByText(/We can't recover your password/)).toBeTruthy();
  });

  it("completes the reset while locked out", async () => {
    readLockoutState.mockReturnValue({
      lockoutUntil: Date.now() + 30 * 60_000,
      failCount: 20,
    });
    render(<UnlockGate />);
    await act(async () => {
      screen.getByRole("button", { name: /forgot your password/i }).click();
    });

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    const confirmInput = screen.getByPlaceholderText("RESET");
    await act(async () => {
      setter.call(confirmInput, "RESET");
      confirmInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const erase = screen.getByRole("button", { name: /erase wallet/i });
    expect((erase as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      erase.click();
    });
    expect(resetWalletOnThisDevice).toHaveBeenCalledTimes(1);
  });
});
