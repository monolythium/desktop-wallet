import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/renderWithProviders";
import type { OperationDescriptor, OperationResult } from "../types";

// Keychain unlock is the only Tauri touch on the auth path — stub it so we can
// drive success / wrong-password / never-resolving-execute without a real vault.
const kc = vi.hoisted(() => ({
  fetchAndUnlockVault: vi.fn(),
  getActiveAccount: vi.fn(() => "slot-1"),
}));
vi.mock("../../sdk/keychain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sdk/keychain")>()),
  fetchAndUnlockVault: kc.fetchAndUnlockVault,
  getActiveAccount: kc.getActiveAccount,
}));
// The address backfill after unlock hits the tauri store — no-op it.
vi.mock("../../sdk/vaultCatalog", () => ({ captureAddressOnUnlock: vi.fn(() => Promise.resolve()) }));

// The shared brute-force lockout — mock it so we can prove the drawer routes
// through the SAME counter the lock gate uses (parity), and honors an existing
// lockout as a hard gate.
const lockout = vi.hoisted(() => ({
  readLockoutState: vi.fn(() => ({ failCount: 0, lockoutUntil: 0 })),
  recordWrongUnlockAttempt: vi.fn(() => ({ failCount: 1, lockoutUntil: 0 })),
  clearUnlockLockout: vi.fn(),
  lockoutRemainingMs: vi.fn((until: number, now: number) => Math.max(0, until - now)),
}));
vi.mock("../../sdk/unlock-lockout", () => lockout);

import { VaultCallError } from "../../sdk/vault";
import { OperationsDrawer } from "../OperationsDrawer";

function keychainOp(execute: OperationDescriptor["execute"]): OperationDescriptor {
  return { title: "Send 1 LYTH", diff: [{ k: "Amount", v: "1 LYTH" }], effects: [], auth: "keychain", execute };
}
function readOp(execute: OperationDescriptor["execute"]): OperationDescriptor {
  return { title: "Read", diff: [], effects: [], auth: "none", execute };
}
function passwordInput(): HTMLElement {
  return screen.getByLabelText("Password");
}

beforeEach(() => {
  kc.fetchAndUnlockVault.mockReset();
  kc.getActiveAccount.mockReturnValue("slot-1");
  lockout.readLockoutState.mockReturnValue({ failCount: 0, lockoutUntil: 0 });
  lockout.recordWrongUnlockAttempt.mockReturnValue({ failCount: 1, lockoutUntil: 0 });
  lockout.clearUnlockLockout.mockClear();
  lockout.lockoutRemainingMs.mockImplementation((u: number, n: number) => Math.max(0, u - n));
});

