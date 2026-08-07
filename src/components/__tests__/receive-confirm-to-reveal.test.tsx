// The confirm-to-reveal panel — the wallet's newest password surface.
//
// Adding a password box to Receive is only defensible if it is throttled exactly
// like the other three. An unthrottled prompt beside three throttled ones does
// not add a surface, it REPLACES the protection: an attacker with the machine
// simply uses whichever prompt was left open. So these pin the lockout wiring
// behaviourally, not by reading the imports.
//
// They also pin the two things the panel must never do: publish before the
// derivation lands, and leave the seed in the heap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const STORED_HEX = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const DERIVED_HEX = "0x3fdf7513d14e2938d3ff505dbb45e19716f699e5";
const DERIVED_BECH32 = "mono18l0h2y73fc5n35ll2pwmk30pjut0dx09wmu4y9";

const qr = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: { value: string }) => {
    qr.value = props.value;
    return <svg data-testid="qr" />;
  },
}));

/** The seed handed out by the fake vault. Kept so a test can inspect it AFTER
 *  the panel is done with it — zeroing is a property of the array, not a call. */
const seeds = vi.hoisted(() => ({ issued: [] as Uint8Array[] }));
const fetchAndUnlockVault = vi.hoisted(() => vi.fn());
const getActiveAccount = vi.hoisted(() => vi.fn(() => "kc:lyth:test:v1"));
const captureAddressOnUnlock = vi.hoisted(() => vi.fn(async () => {}));
const notifyActiveWalletChanged = vi.hoisted(() => vi.fn());
const withSigningBackend = vi.hoisted(() =>
  vi.fn((_seed: Uint8Array, use: (b: unknown) => string) =>
    use({ getAddress: () => "0x3FDF7513D14E2938D3FF505DBB45E19716F699E5" }),
  ),
);
const readLockoutState = vi.hoisted(() => vi.fn(() => ({ lockoutUntil: 0, failCount: 0 })));
const recordWrongUnlockAttempt = vi.hoisted(() => vi.fn(() => ({ lockoutUntil: 0, failCount: 1 })));
const clearUnlockLockout = vi.hoisted(() => vi.fn());
const wrongPassword = vi.hoisted(() => ({ value: true }));

vi.mock("../../sdk/keychain", () => ({
  fetchAndUnlockVault,
  getActiveAccount,
  KeychainCallError: class KeychainCallError extends Error {},
}));
vi.mock("../../sdk/vault", () => ({ isWrongPasswordFailure: () => wrongPassword.value }));
vi.mock("../../sdk/signing-backend", () => ({ withSigningBackend }));
vi.mock("../../sdk/vaultCatalog", () => ({ captureAddressOnUnlock }));
vi.mock("../../sdk/active-wallet", () => ({ notifyActiveWalletChanged }));
vi.mock("../../sdk/use-reverse-names", () => ({ useReverseName: () => null }));
vi.mock("../../sdk/unlock-lockout", () => ({
  readLockoutState,
  recordWrongUnlockAttempt,
  clearUnlockLockout,
  lockoutRemainingMs: (until: number, now: number) => Math.max(0, until - now),
}));

import { ReceiveModal } from "../ReceiveModal";
import { clearDerivedAddresses, isAddressDerived } from "../../sdk/address-provenance";

function passwordBox(): HTMLInputElement {
  const el = document.querySelector("input");
  if (el === null) throw new Error("no password input rendered");
  return el;
}

function revealButton(): HTMLElement {
  return screen.getByRole("button", { name: /show my address|verifying|locked —/i });
}

async function type(value: string) {
  fireEvent.change(passwordBox(), { target: { value } });
}

async function submit() {
  await act(async () => {
    fireEvent.click(revealButton());
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  qr.value = null;
  seeds.issued = [];
  wrongPassword.value = true;
  clearDerivedAddresses();
  readLockoutState.mockReturnValue({ lockoutUntil: 0, failCount: 0 });
  fetchAndUnlockVault.mockImplementation(async () => {
    const seed = new Uint8Array(32).fill(7);
    seeds.issued.push(seed);
    return seed;
  });
});

afterEach(() => cleanup());

/** The modal always mounts on the STORED hex — the planted one. */
function renderReceive() {
  return render(<ReceiveModal addressHex={STORED_HEX} onClose={vi.fn()} />);
}

describe("the lockout is shared, not bypassed", () => {
  it("an in-force lockout blocks BEFORE the vault is ever decrypted", async () => {
    // The property that matters. A surface that decrypts first and reports the
    // lockout afterwards has not throttled anything — the attacker still gets
    // one Argon2id trial per click.
    readLockoutState.mockReturnValue({ lockoutUntil: Date.now() + 60_000, failCount: 9 });
    renderReceive();

    await type("guess");
    await submit();

    expect(fetchAndUnlockVault).not.toHaveBeenCalled();
    expect(withSigningBackend).not.toHaveBeenCalled();
  });

  it("reads the persisted lockout on mount, so a relaunch cannot sidestep it", () => {
    readLockoutState.mockReturnValue({ lockoutUntil: Date.now() + 30_000, failCount: 5 });
    renderReceive();
    expect(readLockoutState).toHaveBeenCalled();
    expect(screen.getByText(/too many wrong attempts/i)).toBeInTheDocument();
    expect(revealButton()).toBeDisabled();
  });

  it("a wrong password feeds the SAME shared counter", async () => {
    wrongPassword.value = true;
    fetchAndUnlockVault.mockRejectedValueOnce(new Error("bad password"));
    renderReceive();

    await type("wrong");
    await submit();

    // Not a private counter: this is the function the lock gate and the drawer
    // call, so attempts here accumulate with theirs.
    expect(recordWrongUnlockAttempt).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/wrong password/i)).toBeInTheDocument();
    expect(qr.value).toBeNull();
  });

  it("a correct password clears the counter", async () => {
    renderReceive();
    await type("correct-horse");
    await submit();
    expect(clearUnlockLockout).toHaveBeenCalledTimes(1);
  });
});

