// The two places the provenance mechanism could be silently disconnected.
//
// `receive-address-provenance.test.tsx` proves the Receive surface honours the
// set. That is worth nothing if nobody fills it, and worse than nothing if
// nobody empties it — so these pin the WIRING, at the two ends:
//
//   1. the lock EMPTIES it, or a pre-lock proof would vouch for a value planted
//      afterwards;
//   2. the lock gate FILLS it, which is the correction this pass makes. The gate
//      decrypted the vault, held the seed, zeroed it, and never asked what
//      address it produces — so a user who had just typed their passphrase still
//      had an unchecked catalog value. Only performing a signing operation
//      healed it, which the finding's own adversarial test called out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const DERIVED_HEX = "0x3fdf7513d14e2938d3ff505dbb45e19716f699e5";

const fetchAndUnlockVault = vi.hoisted(() => vi.fn(async () => new Uint8Array(32)));
const getActiveAccount = vi.hoisted(() => vi.fn(() => "kc:lyth:test:v1"));
const captureAddressOnUnlock = vi.hoisted(() => vi.fn(async () => {}));
const withSigningBackend = vi.hoisted(() => vi.fn((_seed: Uint8Array, use: (b: unknown) => string) =>
  use({ getAddress: () => DERIVED_HEX }),
));

vi.mock("../../sdk/keychain", () => ({
  fetchAndUnlockVault,
  getActiveAccount,
  KeychainCallError: class KeychainCallError extends Error {},
}));
vi.mock("../../sdk/vault", () => ({ isWrongPasswordFailure: () => true }));
vi.mock("../../sdk/signing-backend", () => ({ withSigningBackend }));
vi.mock("../../sdk/vaultCatalog", () => ({ captureAddressOnUnlock }));
vi.mock("../../sdk/active-wallet", () => ({
  loadActiveWallet: async () => ({ status: "ready", addressHex: DERIVED_HEX }),
  notifyActiveWalletChanged: vi.fn(),
}));
vi.mock("../../sdk/reset", () => ({
  resetWalletOnThisDevice: vi.fn(async () => {}),
  resetPhraseProofMatches: () => true,
  resetConfirmMatches: (s: string) => s === "RESET",
  NON_CUSTODIAL_RESET_NOTE: "note",
}));
vi.mock("../../sdk/unlock-lockout", () => ({
  readLockoutState: () => ({ lockoutUntil: 0, failCount: 0 }),
  recordWrongUnlockAttempt: () => ({ lockoutUntil: 0, failCount: 1 }),
  clearUnlockLockout: vi.fn(),
  lockoutRemainingMs: (until: number, now: number) => Math.max(0, until - now),
}));

import { UnlockGate } from "../UnlockGate";
import { LockProvider, useAutoLock } from "../../sdk/auto-lock";
import {
  clearDerivedAddresses,
  derivedAddressCount,
  isAddressDerived,
  markAddressDerived,
} from "../../sdk/address-provenance";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearDerivedAddresses();
  fetchAndUnlockVault.mockResolvedValue(new Uint8Array(32));
});

afterEach(() => cleanup());

describe("the lock empties the provenance set", () => {
  function LockHarness() {
    const { lock, isLocked } = useAutoLock();
    return (
      <button onClick={lock} data-testid="lock">
        {isLocked ? "locked" : "unlocked"}
      </button>
    );
  }

  it("locking clears every recorded derivation", async () => {
    markAddressDerived(DERIVED_HEX);
    markAddressDerived("0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(derivedAddressCount()).toBe(2);

    render(
      <LockProvider>
        <LockHarness />
      </LockProvider>,
    );
    // Sanity: mounting must not clear it on its own, or the assertion below
    // would pass without the lock doing anything.
    expect(derivedAddressCount()).toBe(2);

    await act(async () => {
      fireEvent.click(screen.getByTestId("lock"));
    });

    await waitFor(() => expect(screen.getByTestId("lock").textContent).toBe("locked"));
    // Counted, not probed — a clear that dropped one entry would still answer
    // false for whichever address a single-probe assertion happened to pick.
    expect(derivedAddressCount()).toBe(0);
  });
});

/** The gate renders one password box. A label-text query also matches the
 *  "Forgot your password?" control, so query the input directly. */
function passwordBox(): HTMLInputElement {
  const el = document.querySelector("input");
  if (el === null) throw new Error("no password input rendered");
  return el;
}

describe("the lock gate fills the provenance set", () => {
  /** The gate reads the real lock context, so it needs the real provider. */
  const renderGate = () =>
    render(
      <LockProvider>
        <UnlockGate />
      </LockProvider>,
    );


  it("a correct password records the DERIVED address", async () => {
    renderGate();
    expect(isAddressDerived(DERIVED_HEX)).toBe(false);

    fireEvent.change(passwordBox(), { target: { value: "correct-horse" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    });

    await waitFor(() => expect(isAddressDerived(DERIVED_HEX)).toBe(true));
    // The derivation is what proves ownership, so it must come from the seed
    // the vault yielded — not from the catalog value being checked.
    expect(withSigningBackend).toHaveBeenCalledTimes(1);
  });

  it("also heals a catalog whose stored address is not what the seed produces", async () => {
    renderGate();
    fireEvent.change(passwordBox(), { target: { value: "correct-horse" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    });

    await waitFor(() => expect(captureAddressOnUnlock).toHaveBeenCalled());
    expect(captureAddressOnUnlock).toHaveBeenCalledWith("kc:lyth:test:v1", DERIVED_HEX);
  });

  it("a WRONG password records nothing", async () => {
    fetchAndUnlockVault.mockRejectedValueOnce(new Error("bad password"));
    renderGate();

    fireEvent.change(passwordBox(), { target: { value: "wrong" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    });

    // The direction that matters: a failed proof must not vouch for anything.
    expect(derivedAddressCount()).toBe(0);
    expect(withSigningBackend).not.toHaveBeenCalled();
  });

  it("a derivation failure still lets the user in", async () => {
    // Fail-direction: the address check is a display concern. A user who typed
    // the right password gets in either way; the publication surfaces fail
    // closed on their own because nothing was recorded.
    withSigningBackend.mockImplementationOnce(() => {
      throw new Error("backend unavailable");
    });
    renderGate();

    fireEvent.change(passwordBox(), { target: { value: "correct-horse" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /unlock/i }));
    });

    await waitFor(() => expect(screen.queryByText(/backend unavailable/i)).toBeNull());
    expect(derivedAddressCount()).toBe(0);
  });
});
