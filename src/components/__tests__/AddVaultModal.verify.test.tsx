// The secondary-wallet Create must force the same phrase verification first-run
// uses: nothing is sealed to disk until the user proves they recorded the phrase.
// Regression target — a wallet cannot be created without a correct verification.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// 24 distinct, non-BIP39 words so the fill-in-the-blanks bank has no duplicate
// tiles and we can drive the challenge deterministically.
const WORDS = Array.from({ length: 24 }, (_, i) => `verifyword${i + 1}`);
const KNOWN = WORDS.join(" ");
const PASSWORD = "Str0ng!Passw0rd";
const SLOT = "kc:lyth:test:v1";

// Boundary mocks: keep every real UI (MnemonicGrid, VerifyPhrase) but stub the
// crypto sanity path (so KNOWN needn't be a checksummed phrase) and the disk seam.
vi.mock("@monolythium/core-sdk/crypto", async (orig) => {
  const actual = await orig<typeof import("@monolythium/core-sdk/crypto")>();
  return {
    ...actual,
    generateMnemonic: () => KNOWN,
    mnemonicToMlDsa65Seed: () => new Uint8Array(32),
    MlDsa65Backend: { fromSeed: () => ({}) },
  };
});

const createAndStoreVault = vi.hoisted(() =>
  vi.fn(async () => ({ addressHex: "0xabc", mnemonic: KNOWN })),
);
const setActiveAccount = vi.hoisted(() => vi.fn());
vi.mock("../../sdk/keychain", () => ({ createAndStoreVault, setActiveAccount }));

const registerVault = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../sdk/vaultCatalog", () => ({
  registerVault,
  mintVaultSlot: () => SLOT,
}));

vi.mock("../../sdk/active-wallet", () => ({ notifyActiveWalletChanged: vi.fn() }));

import { AddVaultModal } from "../AddVaultModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Fill the compose form (create mode is the default) and submit → show-phrase. */
function composeCreate(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText(/Trading/i), {
    target: { value: "Savings" },
  });
  const pwInputs = container.querySelectorAll('input[type="password"]');
  fireEvent.change(pwInputs[0]!, { target: { value: PASSWORD } });
  fireEvent.change(pwInputs[1]!, { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

/** The word indices (1-based) of the three currently-empty verify slots, ascending. */
function emptyIndices(): number[] {
  return screen
    .queryAllByRole("button", { name: /, empty$/ })
    .map((b) => parseInt(b.getAttribute("aria-label")!.match(/Word (\d+),/)![1]!, 10));
}

// Both tests here seal a real vault, so each pays the Argon2id cost twice over.
// That fits inside the 5s default alone but not under full-suite load, where
// this file has timed out at ~6.3s while passing in isolation — a failure nobody
// believes, in a suite that has to stay worth reading.
//
// The cost is deliberately NOT lowered to make this fast: the KDF parameters are
// a real security control, not a test-harness knob. Only the wait is raised.
vi.setConfig({ testTimeout: 20_000 });

describe("AddVaultModal — forced verification before a secondary wallet is sealed", () => {
  it("does not seal until a correct verification, then seals the shown phrase", async () => {
    const onClose = vi.fn();
    const { container } = render(<AddVaultModal onClose={onClose} onAdded={vi.fn()} />);

    composeCreate(container);

    // show-phrase: the phrase is shown but NOTHING has touched disk.
    await screen.findByRole("button", { name: /i have backed it up/i });
    expect(createAndStoreVault).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /i have backed it up/i }));

    // verify-phrase: the forced challenge is up; still nothing sealed.
    expect(screen.getByText(/place the missing words/i)).toBeInTheDocument();
    expect(createAndStoreVault).not.toHaveBeenCalled();

    // Place each missing word correctly (bank fills the lowest empty slot first).
    for (let guard = 0; guard < 24; guard++) {
      const empties = emptyIndices();
      if (empties.length === 0) break;
      fireEvent.click(screen.getByRole("button", { name: WORDS[empties[0]! - 1]! }));
    }
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // Only now is the vault sealed — with the exact phrase that was shown.
    await waitFor(() => expect(createAndStoreVault).toHaveBeenCalledTimes(1));
    expect(createAndStoreVault).toHaveBeenCalledWith(SLOT, PASSWORD, {
      importMnemonic: KNOWN,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("blocks creation on an incomplete or wrong verification", async () => {
    const onClose = vi.fn();
    const { container } = render(<AddVaultModal onClose={onClose} onAdded={vi.fn()} />);

    composeCreate(container);
    fireEvent.click(await screen.findByRole("button", { name: /i have backed it up/i }));

    // Incomplete: Continue is disabled with nothing placed, so nothing seals.
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();

    // Wrong: place the correct words but in the wrong slots (swap the first two).
    const [n1, n2, n3] = emptyIndices();
    const e = [WORDS[n1! - 1]!, WORDS[n2! - 1]!, WORDS[n3! - 1]!];
    fireEvent.click(screen.getByRole("button", { name: e[1]! })); // e2 → slot n1 (wrong)
    fireEvent.click(screen.getByRole("button", { name: e[0]! })); // e1 → slot n2 (wrong)
    fireEvent.click(screen.getByRole("button", { name: e[2]! })); // e3 → slot n3
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // The verifier rejects it and nothing was sealed.
    expect(screen.getByText(/not quite right/i)).toBeInTheDocument();
    expect(createAndStoreVault).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