describe("OperationsDrawer — auth + lockout gating", () => {
  it("blocks Authorize while a brute-force lockout is in force (no bypass surface)", async () => {
    // An active lockout from earlier wrong passwords (here or at the lock gate).
    lockout.readLockoutState.mockReturnValue({ failCount: 5, lockoutUntil: Date.now() + 60_000 });
    const { user } = renderWithProviders(<OperationsDrawer descriptor={keychainOp(vi.fn())} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Continue" })); // preview → auth
    const authorize = screen.getByRole("button", { name: /Locked/ });
    expect(authorize).toBeDisabled();
    expect(passwordInput()).toBeDisabled();
    // Guard is real: no decrypt is attempted while locked out.
    await user.click(authorize);
    expect(kc.fetchAndUnlockVault).not.toHaveBeenCalled();
  });

  it("routes a wrong password through the shared lockout counter (parity with the lock gate)", async () => {
    kc.fetchAndUnlockVault.mockRejectedValue(new VaultCallError({ code: "wrong_password" }));
    const { user } = renderWithProviders(<OperationsDrawer descriptor={keychainOp(vi.fn())} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(passwordInput(), "wrong-pw");
    await user.click(screen.getByRole("button", { name: "Authorize" }));

    // The drawer bumps the SAME shared counter the unlock screen uses.
    expect(lockout.recordWrongUnlockAttempt).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Wrong password")).toBeInTheDocument();
    // A wrong password never runs the operation.
    expect(lockout.clearUnlockLockout).not.toHaveBeenCalled();
  });
});

describe("OperationsDrawer — secret hygiene", () => {
  it("zeroes the decrypted seed after execute (finally-block hygiene)", async () => {
    const seed = new Uint8Array(32).fill(7);
    kc.fetchAndUnlockVault.mockResolvedValue(seed);
    let captured: Uint8Array | undefined;
    const execute = vi.fn(async (ctx?: { vaultSeed?: Uint8Array }): Promise<OperationResult> => {
      captured = ctx?.vaultSeed; // same reference the finally zeroes
      return { headline: "Broadcast 1 LYTH", txHash: "0xabc" };
    });
    const { user } = renderWithProviders(<OperationsDrawer descriptor={keychainOp(execute)} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(passwordInput(), "correct-pw");
    await user.click(screen.getByRole("button", { name: "Authorize" }));

    await screen.findByText("Broadcast 1 LYTH"); // reached Done
    expect(execute).toHaveBeenCalledTimes(1);
    expect(captured).toBeInstanceOf(Uint8Array);
    // The seed the operation signed with is scrubbed to all-zero afterwards.
    expect(Array.from(captured!)).toEqual(new Array(32).fill(0));
    expect(lockout.clearUnlockLockout).toHaveBeenCalledTimes(1); // success resets the counter
  });
});

describe("OperationsDrawer — classified error stage (T9)", () => {
  const throwing = (message: string): OperationDescriptor =>
    readOp(() => Promise.reject(new Error(message)));

  afterEach(() => localStorage.removeItem("wallet.developerMode"));

  it("renders a classified card (headline + plain-language body) for a thrown error", async () => {
    const { user } = renderWithProviders(<OperationsDrawer descriptor={throwing("insufficient funds for transfer")} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Insufficient LYTH")).toBeInTheDocument();
    expect(screen.getByText(/doesn't have enough LYTH/)).toBeInTheDocument();
  });

  it("routes the 'Operators' mention when onNavigate is supplied (closes + navigates)", async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <OperationsDrawer descriptor={throwing("untrusted genesis")} onClose={onClose} onNavigate={onNavigate} />,
    );
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Chain genesis mismatch");
    await user.click(screen.getByRole("button", { name: "Operators" }));
    expect(onClose).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("operators");
  });

  it("leaves 'Operators' as plain text when no route callback is supplied", async () => {
    const { user } = renderWithProviders(<OperationsDrawer descriptor={throwing("untrusted genesis")} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Chain genesis mismatch");
    expect(screen.queryByRole("button", { name: "Operators" })).toBeNull();
  });

  it("shows dev-gated Technical details (with the raw message) only when developer mode is on", async () => {
    localStorage.setItem("wallet.developerMode", "true");
    const { user } = renderWithProviders(<OperationsDrawer descriptor={throwing("insufficient funds")} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Insufficient LYTH");
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.getByText("insufficient funds")).toBeInTheDocument(); // the raw pre-classification message
  });

  it("hides Technical details when developer mode is off", async () => {
    const { user } = renderWithProviders(<OperationsDrawer descriptor={throwing("insufficient funds")} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Insufficient LYTH");
    expect(screen.queryByText("Technical details")).toBeNull();
  });

  it("never shows Technical details for an unknown error (its body IS the raw message)", async () => {
    localStorage.setItem("wallet.developerMode", "true");
    const { user } = renderWithProviders(<OperationsDrawer descriptor={throwing("totally novel failure zzz")} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await screen.findByText("Transaction failed");
    expect(screen.getByText("totally novel failure zzz")).toBeInTheDocument();
    expect(screen.queryByText("Technical details")).toBeNull();
  });

  it("§8.8: the active-account sentinel renders the amber 'Account changed' card", async () => {
    const { user } = renderWithProviders(
      <OperationsDrawer descriptor={throwing("active account changed during signing — transaction cancelled for safety")} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("Account changed — transaction cancelled")).toBeInTheDocument();
  });
});

describe("OperationsDrawer — close-block", () => {
  it("cannot be closed while executing (a broadcast tx isn't abandoned)", async () => {
    let finish: (() => void) | undefined;
    const execute = vi.fn(
      () => new Promise<OperationResult>((res) => { finish = () => res({ headline: "Done", txHash: "0xabc" }); }),
    );
    const onClose = vi.fn();
    const { user } = renderWithProviders(<OperationsDrawer descriptor={readOp(execute)} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Run" })); // auth:none → runExecute → executing (pending)
    await screen.findByText("Working — do not close.");

    // Esc is ignored mid-execute…
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    // …and the close (X) button is disabled.
    expect(screen.getByRole("button", { name: "Close drawer" })).toBeDisabled();

    finish!();
    await screen.findByText("Done");
  });
});