describe("what the panel does with a correct password", () => {
  it("records the DERIVED address, not the stored one", async () => {
    renderReceive();
    await type("correct-horse");
    await submit();

    await waitFor(() => expect(isAddressDerived(DERIVED_HEX)).toBe(true));
    // The planted value must never be blessed, even though it is what the
    // component was handed.
    expect(isAddressDerived(STORED_HEX)).toBe(false);
  });

  it("normalises the SDK's casing before recording", async () => {
    // The fake backend returns an UPPERCASE hex on purpose: a case-sensitive
    // record would mark a string no read ever matches, and the reveal would
    // never fire.
    renderReceive();
    await type("correct-horse");
    await submit();
    await waitFor(() => expect(isAddressDerived(DERIVED_HEX)).toBe(true));
  });

  it("heals the catalog with the derived value", async () => {
    renderReceive();
    await type("correct-horse");
    await submit();
    await waitFor(() => expect(captureAddressOnUnlock).toHaveBeenCalled());
    expect(captureAddressOnUnlock).toHaveBeenCalledWith("kc:lyth:test:v1", DERIVED_HEX);
    await waitFor(() => expect(notifyActiveWalletChanged).toHaveBeenCalled());
  });

  it("still does not publish the STORED address — the reveal waits for the reload", async () => {
    renderReceive();
    await type("correct-horse");
    await submit();

    // The prop is still the planted hex until the active-wallet refresh lands,
    // and the gate is keyed on the prop. Fail-closed: a correct password does
    // not reveal a value that was never derived.
    await waitFor(() => expect(captureAddressOnUnlock).toHaveBeenCalled());
    expect(qr.value).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(DERIVED_BECH32);
  });

  it("reveals once the catalog reload delivers the derived hex", async () => {
    const { rerender } = renderReceive();
    await type("correct-horse");
    await submit();
    await waitFor(() => expect(isAddressDerived(DERIVED_HEX)).toBe(true));

    // What `notifyActiveWalletChanged` causes in the real app.
    rerender(<ReceiveModal addressHex={DERIVED_HEX} onClose={vi.fn()} />);

    expect(screen.getByTestId("qr")).toBeInTheDocument();
    expect(qr.value).toBe(DERIVED_BECH32);
    expect(screen.queryByTestId("receive-confirm")).toBeNull();
  });

  it("says so when the derivation succeeded but the catalog write failed", async () => {
    // Otherwise the field just empties and the panel re-renders identically,
    // forever, with the user's correct password apparently ignored.
    captureAddressOnUnlock.mockRejectedValueOnce(new Error("store unwritable"));
    renderReceive();
    await type("correct-horse");
    await submit();

    await waitFor(() =>
      expect(screen.getByText(/password was correct, but this device could not/i))
        .toBeInTheDocument(),
    );
  });
});

describe("the seed", () => {
  it("is zeroed on the success path", async () => {
    renderReceive();
    await type("correct-horse");
    await submit();
    await waitFor(() => expect(seeds.issued).toHaveLength(1));
    expect(Array.from(seeds.issued[0]!)).toEqual(new Array(32).fill(0));
  });

  it("is zeroed even when the derivation throws", async () => {
    withSigningBackend.mockImplementationOnce(() => {
      throw new Error("backend unavailable");
    });
    renderReceive();
    await type("correct-horse");
    await submit();
    await waitFor(() => expect(seeds.issued).toHaveLength(1));
    expect(Array.from(seeds.issued[0]!)).toEqual(new Array(32).fill(0));
  });

  it("is not held across the catalog write", async () => {
    // The write is dispatched, not awaited, so the seed must already be zero by
    // the time the store call is observed. The other two derivation sites
    // document this discipline; this is the one that could quietly reverse it.
    let seedAtWriteTime: number[] | null = null;
    captureAddressOnUnlock.mockImplementationOnce(async () => {
      seedAtWriteTime = Array.from(seeds.issued[0] ?? []);
    });
    renderReceive();
    await type("correct-horse");
    await submit();

    await waitFor(() => expect(seedAtWriteTime).not.toBeNull());
    expect(seedAtWriteTime).toEqual(new Array(32).fill(0));
  });
});
