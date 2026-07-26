// The forgot-password reset now requires proof of the recovery phrase in
// addition to typing RESET, so a locked-out user without their backup can't wipe
// the only local copy — while a phrase-holding user still can (and is confirmed
// able to restore afterward).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { generateMnemonic } from "@monolythium/core-sdk/crypto";
import { deriveAddressHexFromMnemonic } from "../../sdk/keychain";

// The active vault's stored address (available even while locked). loadActiveWallet
// is mocked; the reset proof + derivation stay real.
const activeRef = vi.hoisted(() => ({ addressHex: null as string | null }));
vi.mock("../../sdk/active-wallet", () => ({
  loadActiveWallet: async () => ({
    status: "ready",
    slot: "s",
    name: "W",
    addressHex: activeRef.addressHex,
    address: "mono1test",
  }),
  useActiveWallet: () => ({
    status: "ready",
    slot: "s",
    name: "W",
    addressHex: activeRef.addressHex,
    address: "mono1test",
  }),
}));

import { renderWithProviders } from "../../test/renderWithProviders";
import { UnlockGate } from "../UnlockGate";

const PHRASE = generateMnemonic();
const ADDR = deriveAddressHexFromMnemonic(PHRASE)!;
const OTHER_PHRASE = generateMnemonic();

afterEach(() => cleanup());

describe("UnlockGate reset guard", () => {
  it("requires BOTH this vault's recovery phrase and RESET before erase enables", async () => {
    activeRef.addressHex = ADDR;
    const { user } = renderWithProviders(<UnlockGate />);
    await user.click(screen.getByRole("button", { name: /forgot your password/i }));

    const erase = screen.getByRole("button", { name: /erase wallet/i });
    const confirm = screen.getByPlaceholderText("RESET");
    const phraseBox = screen.getByPlaceholderText(/word1 word2/i);

    expect(erase).toBeDisabled();

    // RESET alone is not enough — possession proof is still missing.
    fireEvent.change(confirm, { target: { value: "RESET" } });
    expect(erase).toBeDisabled();

    // The matching phrase + RESET enables it (once the stored address loads).
    fireEvent.change(phraseBox, { target: { value: PHRASE } });
    await waitFor(() => expect(erase).toBeEnabled());

    // A different VALID phrase must not enable it — it has to be THIS vault's.
    fireEvent.change(phraseBox, { target: { value: OTHER_PHRASE } });
    expect(erase).toBeDisabled();
  });
});
